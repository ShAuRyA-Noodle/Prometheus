/**
 * TechArchView — recommended stack, mermaid diagram, MVP scope, infra cost.
 *
 * Mermaid: we attempt to render via dynamically-loaded mermaid; if unavailable
 * (no JS sandbox) we fall back to a code block render.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Code2, Hammer, Lock, Server } from "lucide-react";

import { cn } from "@/lib/cn";
import { DataPoint } from "./DataPoint";
import type { TechArchitectureResult } from "@/types/agents";

const SPRING = { type: "spring" as const, stiffness: 100, damping: 20 };

interface TechArchViewProps {
  arch: TechArchitectureResult;
  className?: string;
}

export function TechArchView({ arch, className }: TechArchViewProps): JSX.Element {
  return (
    <section className={cn("grid gap-6", className)} aria-label="Tech architecture">
      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
        <MermaidDiagram source={arch.architecture_diagram_mermaid} />
        <div className="grid gap-3">
          <article className="rounded-bento border border-ink-800 bg-ink-900/40 p-4 shadow-bento">
            <header className="grid grid-cols-[auto_1fr] items-center gap-2">
              <Code2 className="h-3.5 w-3.5 text-accent-500" />
              <span className="text-[10px] uppercase tracking-widest text-ink-500">
                Recommended stack
              </span>
            </header>
            <ul className="mt-3 grid grid-cols-2 gap-1.5 text-[12px]">
              {Object.entries(arch.recommended_stack).map(([layer, tech]) => (
                <li
                  key={layer}
                  className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-md border border-ink-800 bg-ink-950/40 px-2 py-1"
                >
                  <span className="text-[10px] uppercase tracking-wider text-ink-500">{layer}</span>
                  <span className="truncate text-ink-100">{tech}</span>
                </li>
              ))}
            </ul>
          </article>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Dev weeks" value={`${arch.estimated_dev_weeks}`} />
            <Stat label="Team size" value={`${arch.estimated_team_size}`} />
            <Stat label="Cost / mo" value={null} dataPoint={arch.monthly_infra_cost_usd_estimate} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <motion.article
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING}
          className="grid gap-2 rounded-bento border border-accent-500/30 bg-accent-500/5 p-5"
        >
          <header className="grid grid-cols-[auto_1fr] items-center gap-2 text-[11px] uppercase tracking-widest text-accent-500">
            <Hammer className="h-3.5 w-3.5" />
            MVP — Core
          </header>
          <ul className="grid gap-1.5">
            {arch.mvp_core_features.map((f, i) => (
              <li key={i} className="grid grid-cols-[auto_1fr] items-start gap-2 text-sm text-ink-100">
                <span className="mt-0.5 grid h-4 w-4 place-items-center rounded-full bg-accent-500/30 text-[9px] font-bold text-accent-500">
                  ✓
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </motion.article>
        <motion.article
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: 0.04 }}
          className="grid gap-2 rounded-bento border border-ink-800 bg-ink-900/30 p-5"
        >
          <header className="grid grid-cols-[auto_1fr] items-center gap-2 text-[11px] uppercase tracking-widest text-ink-500">
            <Server className="h-3.5 w-3.5" />
            Nice to have
          </header>
          <ul className="grid gap-1.5">
            {arch.mvp_nice_to_have.length > 0 ? (
              arch.mvp_nice_to_have.map((f, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[auto_1fr] items-start gap-2 text-sm text-ink-300"
                >
                  <span className="mt-1 h-1 w-1 rounded-full bg-ink-500" />
                  <span>{f}</span>
                </li>
              ))
            ) : (
              <li className="text-xs text-ink-500">None — keep it lean.</li>
            )}
          </ul>
        </motion.article>
      </div>

      <article className="grid gap-2 rounded-bento border border-ink-800 bg-ink-900/30 p-5">
        <header className="grid grid-cols-[auto_1fr] items-center gap-2 text-[11px] uppercase tracking-widest text-ink-500">
          <Lock className="h-3.5 w-3.5 text-accent-500" />
          Security considerations
        </header>
        <ul className="grid gap-1.5">
          {arch.security_considerations.map((s, i) => (
            <li key={i} className="grid grid-cols-[auto_1fr] items-start gap-2 text-sm text-ink-200">
              <span className="mt-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-500/20 text-[9px] font-bold text-emerald-300">
                ⌗
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}

function Stat({
  label,
  value,
  dataPoint,
}: {
  label: string;
  value: string | null;
  dataPoint?: TechArchitectureResult["monthly_infra_cost_usd_estimate"];
}): JSX.Element {
  return (
    <article className="grid gap-1 rounded-2xl border border-ink-800 bg-ink-900/40 p-3 shadow-bento">
      <span className="text-[10px] uppercase tracking-wider text-ink-500">{label}</span>
      {value ? (
        <span className="font-display text-2xl tabular-nums text-ink-50">{value}</span>
      ) : dataPoint ? (
        <DataPoint point={dataPoint} size="md" />
      ) : null}
    </article>
  );
}

function MermaidDiagram({ source }: { source: string }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Dynamically import Mermaid only when available — keep main bundle lean.
        const mod = (await import(/* @vite-ignore */ "mermaid").catch(() => null)) as {
          default?: { initialize: (cfg: object) => void; render: (id: string, code: string) => Promise<{ svg: string }> };
        } | null;
        if (!mod?.default) {
          setErrored(true);
          return;
        }
        mod.default.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
          fontFamily: "Geist, system-ui, sans-serif",
        });
        const id = `m-${Math.random().toString(36).slice(2, 9)}`;
        const out = await mod.default.render(id, source);
        if (!cancelled) setSvg(out.svg);
      } catch {
        if (!cancelled) setErrored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <article className="rounded-bento border border-ink-800 bg-ink-900/40 p-3 shadow-bento">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-ink-500">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
        Architecture diagram
      </div>
      {svg ? (
        // svg is rendered by mermaid with securityLevel "strict", which runs its
        // own DOMPurify pass and strips scripts/event handlers from the agent-provided
        // diagram source before producing the SVG markup.
        <div
          ref={ref}
          className="grid place-items-center overflow-x-auto rounded-lg bg-ink-950/60 p-3 [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : errored ? (
        <pre className="overflow-x-auto rounded-lg bg-ink-950/60 p-3 text-[11px] leading-snug text-ink-300">
          {source}
        </pre>
      ) : (
        <div className="grid h-40 place-items-center text-xs text-ink-500">Rendering diagram…</div>
      )}
    </article>
  );
}
