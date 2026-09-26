/**
 * useSSE — mocks the underlying subscribeSse helper from `lib/sse` so we can
 * deterministically deliver events.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const sseState = vi.hoisted(() => ({
  activeHandler: null as ((ev: { type: string }) => void) | null,
  activeStatusHandler: null as ((s: string) => void) | null,
}));

const { subscribeSseMock } = vi.hoisted(() => {
  const state = {
    activeHandler: null as ((ev: { type: string }) => void) | null,
    activeStatusHandler: null as ((s: string) => void) | null,
  };
  const mock = vi.fn(
    (sessionId: string, handler: (ev: { type: string }) => void, opts: { onStatus?: (s: string) => void } = {}) => {
      void sessionId;
      state.activeHandler = handler;
      state.activeStatusHandler = opts.onStatus ?? null;
      state.activeStatusHandler?.("open");
      return () => {
        state.activeHandler = null;
        state.activeStatusHandler?.("closed");
      };
    },
  );
  // Share `state` with the test file by aliasing onto the mock so `sseState`
  // (also hoisted) can be replaced post-hoist. We do that below.
  (mock as unknown as { _state: typeof state })._state = state;
  return { subscribeSseMock: mock };
});

// Re-bind `sseState` to the mock's internal state so all `sseState.activeHandler`
// references resolve against the same object the mock writes to.
Object.assign(
  sseState,
  (subscribeSseMock as unknown as { _state: typeof sseState })._state,
);
const _state = (subscribeSseMock as unknown as { _state: typeof sseState })._state;
Object.defineProperty(sseState, "activeHandler", {
  get: () => _state.activeHandler,
  set: (v) => { _state.activeHandler = v; },
});
Object.defineProperty(sseState, "activeStatusHandler", {
  get: () => _state.activeStatusHandler,
  set: (v) => { _state.activeStatusHandler = v; },
});

vi.mock("@/lib/sse", () => ({
  subscribeSse: subscribeSseMock,
}));

vi.mock("@/types/sse", () => ({
  SseEventSchema: {
    safeParse: (v: unknown) => ({ success: true, data: v }),
  },
}));

import { useSSE } from "../useSSE";

describe("useSSE", () => {
  it("does not subscribe when sessionId is null", () => {
    const { result } = renderHook(() => useSSE(null));
    expect(subscribeSseMock).not.toHaveBeenCalled();
    expect(result.current.events).toEqual([]);
    expect(result.current.status).toBe("closed");
  });

  it("subscribes and accumulates events up to bufferLimit", async () => {
    const { result } = renderHook(() =>
      useSSE("sess-1", { bufferLimit: 3 }),
    );

    expect(subscribeSseMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.status).toBe("open"));

    act(() => {
      sseState.activeHandler?.({ type: "agent_started" });
      sseState.activeHandler?.({ type: "agent_chunk" });
      sseState.activeHandler?.({ type: "agent_completed" });
      sseState.activeHandler?.({ type: "session_completed" });
    });

    // Buffer capped at 3.
    expect(result.current.events.length).toBe(3);
    expect(result.current.events[0]).toEqual({ type: "agent_chunk" });
    expect(result.current.events[2]).toEqual({ type: "session_completed" });
  });

  it("invokes onEvent callback per event", () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE("sess-2", { onEvent }));
    act(() => sseState.activeHandler?.({ type: "x" }));
    expect(onEvent).toHaveBeenCalledWith({ type: "x" });
  });

  it("clear() empties the buffer", () => {
    const { result } = renderHook(() => useSSE("sess-3"));
    act(() => sseState.activeHandler?.({ type: "a" }));
    expect(result.current.events.length).toBe(1);
    act(() => result.current.clear());
    expect(result.current.events.length).toBe(0);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useSSE("sess-4"));
    unmount();
    expect(sseState.activeHandler).toBeNull();
  });
});
