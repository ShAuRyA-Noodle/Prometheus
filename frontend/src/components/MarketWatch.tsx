/**
 * MarketWatch — weekly market diff feed for a saved company.
 *
 * Subscribes via Firestore listener on companies/{id}/market_watch.
 * Each event: timestamp, type (new_competitor | funding_event | market_shift |
 * trend), title, description, optional delta.
 */
import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query as fsQuery, limit } from "firebase/firestore";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Banknote,
  ChevronRight,
  Compass,
  Eye,
  GitBranchPlus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { db } from "@/lib/firebase";

const SPRING = { type: "spring" as const, stiffness: 100, damping: 20 };

type WatchType = "new_competitor" | "funding_event" | "market_shift" | "trend" | "news";

interface MarketWatchEntry {
  id: string;
  type: WatchType;
  title: string;
  description: string;
  source_url?: string;
  delta?: number; // signed % delta
  observed_at: string;
}

interface MarketWatchProps {
  companyId: string;
  className?: string;
  /** Click handler for entries — usually opens the source URL or branch dialog. */
  onEntryClick?: (entry: MarketWatchEntry) => void;
}

const TYPE_META: Record<
  WatchType,
  { icon: React.ComponentType<{ className?: string }>; tint: string; label: string }
> = {
  new_competitor: {
    icon: GitBranchPlus,
    tint: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    label: "New competitor",
  },
  funding_event: {
    icon: Banknote,
    tint: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    label: "Funding",
  },
  market_shift: {
    icon: Compass,
    tint: "text-accent-500 bg-accent-500/10 border-accent-500/30",
    label: "Market shift",
  },
  trend: {
    icon: TrendingUp,
    tint: "text-sky-300 bg-sky-500/10 border-sky-500/30",
    label: "Trend",
  },
  news: {
    icon: AlertCircle,
    tint: "text-ink-300 bg-ink-800 border-ink-700",
    label: "News",
  },
};

export function MarketWatch({ companyId, className, onEntryClick }: MarketWatchProps): JSX.Element {
  const [entries, setEntries] = useState<MarketWatchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    const q = fsQuery(
      collection(db, "companies", companyId, "market_watch"),
      orderBy("observed_at", "desc"),
      limit(20),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const out: MarketWatchEntry[] = [];
        snap.forEach((d) => {
          const data = d.data();
          out.push({
            id: d.id,
            type: (data.type as WatchType) ?? "news",
            title: String(data.title ?? "Untitled"),
            description: String(data.description ?? ""),
            ...(typeof data.source_url === "string" ? { source_url: data.source_url } : {}),
            ...(typeof data.delta === "number" ? { delta: data.delta } : {}),
            observed_at: String(data.observed_at ?? new Date().toISOString()),
          });
        });
        setEntries(out);
        setLoading(false);
        setError(null);
      },
      (err) => {
         
        console.warn("[market-watch] listener error", err);
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [companyId]);

  return (
    <section
      aria-label="Market watch"
      className={cn(
        "grid gap-3 rounded-bento border border-ink-800 bg-ink-900/30 p-5",
        className,
      )}
    >
      <header className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-500/15 text-accent-500">
          <Eye className="h-4 w-4" />
        </span>
        <div>
          <span className="text-[11px] uppercase tracking-widest text-ink-500">
            Market watch
          </span>
          <p className="font-display text-base text-ink-100">Weekly diffs for this company</p>
        </div>
        <span className="font-mono text-xs tabular-nums text-ink-500">{entries.length}</span>
      </header>

      {loading && <p className="text-xs text-ink-500">Watching the market…</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}

      {!loading && entries.length === 0 && (
        <p className="rounded-xl border border-dashed border-ink-800 bg-ink-950/40 px-4 py-6 text-center text-xs text-ink-500">
          No watch events yet. Crawls run weekly across CB Insights, Crunchbase, and Statista.
        </p>
      )}

      <ul className="grid gap-2">
        {entries.map((e, i) => {
          const meta = TYPE_META[e.type];
          const Icon = meta.icon;
          return (
            <motion.li
              key={e.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: i * 0.02 }}
            >
              <button
                type="button"
                onClick={() => onEntryClick?.(e)}
                className={cn(
                  "grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 rounded-2xl border bg-ink-900/40 p-3 text-left transition hover:border-accent-500/40 focus-ring",
                  meta.tint.includes("border-") ? "" : "border-ink-800",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full border",
                    meta.tint,
                  )}
                  aria-hidden
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 grid gap-0.5">
                  <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                    <span className={cn("text-[10px] uppercase tracking-wider", meta.tint.split(" ")[0])}>
                      {meta.label}
                    </span>
                    {typeof e.delta === "number" && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 text-[10px] font-mono",
                          e.delta >= 0 ? "text-emerald-400" : "text-red-400",
                        )}
                      >
                        {e.delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {(e.delta * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <span className="truncate text-sm font-semibold text-ink-100">{e.title}</span>
                  <span className="line-clamp-2 text-[12px] text-ink-400">{e.description}</span>
                  <time className="text-[10px] font-mono tabular-nums text-ink-500">
                    {new Date(e.observed_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                </div>
                <ChevronRight className="mt-2 h-3.5 w-3.5 text-ink-500" />
              </button>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}
