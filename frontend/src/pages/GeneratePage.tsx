/**
 * GeneratePage — the live "watch the swarm work" view.
 *
 * Layout (desktop):
 *   ┌─────────────────────────────────────────────────────┐
 *   │ Sticky top bar: Timer · ProgressBar · Cost · Cancel │
 *   ├─────────────────────────────┬───────────────────────┤
 *   │  ProgressiveCanvas (~65%)   │  ReasoningSidebar     │
 *   │  (artifacts as they finish) │  (live trace, ~35%)   │
 *   ├─────────────────────────────┴───────────────────────┤
 *   │  AgentDashboard (collapsible — default closed)      │
 *   └─────────────────────────────────────────────────────┘
 *
 * Mobile collapses to single column with a tab switcher.
 *
 * Routes to /results/:sessionId when status === completed | partial.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { LayoutGrid, Pause, ScrollText, X } from "lucide-react";

import { ProgressiveCanvas } from "@/components/ProgressiveCanvas";
import { ReasoningSidebar } from "@/components/ReasoningSidebar";
import { AgentDashboard } from "@/components/AgentDashboard";
import { ProgressBar } from "@/components/ProgressBar";
import { Timer } from "@/components/Timer";
import { ArticulationStep } from "@/components/ArticulationStep";
import { Spinner } from "@/components/MicroWidgets/Spinner";
import { useSession } from "@/hooks/useSession";
import { api, APIError } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { track, Events } from "@/lib/analytics";
import { WAVE_AGENTS } from "@/lib/constants";
import type { AgentName, AgentRecord, Wave } from "@/types/session";
import type {
  AgentResults,
  ArticulationOutput,
  BrandIdentityResult,
  CompetitiveAnalysisResult,
  ExecutiveSummaryResult,
  FinancialModelResult,
  LandingPageResult,
  MarketResearchResult,
  PitchDeckResult,
} from "@/types/agents";
import type { ReasoningStreamEvent, AgentRole } from "@/types/agents";
import type { SseEvent } from "@/types/sse";
import { cn } from "@/lib/cn";

const SPRING = { type: "spring" as const, stiffness: 100, damping: 20 };

const ALL_AGENT_COUNT = 13;

function deriveCurrentWave(records: Partial<Record<AgentName, AgentRecord>>): number {
  const waveDone = (w: Wave) =>
    WAVE_AGENTS[w].every((a) => {
      const r = records[a];
      return r?.status === "completed" || r?.status === "skipped";
    });
  if (!waveDone("pre")) return 0;
  if (!waveDone("wave_1")) return 1;
  if (!waveDone("wave_2")) return 2;
  if (!waveDone("wave_3")) return 3;
  return 3;
}

function mapSseToReasoning(events: SseEvent[]): ReasoningStreamEvent[] {
  const out: ReasoningStreamEvent[] = [];
  for (const ev of events) {
    const t_ms = Date.parse(ev.at) || Date.now();
    switch (ev.type) {
      case "agent.started": {
        const wave = AGENT_WAVE_NUM[ev.agent as AgentName] ?? 1;
        out.push({ kind: "agent_started", agent: ev.agent as AgentRole, wave, t_ms });
        break;
      }
      case "agent.reasoning":
        out.push({
          kind: "agent_token",
          agent: ev.agent as AgentRole,
          token: ev.delta,
          t_ms,
        });
        break;
      case "agent.completed":
        out.push({
          kind: "agent_completed",
          agent: ev.agent as AgentRole,
          summary: null,
          t_ms,
        });
        break;
      case "agent.error":
        out.push({
          kind: "agent_failed",
          agent: ev.agent as AgentRole,
          reason: ev.error_message ?? "Agent error",
          t_ms,
        });
        break;
      default:
        break;
    }
  }
  return out;
}

const AGENT_WAVE_NUM: Record<AgentName, number> = {
  idea_parser: 0,
  articulation: 0,
  market_research: 1,
  competitive_analysis: 1,
  business_model: 1,
  brand_identity: 1,
  risk_analysis: 1,
  tech_architecture: 1,
  financial_model: 2,
  landing_page: 2,
  legal_documents: 2,
  go_to_market: 2,
  pitch_deck: 3,
  executive_summary: 3,
};

export function GeneratePage(): JSX.Element {
  const { sessionId = null } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { error: errorToast, success } = useToast();

  const { session, artifacts, loading, events, liveCostUsd, sseStatus } = useSession(
    sessionId ?? null,
  );

  // Articulation overlay state — surfaced if articulation result has clarifying questions.
  const [articulationOpen, setArticulationOpen] = useState(false);
  const [articulation, setArticulation] = useState<ArticulationOutput | null>(null);
  const articulationDismissedRef = useRef(false);

  useEffect(() => {
    const art = artifacts.articulation as ArticulationOutput | undefined;
    if (art && art.clarifying_questions.length > 0 && !articulationOpen && !articulationDismissedRef.current) {
      setArticulation(art);
      setArticulationOpen(true);
    }
  }, [artifacts.articulation, articulationOpen]);

  // Cancel handler
  const [canceling, setCanceling] = useState(false);
  const handleCancel = useCallback(async () => {
    if (!sessionId) return;
    const ok = window.confirm(
      "Cancel generation? Anything in flight will be charged ($0.00–$0.50). Completed agents stay accessible.",
    );
    if (!ok) return;
    setCanceling(true);
    track(Events.GENERATION_CANCELED, { session_id: sessionId });
    try {
      await api.cancelSession(sessionId);
      success("Cancellation queued", "Workers will wind down within ~5 seconds.");
    } catch (e) {
      const msg =
        e instanceof APIError ? e.message : e instanceof Error ? e.message : "Cancel failed";
      errorToast("Could not cancel", msg);
    } finally {
      setCanceling(false);
    }
  }, [sessionId, success, errorToast]);

  // Auto-redirect when complete.
  useEffect(() => {
    if (!session || !sessionId) return;
    if (session.status === "completed" || session.status === "partial") {
      track(Events.GENERATION_COMPLETED, {
        session_id: sessionId,
        status: session.status,
        cost_usd: session.cost.total_cost_usd,
      });
      const t = window.setTimeout(() => {
        navigate(`/results/${encodeURIComponent(sessionId)}`);
      }, 600);
      return () => window.clearTimeout(t);
    }
    if (session.status === "error" || session.status === "safety_blocked" || session.status === "budget_exceeded") {
      track(Events.GENERATION_ERROR, {
        session_id: sessionId,
        error_code: session.error_code,
      });
      errorToast(
        session.status === "safety_blocked"
          ? "Safety filter blocked this idea"
          : session.status === "budget_exceeded"
            ? "Cost cap reached"
            : "Generation failed",
        session.error_message ?? "See agent dashboard for details.",
      );
    }
    return undefined;
  }, [session, sessionId, navigate, errorToast]);

  // ─── Derived data ──────────────────────────────────────────────────────────
  const agents = session?.agents;
  const records = useMemo(
    () => (agents ?? {}) as Partial<Record<AgentName, AgentRecord>>,
    [agents],
  );
  const completed = useMemo(
    () => Object.values(records).filter((r) => r?.status === "completed" || r?.status === "skipped").length,
    [records],
  );
  const currentWave = useMemo(() => deriveCurrentWave(records), [records]);
  const reasoningEvents = useMemo(() => mapSseToReasoning(events), [events]);

  const startedAt = session?.started_at ?? session?.created_at ?? null;
  const running = session?.status === "queued" || session?.status === "running";
  const elapsedSec = useMemo(() => {
    if (!startedAt) return 0;
    return (Date.now() - Date.parse(startedAt)) / 1000;
  }, [startedAt]);

  // Pull artifacts (typed casts because Firestore returns unknown).
  const results: AgentResults = useMemo(
    () => ({
      brand_identity: artifacts.brand_identity as BrandIdentityResult | undefined,
      market_research: artifacts.market_research as MarketResearchResult | undefined,
      competitive_analysis: artifacts.competitive_analysis as CompetitiveAnalysisResult | undefined,
      landing_page: artifacts.landing_page as LandingPageResult | undefined,
      financial_model: artifacts.financial_model as FinancialModelResult | undefined,
      pitch_deck: artifacts.pitch_deck as PitchDeckResult | undefined,
      executive_summary: artifacts.executive_summary as ExecutiveSummaryResult | undefined,
    }),
    [artifacts],
  );

  // Mobile tab state.
  const [mobileTab, setMobileTab] = useState<"canvas" | "reasoning">("canvas");

  if (!sessionId) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-ink-950 text-ink-400">
        Missing session id.
      </main>
    );
  }

  if (loading && !session) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-ink-950 text-ink-400">
        <Spinner size={28} />
      </main>
    );
  }

  return (
    <main role="main" className="min-h-[100dvh] bg-ink-950 text-ink-100">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-30 grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 border-b border-ink-900 bg-ink-950/80 px-4 py-3 backdrop-blur md:px-6">
        <Timer
          startedAt={startedAt}
          running={running}
          {...(!running ? { frozenElapsedS: elapsedSec } : {})}
        />
        <ProgressBar total={ALL_AGENT_COUNT} completed={completed} />
        <span
          className="hidden font-mono text-[11px] tabular-nums text-ink-300 md:inline-flex md:items-center md:gap-1.5"
          title="Live cost telemetry"
          aria-live="polite"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
          ${(liveCostUsd ?? session?.cost.total_cost_usd ?? 0).toFixed(2)}
          <span className="text-ink-500">/ $2.50</span>
        </span>
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={!running || canceling}
          className={cn(
            "grid grid-cols-[auto_1fr] items-center gap-1.5 rounded-full border border-ink-800 bg-ink-900/60 px-3 py-1.5 text-xs text-ink-200 hover:border-rose-500/40 hover:text-rose-200 focus-ring",
            (!running || canceling) && "opacity-40 cursor-not-allowed",
          )}
        >
          {canceling ? <Pause className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          {canceling ? "Stopping…" : "Cancel"}
        </button>
      </div>

      {/* Mobile tab switch */}
      <div className="grid grid-cols-2 gap-1 border-b border-ink-900 bg-ink-950/60 p-1 lg:hidden">
        {(["canvas", "reasoning"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setMobileTab(t)}
            aria-pressed={mobileTab === t}
            className={cn(
              "grid grid-cols-[auto_1fr] items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium capitalize focus-ring",
              mobileTab === t ? "bg-accent-500 text-ink-950" : "text-ink-300 hover:text-ink-100",
            )}
          >
            {t === "canvas" ? <LayoutGrid className="h-3.5 w-3.5" /> : <ScrollText className="h-3.5 w-3.5" />}
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 px-4 py-6 md:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(380px,35%)]">
        <motion.section
          layout
          transition={SPRING}
          className={cn("min-h-[40dvh]", mobileTab !== "canvas" && "hidden lg:block")}
          aria-label="Live artifact canvas"
        >
          <ProgressiveCanvas
            brand={results.brand_identity ?? null}
            market={results.market_research ?? null}
            competition={results.competitive_analysis ?? null}
            landing={results.landing_page ?? null}
            finance={results.financial_model ?? null}
            deck={results.pitch_deck ?? null}
            exec={results.executive_summary ?? null}
            currentWave={currentWave}
          />
        </motion.section>

        <motion.aside
          layout
          transition={SPRING}
          className={cn(
            "min-h-[60dvh] overflow-hidden rounded-bento",
            mobileTab !== "reasoning" && "hidden lg:block",
          )}
          aria-label="Reasoning sidebar"
        >
          <ReasoningSidebar
            events={reasoningEvents}
            currentWave={currentWave}
            streaming={sseStatus === "open"}
            elapsedSec={elapsedSec}
            className="rounded-bento"
          />
        </motion.aside>

        <div className="lg:col-span-2">
          <AgentDashboard session={session} defaultCollapsed />
        </div>
      </div>

      {articulation && (
        <ArticulationStep
          open={articulationOpen}
          original={session?.idea_text ?? ""}
          output={articulation}
          onAccept={() => {
            articulationDismissedRef.current = true;
            setArticulationOpen(false);
          }}
          onKeepOriginal={() => {
            articulationDismissedRef.current = true;
            setArticulationOpen(false);
          }}
          onCancel={() => {
            articulationDismissedRef.current = true;
            setArticulationOpen(false);
          }}
        />
      )}
    </main>
  );
}

export default GeneratePage;
