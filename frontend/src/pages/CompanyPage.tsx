/**
 * CompanyPage — single company detail.
 *
 * Sections (top → bottom):
 *  1. Hero (brand, tagline, primary metrics)
 *  2. Latest Run (link into ResultsPage)
 *  3. Branches (BranchingView)
 *  4. MarketWatch (weekly diffs)
 *  5. InvestorAnalytics (Pro+, paywalls inline)
 *  6. Marketplace upgrades (Lawyer, Designer, CFO, Growth)
 *  7. Activity timeline
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Building2,
  ChevronRight,
  Clock,
  ExternalLink,
  HandCoins,
  ScanLine,
  Sparkles,
  ShieldCheck,
  PenTool,
  Users,
} from "lucide-react";
import {
  collection,
  doc as firestoreDoc,
  onSnapshot,
  orderBy,
  query as fsQuery,
  limit as fsLimit,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { api, APIError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { Spinner } from "@/components/MicroWidgets/Spinner";
import { BranchingView } from "@/components/BranchingView";
import { MarketWatch } from "@/components/MarketWatch";
import { InvestorAnalytics } from "@/components/InvestorAnalytics";
import { MARKETPLACE_JOB_TYPES } from "@/lib/constants";
import { useTier } from "@/lib/billing";
import type { BrandIdentityResult, ExecutiveSummaryResult, FinancialModelResult } from "@/types/agents";

const SPRING = { type: "spring" as const, stiffness: 100, damping: 20 };

interface CompanyDoc {
  company_id: string;
  company_name: string;
  one_liner?: string;
  industry?: string;
  latest_session_id: string;
  created_at: string;
  updated_at: string;
}

interface ActivityEvent {
  id: string;
  type: string;
  message: string;
  at: string;
}

const MARKETPLACE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  lawyer_review: ShieldCheck,
  designer_polish: PenTool,
  fractional_cfo: HandCoins,
  growth_consult: Users,
};

export function CompanyPage(): JSX.Element {
  const { companyId = "" } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const { error: errorToast, success } = useToast();
  const { uid } = useAuth();
  const { hasTier, requireTier } = useTier();

  const [company, setCompany] = useState<CompanyDoc | null>(null);
  const [latestArtifacts, setLatestArtifacts] = useState<{
    brand?: BrandIdentityResult;
    finance?: FinancialModelResult;
    exec?: ExecutiveSummaryResult;
  }>({});
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Listen to company doc + latest artifacts.
  useEffect(() => {
    if (!companyId) return;
    const unsubCompany = onSnapshot(
      firestoreDoc(db, "companies", companyId),
      (snap) => {
        if (!snap.exists()) {
          setCompany(null);
          setLoading(false);
          return;
        }
        setCompany({ ...(snap.data() as CompanyDoc), company_id: snap.id });
        setLoading(false);
      },
      (err) => {
         
        console.warn("[company]", err);
        setLoading(false);
      },
    );
    return () => unsubCompany();
  }, [companyId]);

  // Activity feed.
  useEffect(() => {
    if (!companyId) return;
    const q = fsQuery(
      collection(db, "companies", companyId, "activity"),
      orderBy("at", "desc"),
      fsLimit(20),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const out: ActivityEvent[] = [];
        snap.forEach((d) => {
          const data = d.data();
          out.push({
            id: d.id,
            type: String(data.type ?? "event"),
            message: String(data.message ?? ""),
            at: String(data.at ?? new Date().toISOString()),
          });
        });
        setActivity(out);
      },
      () => undefined,
    );
    return () => unsub();
  }, [companyId]);

  // Latest run artifacts (brand + finance + exec).
  useEffect(() => {
    if (!company?.latest_session_id) return;
    const sid = company.latest_session_id;
    const ref = collection(db, "sessions", sid, "artifacts");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const next: typeof latestArtifacts = {};
        snap.forEach((d) => {
          const data = d.data();
          if (d.id === "brand_identity") next.brand = data as BrandIdentityResult;
          if (d.id === "financial_model") next.finance = data as FinancialModelResult;
          if (d.id === "executive_summary") next.exec = data as ExecutiveSummaryResult;
        });
        setLatestArtifacts(next);
      },
      () => undefined,
    );
    return () => unsub();
     
  }, [company?.latest_session_id]);

  const handleOrder = async (jobType: string) => {
    if (!company?.latest_session_id) return;
    const ok = hasTier("founder")
      ? true
      : requireTier("founder", "Marketplace orders are a Founder-tier feature.");
    if (!ok) return;
    try {
      await api.marketplaceOrder({
        session_id: company.latest_session_id,
        job_type: jobType,
      });
      success("Order placed", "We'll match you with a vetted expert within 24 hours.");
    } catch (e) {
      const msg =
        e instanceof APIError ? e.message : e instanceof Error ? e.message : "Order failed";
      errorToast("Could not place order", msg);
    }
  };

  if (loading) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-ink-950 text-ink-400">
        <Spinner size={28} />
      </main>
    );
  }

  if (!company) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-ink-950 text-ink-400">
        Company not found.{" "}
        <Link to="/companies" className="ml-2 text-accent-500 underline-offset-2 hover:underline">
          Back to all companies
        </Link>
      </main>
    );
  }

  const brand = latestArtifacts.brand;
  const finance = latestArtifacts.finance;
  const exec = latestArtifacts.exec;

  return (
    <main role="main" className="min-h-[100dvh] bg-ink-950 text-ink-100">
      <header className="sticky top-0 z-30 grid grid-cols-[1fr_auto] items-center gap-3 border-b border-ink-900 bg-ink-950/80 px-4 py-3 backdrop-blur md:px-6">
        <Link to="/companies" className="text-xs text-ink-400 hover:text-ink-100 focus-ring">
          ← Companies
        </Link>
        <button
          type="button"
          onClick={() => navigate(`/results/${encodeURIComponent(company.latest_session_id)}`)}
          className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-full bg-accent-500 px-4 py-1.5 text-xs font-semibold text-ink-950 hover:bg-accent-400 focus-ring"
        >
          Open latest run
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 md:px-6">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING}
          className="grid grid-cols-1 gap-4 rounded-bento border border-ink-800 bg-ink-900/40 p-6 shadow-bento md:grid-cols-[1.4fr_1fr]"
        >
          <div className="grid gap-3">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-ink-800 bg-ink-950 px-3 py-1 text-[11px] uppercase tracking-widest text-accent-500">
              <Sparkles className="h-3 w-3" />
              {company.industry ?? "Company"}
            </span>
            <h1 className="font-display text-5xl leading-[0.95] text-ink-50 md:text-6xl">
              {brand?.company_name ?? company.company_name}
            </h1>
            <p className="max-w-prose text-base text-ink-400">
              {brand?.tagline ?? exec?.one_liner ?? company.one_liner ?? "No tagline yet."}
            </p>
            {brand?.color_palette && (
              <div className="flex h-8 w-full max-w-md overflow-hidden rounded-full ring-1 ring-ink-800">
                {brand.color_palette.map((c) => (
                  <div
                    key={c.hex + c.role}
                    style={{ background: c.hex }}
                    className="flex-1"
                    aria-label={`${c.role} ${c.hex}`}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric
              label="Last run"
              value={new Date(company.updated_at).toLocaleDateString()}
            />
            {finance?.runway_months != null && (
              <Metric
                label="Runway"
                value={`${Math.round(finance.runway_months)} mo`}
              />
            )}
            {finance?.breakeven_month != null && (
              <Metric label="Breakeven" value={`Mo ${finance.breakeven_month}`} />
            )}
            {exec?.coherence_score != null && (
              <Metric
                label="Coherence"
                value={`${(exec.coherence_score * 100).toFixed(0)}%`}
              />
            )}
          </div>
        </motion.section>

        {/* Branches */}
        <BranchingView
          parentSessionId={company.latest_session_id}
          parentName={brand?.company_name ?? company.company_name}
          onOpen={(sid) => navigate(`/results/${encodeURIComponent(sid)}`)}
          onCreateBranch={() => navigate(`/results/${encodeURIComponent(company.latest_session_id)}#branch`)}
        />

        {/* MarketWatch + Investor Analytics */}
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <MarketWatch companyId={company.company_id} />
          <InvestorAnalytics sessionId={company.latest_session_id} />
        </div>

        {/* Marketplace upgrades */}
        <section aria-labelledby="market-title" className="grid gap-3">
          <header className="grid grid-cols-[1fr_auto] items-baseline gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-accent-500">Upgrades</p>
              <h2 id="market-title" className="font-display text-2xl text-ink-50">
                Hand off to a real expert.
              </h2>
            </div>
            {!uid && (
              <Link to="/login" className="text-xs text-ink-400 hover:text-ink-100 focus-ring">
                Sign in to order
              </Link>
            )}
          </header>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {MARKETPLACE_JOB_TYPES.map((job) => {
              const Icon = MARKETPLACE_ICONS[job.id] ?? ScanLine;
              return (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => void handleOrder(job.id)}
                    className="group grid h-full w-full grid-rows-[auto_1fr_auto] gap-2 rounded-2xl border border-ink-800 bg-ink-900/40 p-4 text-left transition hover:border-accent-500/40 focus-ring"
                  >
                    <header className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                      <Icon className="h-4 w-4 text-accent-500" />
                      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-500">
                        {job.sla_hours}h SLA
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-ink-500 transition group-hover:translate-x-0.5" />
                    </header>
                    <p className="text-sm font-semibold text-ink-100">{job.label}</p>
                    <p className="text-[12px] text-ink-400">{job.blurb}</p>
                    <p className="font-mono text-xs tabular-nums text-ink-300">
                      ${job.base_price_usd}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Activity */}
        <section aria-labelledby="activity-title" className="grid gap-3">
          <header>
            <p className="text-[11px] uppercase tracking-widest text-accent-500">Activity</p>
            <h2 id="activity-title" className="font-display text-2xl text-ink-50">
              Timeline
            </h2>
          </header>
          {activity.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-ink-800 bg-ink-950/40 p-6 text-center text-xs text-ink-500">
              No events recorded yet. Branches, regenerations, and market watches all appear here.
            </p>
          ) : (
            <ul className="grid gap-2">
              {activity.map((e) => (
                <li
                  key={e.id}
                  className="grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-2xl border border-ink-800 bg-ink-900/30 px-3 py-2"
                >
                  <Clock className="mt-1 h-3.5 w-3.5 text-ink-500" />
                  <p className="text-sm text-ink-200">{e.message}</p>
                  <time className="font-mono text-[10px] tabular-nums text-ink-500">
                    {new Date(e.at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-xl border border-ink-800 bg-ink-950/40 p-3 text-[12px] text-ink-500">
          <Building2 className="h-3.5 w-3.5 text-accent-500" />
          <a
            href={`/results/${encodeURIComponent(company.latest_session_id)}`}
            className="hover:text-ink-100 focus-ring"
          >
            Open the latest run for full edits.
            <ExternalLink className="ml-1 inline-block h-3 w-3" aria-hidden />
          </a>
        </p>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-2xl border border-ink-800 bg-ink-950/40 p-3">
      <span className="text-[10px] uppercase tracking-widest text-ink-500">{label}</span>
      <span className="font-display text-2xl tabular-nums text-ink-50">{value}</span>
    </div>
  );
}

export default CompanyPage;
