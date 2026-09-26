/**
 * SSE subscription helper.
 *
 * Wraps native EventSource with:
 *  - Auth via short-lived token in URL (EventSource cannot set headers).
 *  - Reconnect with exponential backoff on transient errors.
 *  - Typed event parsing via Zod (drops malformed events, never crashes).
 *  - Heartbeat watchdog (server should send heartbeat every ~15s).
 */
import { api } from "./api";
import { SseEventSchema, type SseEvent } from "@/types/sse";

export type SseHandler = (event: SseEvent) => void;
export type SseStatus = "connecting" | "open" | "reconnecting" | "closed" | "error";
export type SseStatusHandler = (status: SseStatus) => void;

export interface SseSubscribeOptions {
  /** Override base URL (default `/api`). */
  baseUrl?: string;
  /** Status callback for UI ("Reconnecting…" banner). */
  onStatus?: SseStatusHandler;
  /** Watchdog: if no event in this many ms, force reconnect. Default 30s. */
  heartbeatTimeoutMs?: number;
}

export function subscribeSse(
  sessionId: string,
  handler: SseHandler,
  options: SseSubscribeOptions = {},
): () => void {
  const baseUrl = options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "/api";
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 30_000;

  let es: EventSource | null = null;
  let stopped = false;
  let attempt = 0;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (s: SseStatus) => {
    options.onStatus?.(s);
  };

  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      // No data in heartbeatTimeoutMs — assume dead, reconnect.
      if (!stopped) {
         
        console.warn("[sse] heartbeat timeout, reconnecting");
        scheduleReconnect();
      }
    }, heartbeatTimeoutMs);
  };

  const onMessage = (raw: MessageEvent<string>) => {
    armWatchdog();
    if (!raw.data) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.data);
    } catch {
      return;
    }
    const result = SseEventSchema.safeParse(parsed);
    if (!result.success) {
       
      console.warn("[sse] dropped malformed event", result.error.issues);
      return;
    }
    handler(result.data);
  };

  const cleanup = () => {
    if (es) {
      es.removeEventListener("message", onMessage as EventListener);
      es.close();
      es = null;
    }
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    cleanup();
    setStatus("reconnecting");
    attempt += 1;
    // Exponential backoff w/ jitter, capped at 15s.
    const base = Math.min(15_000, 500 * Math.pow(2, attempt));
    const jitter = Math.random() * 250;
    reconnectTimer = setTimeout(() => {
      void connect();
    }, base + jitter);
  };

  const connect = async () => {
    if (stopped) return;
    setStatus("connecting");
    let token: string;
    try {
      token = await api.getSseToken(sessionId);
    } catch (err) {
       
      console.warn("[sse] token fetch failed, retrying", err);
      scheduleReconnect();
      return;
    }
    if (stopped) return;

    const url = `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/stream?token=${encodeURIComponent(token)}`;
    es = new EventSource(url, { withCredentials: true });
    armWatchdog();

    es.addEventListener("open", () => {
      attempt = 0;
      setStatus("open");
    });
    es.addEventListener("message", onMessage as EventListener);
    es.addEventListener("error", () => {
      // EventSource auto-reconnects, but we want our own backoff + token refresh.
      if (es?.readyState === EventSource.CLOSED) {
        setStatus("error");
        scheduleReconnect();
      }
    });
  };

  void connect();

  return () => {
    stopped = true;
    cleanup();
    setStatus("closed");
  };
}
