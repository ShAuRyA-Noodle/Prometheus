/**
 * ResultsView — tabbed view for a completed session.
 *
 * Tabs (Cmd+1..9 shortcuts, URL hash sync):
 *   1. Executive Summary
 *   2. Brand
 *   3. Pitch Deck (lazy)
 *   4. Financial Model (lazy)
 *   5. Landing Page (lazy)
 *   6. Market
 *   7. Competitive
 *   8. Business Model
 *   9. GTM
 *   - Legal, Risks, Tech (overflow)
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Briefcase,
  Building,
  ChartLine,
  ClipboardCheck,
  Code2,
  Globe,
  Palette,
  Presentation,
  Rocket,
  Scale,
  ScrollText,
} from "lucide-react";

import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { cn } from "@/lib/cn";
import { Spinner } from "./MicroWidgets/Spinner";
import { ExecutiveSummaryView } from "./ExecutiveSummaryView";
import { MarketResearchView } from "./MarketResearchView";
import { CompetitiveView } from "./CompetitiveView";
import { BusinessModelView } from "./BusinessModelView";
import { LegalDocsView } from "./LegalDocsView";
import { RiskMatrixView } from "./RiskMatrixView";
import { TechArchView } from "./TechArchView";
import { GTMView } from "./GTMView";
import type { AgentResults } from "@/types/agents";

const DeckEditor = lazy(() =>
  import("./DeckEditor/DeckEditor").then((m) => ({ default: m.DeckEditor })),
);
const FinancialModelView = lazy(() =>
  import("./FinancialModel").catch(() => ({
    default: () => (
      <p className="rounded-2xl border border-ink-800 bg-ink-900/30 p-6 text-sm text-ink-400">
        Financial model editor unavailable in this build.
      </p>
    ),
  })),
);
const LandingEditorView = lazy(() =>
  import("./LandingEditor").catch(() => ({
    default: () => (
      <p className="rounded-2xl border border-ink-800 bg-ink-900/30 p-6 text-sm text-ink-400">
        Landing editor unavailable in this build.
      </p>
    ),
  })),
);
const BrandRefinerView = lazy(async () => {
  try {
    const mod = await import("./BrandRefiner");
    const def = (mod as { default?: unknown }).default ?? (mod as { BrandRefiner?: unknown }).BrandRefiner;
    if (def) return { default: def as React.ComponentType<{ brand: AgentResults["brand_identity"] }> };
    throw new Error("no default export");
  } catch {
    return {
    default: ({
      brand,
    }: {
      brand: AgentResults["brand_identity"];
    }) =>
      brand ? (
        <BrandReadOnly brand={brand} />
      ) : (
        <p className="rounded-2xl border border-ink-800 bg-ink-900/30 p-6 text-sm text-ink-400">
          Brand not available.
        </p>
      ),
    };
  }
});

interface ResultsViewProps {
  sessionId: string;
  results: AgentResults;
  onRegenAgent?: (
    agent: keyof AgentResults,
    steering: string,
    propagate: boolean,
  ) => Promise<void>;
  className?: string;
}

interface TabDef {
  id: string;
  hash: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hotkey?: string;
  available: boolean;
}

export function ResultsView({
  sessionId,
  results,
  className,
}: ResultsViewProps): JSX.Element {
  const tabs: TabDef[] = useMemo(
    () => [
      {
        id: "summary",
        hash: "summary",
        label: "Summary",
        icon: ScrollText,
        hotkey: "1",
        available: !!results.executive_summary,
      },
      {
        id: "brand",
        hash: "brand",
        label: "Brand",
        icon: Palette,
        hotkey: "2",
        available: !!results.brand_identity,
      },
      {
        id: "deck",
        hash: "deck",
        label: "Deck",
        icon: Presentation,
        hotkey: "3",
        available: !!results.pitch_deck,
      },
      {
        id: "model",
        hash: "model",
        label: "Financials",
        icon: Briefcase,
        hotkey: "4",
        available: !!results.financial_model,
      },
      {
        id: "landing",
        hash: "landing",
        label: "Landing",
        icon: Globe,
        hotkey: "5",
        available: !!results.landing_page,
      },
      {
        id: "market",
        hash: "market",
        label: "Market",
        icon: ChartLine,
        hotkey: "6",
        available: !!results.market_research,
      },
      {
        id: "competitive",
        hash: "competitive",
        label: "Competitive",
        icon: Building,
        hotkey: "7",
        available: !!results.competitive_analysis,
      },
      {
        id: "business",
        hash: "business",
        label: "Model",
        icon: ClipboardCheck,
        hotkey: "8",
        available: !!results.business_model,
      },
      {
        id: "gtm",
        hash: "gtm",
        label: "GTM",
        icon: Rocket,
        hotkey: "9",
        available: !!results.go_to_market,
      },
      { id: "legal", hash: "legal", label: "Legal", icon: Scale, available: !!results.legal_documents },
      { id: "risks", hash: "risks", label: "Risks", icon: AlertTriangle, available: !!results.risk_analysis },
      { id: "tech", hash: "tech", label: "Tech", icon: Code2, available: !!results.tech_architecture },
    ],
    [results],
  );

  // URL hash sync.
  const initialHash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
  const fallback = tabs.find((t) => t.available)?.id ?? "summary";
  const [active, setActive] = useState<string>(
    tabs.find((t) => t.hash === initialHash && t.available)?.id ?? fallback,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const newHash = tabs.find((t) => t.id === active)?.hash;
    if (newHash) window.history.replaceState(null, "", `#${newHash}`);
  }, [active, tabs]);

  const setActiveByHotkey = useCallback(
    (key: string) => {
      const t = tabs.find((tab) => tab.hotkey === key && tab.available);
      if (t) setActive(t.id);
    },
    [tabs],
  );

  useKeyboardShortcuts(
    tabs
      .filter((t) => t.hotkey && t.available)
      .map((t) => ({
        key: t.hotkey!,
        meta: true,
        handler: () => setActiveByHotkey(t.hotkey!),
      })),
  );

  return (
    <section className={cn("grid gap-4", className)} aria-label="Generated company results">
      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Result sections"
        className="overflow-x-auto rounded-bento border border-ink-800 bg-ink-900/40 p-1 backdrop-blur"
      >
        <div className="flex gap-0.5 sm:gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => t.available && setActive(t.id)}
              disabled={!t.available}
              className={cn(
                "grid shrink-0 grid-cols-[auto_1fr] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition focus-ring",
                active === t.id
                  ? "bg-accent-500 text-ink-950"
                  : t.available
                    ? "text-ink-300 hover:bg-ink-800 hover:text-ink-50"
                    : "cursor-not-allowed text-ink-600",
              )}
            >
              <t.icon className="h-3.5 w-3.5" aria-hidden />
              <span>{t.label}</span>
              {t.hotkey && (
                <kbd className="ml-1 hidden rounded border border-ink-800 bg-ink-950/40 px-1 font-mono text-[9px] text-ink-500 sm:inline-block">
                  ⌘{t.hotkey}
                </kbd>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Active panel */}
      <motion.div
        key={active}
        id={`panel-${active}`}
        role="tabpanel"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
        className="min-h-[40dvh]"
      >
        <Suspense
          fallback={
            <div className="grid place-items-center py-16 text-ink-500">
              <Spinner size={20} />
            </div>
          }
        >
          {active === "summary" && results.executive_summary && (
            <ExecutiveSummaryView exec={results.executive_summary} />
          )}
          {active === "brand" && results.brand_identity && (
            <BrandRefinerView brand={results.brand_identity} />
          )}
          {active === "deck" && results.pitch_deck && (
            <DeckEditor
              sessionId={sessionId}
              deck={results.pitch_deck}
              brand={results.brand_identity ?? null}
              onChange={() => {
                /* upstream owns persistence; no-op locally */
              }}
              onRegen={async () => ({
                changedSlideIndexes: [],
                titlePairs: [],
                steering: "",
                proposed: results.pitch_deck!,
              })}
            />
          )}
          {active === "model" && results.financial_model && (
            <FinancialModelView result={results.financial_model} />
          )}
          {active === "landing" && results.landing_page && (
            <LandingEditorView
              sessionId={sessionId}
              html={results.landing_page.html_sanitized}
              css={results.landing_page.css}
            />
          )}
          {active === "market" && results.market_research && (
            <MarketResearchView market={results.market_research} />
          )}
          {active === "competitive" && results.competitive_analysis && (
            <CompetitiveView competition={results.competitive_analysis} />
          )}
          {active === "business" && results.business_model && (
            <BusinessModelView model={results.business_model} />
          )}
          {active === "gtm" && results.go_to_market && <GTMView gtm={results.go_to_market} />}
          {active === "legal" && results.legal_documents && (
            <LegalDocsView legal={results.legal_documents} sessionId={sessionId} />
          )}
          {active === "risks" && results.risk_analysis && (
            <RiskMatrixView risk={results.risk_analysis} />
          )}
          {active === "tech" && results.tech_architecture && (
            <TechArchView arch={results.tech_architecture} />
          )}
        </Suspense>
      </motion.div>
    </section>
  );
}

// Lightweight read-only brand fallback. Used when BrandRefiner module is missing.
function BrandReadOnly({
  brand,
}: {
  brand: NonNullable<AgentResults["brand_identity"]>;
}): JSX.Element {
  return (
    <section className="grid gap-4">
      <p className="font-display text-3xl text-ink-50">{brand.company_name}</p>
      <p className="text-base text-ink-300">{brand.tagline}</p>
      <div className="flex h-12 overflow-hidden rounded-lg ring-1 ring-ink-800">
        {brand.color_palette.map((c) => (
          <div
            key={c.hex + c.role}
            style={{ background: c.hex }}
            className="flex-1"
            aria-label={`${c.role} ${c.hex}`}
          />
        ))}
      </div>
      <p className="rounded-2xl border border-ink-800 bg-ink-900/30 p-4 text-sm text-ink-300">
        {brand.brand_voice_sample_copy}
      </p>
    </section>
  );
}
