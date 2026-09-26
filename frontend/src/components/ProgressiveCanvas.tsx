/**
 * ProgressiveCanvas — center canvas of GeneratePage.
 *
 * Renders artifacts AS THEY COMPLETE. Each wave's tile materializes on its
 * own:
 *   Wave 1 → BrandTile (palette + name + tagline) + ResearchSnapshotTile
 *   Wave 2 → LandingPreviewTile (sandboxed iframe morphs in via morphdom)
 *   Wave 3 → DeckStripTile (slide thumbnails)
 *
 * Layout is a CSS Grid bento — asymmetric per taste-skill rules. Framer
 * Motion `LayoutGroup` smooths the cross-tile reflow as new tiles appear.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import morphdom from "morphdom";
import {
  Briefcase,
  ChartLine,
  GalleryHorizontalEnd,
  Globe2,
  Palette,
  ScrollText,
  Sparkles,
} from "lucide-react";
import type {
  BrandIdentityResult,
  CompetitiveAnalysisResult,
  ExecutiveSummaryResult,
  FinancialModelResult,
  LandingPageResult,
  MarketResearchResult,
  PitchDeckResult,
} from "../types/agents";
import { PurifiedHTML } from "./Sandbox/PurifiedHTML";
import { DataPoint, formatCurrency } from "./DataPoint";
import { buildSandboxedDoc } from "../lib/purify";
import { cn } from "../lib/cn";

const SPRING = { type: "spring" as const, stiffness: 100, damping: 20 };

export interface ProgressiveCanvasProps {
  brand: BrandIdentityResult | null;
  market: MarketResearchResult | null;
  competition: CompetitiveAnalysisResult | null;
  landing: LandingPageResult | null;
  finance: FinancialModelResult | null;
  deck: PitchDeckResult | null;
  exec: ExecutiveSummaryResult | null;
  /** 1 / 2 / 3 — used to gate skeletons. */
  currentWave: number;
  className?: string;
}

export function ProgressiveCanvas({
  brand,
  market,
  competition,
  landing,
  finance,
  deck,
  exec,
  currentWave,
  className,
}: ProgressiveCanvasProps): JSX.Element {
  const prefersReduced = useReducedMotion();

  return (
    <LayoutGroup id="progressive-canvas">
      <section
        aria-label="Generated company artifacts"
        className={cn(
          // Asymmetric bento: 12-col grid, tiles span variable widths.
          "grid w-full auto-rows-[minmax(180px,auto)] grid-cols-12 gap-4",
          className,
        )}
      >
        {/* Wave 1 tiles */}
        <BrandTile brand={brand} prefersReduced={Boolean(prefersReduced)} />
        <MarketTile
          market={market}
          competition={competition}
          prefersReduced={Boolean(prefersReduced)}
        />

        {/* Wave 2 tile — landing preview */}
        <LandingTile landing={landing} prefersReduced={Boolean(prefersReduced)} />
        <FinanceTile finance={finance} prefersReduced={Boolean(prefersReduced)} />

        {/* Wave 3 tiles */}
        <DeckStripTile deck={deck} brand={brand} prefersReduced={Boolean(prefersReduced)} />
        <ExecSummaryTile exec={exec} prefersReduced={Boolean(prefersReduced)} />

        {/* Skeleton for waves still pending */}
        {!brand && currentWave < 1 && <PendingTile label="Wave 1 — discovery" wave={1} />}
        {!landing && currentWave < 2 && <PendingTile label="Wave 2 — assets" wave={2} />}
        {!deck && currentWave < 3 && <PendingTile label="Wave 3 — narrative" wave={3} />}
      </section>
    </LayoutGroup>
  );
}

// ─── Tile primitive ──────────────────────────────────────────────────────────

interface TileProps {
  prefersReduced: boolean;
  span: string; // tailwind col-span class string
  rowSpan?: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  accent?: string;
}

const Tile = memo(function Tile({
  prefersReduced,
  span,
  rowSpan,
  title,
  icon,
  children,
  accent,
}: TileProps) {
  return (
    <motion.article
      layout
      initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={SPRING}
      className={cn(
        "group relative overflow-hidden rounded-bento border border-ink-800 bg-ink-900/70 p-5 shadow-bento backdrop-blur",
        span,
        rowSpan,
      )}
      style={accent ? { ["--tile-accent" as string]: accent } : undefined}
    >
      <header className="mb-3 grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink-800 text-ink-300">
          {icon}
        </span>
        <h3 className="font-display text-sm font-medium uppercase tracking-wide text-ink-300">
          {title}
        </h3>
      </header>
      {children}
    </motion.article>
  );
});

// ─── Brand tile ──────────────────────────────────────────────────────────────

const BrandTile = memo(function BrandTile({
  brand,
  prefersReduced,
}: {
  brand: BrandIdentityResult | null;
  prefersReduced: boolean;
}) {
  if (!brand) return null;
  const primary = brand.color_palette.find((c) => c.role === "primary") ?? brand.color_palette[0];
  return (
    <Tile
      prefersReduced={prefersReduced}
      span="col-span-12 md:col-span-7 lg:col-span-5"
      rowSpan="row-span-2"
      title="Brand"
      icon={<Palette size={14} />}
      accent={primary?.hex}
    >
      <div className="grid gap-4">
        <div>
          <p className="font-display text-4xl font-medium text-ink-50 md:text-5xl">{brand.company_name}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-400">{brand.tagline}</p>
        </div>
        <div className="flex h-12 overflow-hidden rounded-lg ring-1 ring-ink-800">
          {brand.color_palette.map((c) => (
            <div
              key={c.hex + c.role}
              className="grid flex-1 place-items-end p-1.5"
              style={{ background: c.hex }}
              aria-label={`${c.role} ${c.hex}`}
            >
              <span
                className="font-mono text-[9px] uppercase tracking-widest"
                style={{ color: contrastText(c.hex) }}
              >
                {c.hex.slice(1)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {brand.brand_voice_traits.slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded-full border border-ink-700 bg-ink-800/70 px-2.5 py-0.5 text-[11px] text-ink-200"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </Tile>
  );
});

// ─── Market tile ─────────────────────────────────────────────────────────────

const MarketTile = memo(function MarketTile({
  market,
  competition,
  prefersReduced,
}: {
  market: MarketResearchResult | null;
  competition: CompetitiveAnalysisResult | null;
  prefersReduced: boolean;
}) {
  if (!market) return null;
  return (
    <Tile
      prefersReduced={prefersReduced}
      span="col-span-12 md:col-span-5 lg:col-span-4"
      rowSpan="row-span-2"
      title="Market"
      icon={<ChartLine size={14} />}
    >
      <div className="grid grid-cols-2 gap-3">
        <DataPoint point={market.tam} size="lg" />
        <DataPoint point={market.sam} size="lg" />
        <DataPoint point={market.som} size="lg" />
        <DataPoint point={market.cagr} size="lg" />
      </div>
      {competition && (
        <div className="mt-4 border-t border-ink-800 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            {competition.competitors.length} competitors · {competition.market_concentration}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-300">
            {competition.competitors.slice(0, 4).map((c) => (
              <li key={c.name} className="flex items-center justify-between">
                <span className="truncate">{c.name}</span>
                {c.funding && (
                  <span className="font-mono tabular-nums text-ink-500">
                    {typeof c.funding.value === "number"
                      ? formatCurrency(c.funding.value)
                      : c.funding.value}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tile>
  );
});

// ─── Landing preview tile (morphdom) ─────────────────────────────────────────

const LandingTile = memo(function LandingTile({
  landing,
  prefersReduced,
}: {
  landing: LandingPageResult | null;
  prefersReduced: boolean;
}) {
  // Use morphdom to incrementally apply HTML changes without flashing.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastDocRef = useRef<string>("");
  const doc = useMemo(
    () => (landing ? buildSandboxedDoc(landing.html_sanitized, landing.css) : ""),
    [landing],
  );

  useEffect(() => {
    if (!landing) return;
    const ifr = iframeRef.current;
    if (!ifr) return;
    // Only morph if iframe has loaded once (we have access to its doc).
    // Cross-origin (sandboxed without same-origin) → fallback to srcDoc swap.
    try {
      const innerDoc = ifr.contentDocument;
      if (innerDoc && lastDocRef.current && doc !== lastDocRef.current) {
        const parser = new DOMParser();
        const next = parser.parseFromString(doc, "text/html");
        morphdom(innerDoc.documentElement, next.documentElement, {
          onBeforeElUpdated: (fromEl, toEl) =>
            !(fromEl instanceof Element && fromEl.isEqualNode(toEl)),
        });
        lastDocRef.current = doc;
        return;
      }
    } catch {
      // Sandboxed origin denies access → silently fall through to srcDoc swap.
    }
    lastDocRef.current = doc;
  }, [doc, landing]);

  if (!landing) return null;

  return (
    <Tile
      prefersReduced={prefersReduced}
      span="col-span-12 lg:col-span-8"
      rowSpan="row-span-3"
      title="Landing Page"
      icon={<Globe2 size={14} />}
    >
      <div className="overflow-hidden rounded-xl border border-ink-800 bg-ink-950">
        <iframe
          ref={iframeRef}
          srcDoc={doc}
          sandbox="allow-forms"
          referrerPolicy="no-referrer"
          title={landing.title}
          loading="lazy"
          className="block h-[420px] w-full bg-ink-950"
        />
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-2 text-[12px] text-ink-400">
        <span className="truncate">{landing.meta_description}</span>
        {landing.deploy_url && (
          <a
            href={String(landing.deploy_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] text-accent hover:underline"
          >
            {new URL(String(landing.deploy_url)).hostname}
          </a>
        )}
      </div>
    </Tile>
  );
});

// ─── Finance tile ────────────────────────────────────────────────────────────

const FinanceTile = memo(function FinanceTile({
  finance,
  prefersReduced,
}: {
  finance: FinancialModelResult | null;
  prefersReduced: boolean;
}) {
  if (!finance) return null;
  const lastYear = finance.projections[finance.projections.length - 1];
  return (
    <Tile
      prefersReduced={prefersReduced}
      span="col-span-12 md:col-span-6 lg:col-span-4"
      title="Financials"
      icon={<Briefcase size={14} />}
    >
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Y3 Revenue" value={lastYear ? formatCurrency(lastYear.revenue_usd) : "—"} />
        <Metric label="Runway" value={`${Math.round(finance.runway_months)} mo`} />
        <Metric
          label="Breakeven"
          value={finance.breakeven_month ? `Mo ${finance.breakeven_month}` : "Year 4+"}
        />
        <Metric label="Seed" value={formatCurrency(finance.funding_seed_usd)} />
      </div>
    </Tile>
  );
});

// ─── Deck strip ──────────────────────────────────────────────────────────────

const DeckStripTile = memo(function DeckStripTile({
  deck,
  brand,
  prefersReduced,
}: {
  deck: PitchDeckResult | null;
  brand: BrandIdentityResult | null;
  prefersReduced: boolean;
}) {
  if (!deck) return null;
  const primary = brand?.color_palette.find((c) => c.role === "primary")?.hex ?? "#FF5A1F";
  return (
    <Tile
      prefersReduced={prefersReduced}
      span="col-span-12"
      title={`Pitch Deck · ${deck.slides.length} slides`}
      icon={<GalleryHorizontalEnd size={14} />}
    >
      <ol className="grid grid-flow-col auto-cols-[180px] gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {deck.slides.map((slide) => (
          <motion.li
            key={slide.slide_number}
            layout
            initial={prefersReduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING}
            className="aspect-video shrink-0 overflow-hidden rounded-md border border-ink-800 bg-ink-950"
          >
            <div
              className="grid h-full w-full grid-rows-[auto_1fr] p-2"
              style={{ background: `linear-gradient(180deg, ${primary}10 0%, transparent 60%)` }}
            >
              <div className="text-[8px] font-mono uppercase tracking-widest text-ink-500">
                {slide.layout} · {slide.slide_number}
              </div>
              <div className="mt-1 line-clamp-3 font-display text-[11px] leading-tight text-ink-100">
                {slide.title}
              </div>
            </div>
          </motion.li>
        ))}
      </ol>
    </Tile>
  );
});

// ─── Exec summary tile ───────────────────────────────────────────────────────

const ExecSummaryTile = memo(function ExecSummaryTile({
  exec,
  prefersReduced,
}: {
  exec: ExecutiveSummaryResult | null;
  prefersReduced: boolean;
}) {
  if (!exec) return null;
  return (
    <Tile
      prefersReduced={prefersReduced}
      span="col-span-12 lg:col-span-8"
      title="Executive Summary"
      icon={<ScrollText size={14} />}
    >
      <p className="font-display text-2xl leading-snug text-ink-50">{exec.one_liner}</p>
      <PurifiedHTML
        html={exec.summary_text.replaceAll("\n", "<br/>")}
        prose={false}
        className="mt-3 text-[13.5px] leading-relaxed text-ink-300"
      />
      <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-500">
        <Sparkles size={11} />
        <span>coherence {(exec.coherence_score * 100).toFixed(0)}%</span>
      </div>
    </Tile>
  );
});

// ─── Pending placeholder ─────────────────────────────────────────────────────

function PendingTile({ label, wave }: { label: string; wave: number }): JSX.Element {
  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-bento border border-dashed border-ink-800 bg-ink-900/30 p-5",
        wave === 1 && "col-span-12 md:col-span-7 lg:col-span-5 row-span-2",
        wave === 2 && "col-span-12 lg:col-span-8 row-span-3",
        wave === 3 && "col-span-12",
      )}
      aria-hidden="true"
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-ink-600">
        <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-ink-500" />
        {label}
      </div>
      <div className="mt-3 grid gap-2">
        <div className="h-3 w-2/3 rounded bg-ink-800/60" />
        <div className="h-3 w-1/2 rounded bg-ink-800/40" />
        <div className="h-3 w-3/5 rounded bg-ink-800/50" />
      </div>
    </article>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{label}</span>
      <span className="font-display text-2xl font-medium tabular-nums text-ink-50">{value}</span>
    </div>
  );
}

/**
 * Pick black or white for text overlay on a swatch based on YIQ luminance.
 * Not perfect WCAG, but good enough for the swatch label.
 */
function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#000";
  const v = parseInt(m[1]!, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? "#0A0A0A" : "#FAFAFA";
}
