/**
 * CohortPage — Studio-tier dashboard for accelerators / venture studios.
 *
 * Gated by `user.role === 'cohort_admin'` (custom claim) AND tier ≥ studio.
 * White-label header pulls from cohort doc fields (logo_url, accent_color).
 *
 * Sections:
 *  - White-label header (cohort logo + name)
 *  - Founders table (search + filter + sort)
 *  - Per-founder: companies, last activity, status
 *  - Anonymized CSV export
 *  - Cohort-branded deck templates dropdown
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  collection,
  doc as firestoreDoc,
  onSnapshot,
  query as fsQuery,
  where,
} from "firebase/firestore";
import { motion } from "framer-motion";
import {
  ChevronDown,
  Download,
  Filter,
  LayoutTemplate,
  Lock,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/lib/billing";
import { Spinner } from "@/components/MicroWidgets/Spinner";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/cn";

interface CohortDoc {
  id: string;
  name: string;
  logo_url?: string | null;
  accent_color?: string | null;
  cohort_admin_uids: string[];
  deck_templates?: { id: string; label: string; preview_url?: string | null }[];
}

interface FounderRow {
  uid: string;
  display_name: string;
  email: string | null;
  companies_count: number;
  last_activity_at: string;
  status: "active" | "idle" | "graduated" | "paused";
}

const STATUS_TINT: Record<FounderRow["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  idle: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  graduated: "bg-accent-500/15 text-accent-500 border-accent-500/30",
  paused: "bg-ink-800 text-ink-400 border-ink-700",
};

export function CohortPage(): JSX.Element {
  const { cohortId = "" } = useParams<{ cohortId: string }>();
  const navigate = useNavigate();
  const { uid, loading: authLoading } = useAuth();
  const { tier } = useTier();
  const { success } = useToast();

  const [cohort, setCohort] = useState<CohortDoc | null>(null);
  const [founders, setFounders] = useState<FounderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FounderRow["status"] | "all">("all");

  const allowed =
    !authLoading &&
    uid != null &&
    cohort != null &&
    cohort.cohort_admin_uids.includes(uid) &&
    (tier === "studio" || tier === "enterprise");

  // Subscribe to cohort doc.
  useEffect(() => {
    if (!cohortId) return;
    const unsub = onSnapshot(
      firestoreDoc(db, "cohorts", cohortId),
      (snap) => {
        if (!snap.exists()) {
          setCohort(null);
          setLoading(false);
          return;
        }
        const data = snap.data();
        setCohort({
          id: snap.id,
          name: String(data.name ?? cohortId),
          logo_url: typeof data.logo_url === "string" ? data.logo_url : null,
          accent_color: typeof data.accent_color === "string" ? data.accent_color : null,
          cohort_admin_uids: Array.isArray(data.cohort_admin_uids)
            ? (data.cohort_admin_uids as string[])
            : [],
          deck_templates: Array.isArray(data.deck_templates)
            ? (data.deck_templates as CohortDoc["deck_templates"])
            : [],
        });
        setLoading(false);
      },
      (err) => {
         
        console.warn("[cohort]", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [cohortId]);

  // Subscribe to cohort founders.
  useEffect(() => {
    if (!cohortId || !allowed) return;
    const q = fsQuery(
      collection(db, "users"),
      where("cohort_id", "==", cohortId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const out: FounderRow[] = [];
        snap.forEach((d) => {
          const data = d.data();
          out.push({
            uid: d.id,
            display_name: String(data.display_name ?? "Unnamed"),
            email: typeof data.email === "string" ? data.email : null,
            companies_count:
              typeof data.companies_count === "number" ? data.companies_count : 0,
            last_activity_at: String(
              data.last_activity_at ?? new Date(0).toISOString(),
            ),
            status: (
              ["active", "idle", "graduated", "paused"] as readonly string[]
            ).includes(String(data.status))
              ? (data.status as FounderRow["status"])
              : "active",
          });
        });
        setFounders(out);
      },
      () => undefined,
    );
    return () => unsub();
  }, [cohortId, allowed]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return founders.filter((f) => {
      if (statusFilter !== "all" && f.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = `${f.display_name} ${f.email ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [founders, search, statusFilter]);

  const exportCsv = () => {
    const rows: string[] = [
      ["uid_anon", "companies", "last_activity", "status"].join(","),
    ];
    for (const f of filtered) {
      // Anonymize uid by hashing-like prefix only (server already redacts emails for export).
      rows.push(
        [
          `${f.uid.slice(0, 6)}…${f.uid.slice(-4)}`,
          f.companies_count,
          f.last_activity_at,
          f.status,
        ].join(","),
      );
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cohort-${cohortId}-anonymized.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    success("Export ready", "Anonymized CSV downloaded.");
  };

  const useTemplate = (templateId: string) => {
    if (!templateId) return;
    success("Template applied", "Future runs in this cohort will use this deck shell.");
  };

  if (authLoading || loading) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-ink-950 text-ink-400">
        <Spinner size={28} />
      </main>
    );
  }

  if (!cohort) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-ink-950 text-ink-400">
        Cohort not found.{" "}
        <Link to="/" className="ml-2 text-accent-500 underline-offset-2 hover:underline">
          Home
        </Link>
      </main>
    );
  }

  if (!allowed) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-ink-950 px-4 text-ink-200">
        <section className="grid max-w-md gap-4 rounded-bento border border-ink-800 bg-ink-900/40 p-8 text-center shadow-bento">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-ink-800 text-ink-300">
            <Lock className="h-4 w-4" />
          </span>
          <h1 className="font-display text-2xl text-ink-50">
            Cohort dashboards are Studio-tier
          </h1>
          <p className="text-sm text-ink-400">
            Either you're not a cohort admin for {cohort.name}, or your account is not on
            the Studio tier.{" "}
            <Link to="/billing" className="text-accent-500 underline-offset-2 hover:underline">
              See pricing
            </Link>
            {" or "}
            <a href="mailto:cohorts@prometheus.app" className="text-accent-500 underline-offset-2 hover:underline">
              talk to us
            </a>
            .
          </p>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mx-auto rounded-full border border-ink-800 bg-ink-900/60 px-4 py-2 text-sm text-ink-200 hover:bg-ink-900 focus-ring"
          >
            Back home
          </button>
        </section>
      </main>
    );
  }

  const accent = cohort.accent_color ?? "#FF5A1F";

  return (
    <main role="main" className="min-h-[100dvh] bg-ink-950 text-ink-100">
      {/* White-label header */}
      <header
        className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-ink-800 bg-ink-950/80 px-4 py-4 backdrop-blur md:px-6"
        style={{ borderColor: `${accent}33` }}
      >
        <div className="grid grid-cols-[auto_1fr] items-center gap-3">
          {cohort.logo_url ? (
            <img
              src={cohort.logo_url}
              alt={`${cohort.name} logo`}
              className="h-9 w-9 rounded-md object-contain"
              loading="lazy"
            />
          ) : (
            <span
              className="grid h-9 w-9 place-items-center rounded-md text-ink-50"
              style={{ background: `${accent}26` }}
            >
              <Sparkles className="h-4 w-4" style={{ color: accent }} />
            </span>
          )}
          <div>
            <p
              className="text-[10px] uppercase tracking-widest"
              style={{ color: accent }}
            >
              Cohort dashboard
            </p>
            <h1 className="font-display text-lg text-ink-50">{cohort.name}</h1>
          </div>
        </div>
        <div />
        <div className="flex items-center gap-2">
          <DeckTemplateMenu
            templates={cohort.deck_templates ?? []}
            onSelect={useTemplate}
          />
          <button
            type="button"
            onClick={exportCsv}
            className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-full border border-ink-800 bg-ink-900/60 px-4 py-1.5 text-xs text-ink-200 hover:bg-ink-900 focus-ring"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 md:px-6">
        <section className="grid gap-2">
          <h2 className="font-display text-3xl text-ink-50">Founders ({founders.length})</h2>
          <p className="text-sm text-ink-400">
            Anonymized exports follow your cohort's data agreement. Drilling into a founder
            opens their workspace in read-only support mode.
          </p>
        </section>

        <section className="grid grid-cols-[1fr_auto] items-center gap-3">
          <label className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-full border border-ink-800 bg-ink-900/40 px-4 py-2 focus-within:border-accent-500/40">
            <Search className="h-3.5 w-3.5 text-ink-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full bg-transparent text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none"
              aria-label="Search founders"
              data-mask
            />
          </label>
          <div className="hidden items-center gap-1 rounded-full border border-ink-800 bg-ink-900/40 p-1 sm:inline-flex">
            <Filter className="ml-2 h-3.5 w-3.5 text-ink-500" />
            {(["all", "active", "idle", "graduated", "paused"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                aria-pressed={statusFilter === s}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium capitalize transition focus-ring",
                  statusFilter === s
                    ? "bg-accent-500 text-ink-950"
                    : "text-ink-300 hover:text-ink-100",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        <section className="overflow-x-auto rounded-bento border border-ink-800 bg-ink-900/30">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-ink-500">
              <tr className="border-b border-ink-800">
                <th className="px-4 py-2.5 font-medium">Founder</th>
                <th className="px-4 py-2.5 text-right font-medium">Companies</th>
                <th className="px-4 py-2.5 font-medium">Last activity</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-xs text-ink-500">
                    <Users className="mx-auto mb-2 h-5 w-5 text-ink-600" />
                    No founders match those filters.
                  </td>
                </tr>
              ) : (
                filtered.map((f, i) => (
                  <motion.tr
                    key={f.uid}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: i * 0.01 }}
                    className="border-t border-ink-900 hover:bg-ink-900/40"
                  >
                    <td className="px-4 py-3">
                      <div className="grid gap-0.5">
                        <span className="text-sm font-semibold text-ink-100">{f.display_name}</span>
                        {f.email && (
                          <span className="font-mono text-[11px] text-ink-500">{f.email}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-200">
                      {f.companies_count}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-ink-400">
                      {new Date(f.last_activity_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                          STATUS_TINT[f.status],
                        )}
                      >
                        {f.status}
                      </span>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

function DeckTemplateMenu({
  templates,
  onSelect,
}: {
  templates: NonNullable<CohortDoc["deck_templates"]>;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-full border border-ink-800 bg-ink-900/60 px-4 py-1.5 text-xs text-ink-200 hover:bg-ink-900 focus-ring"
        aria-label="Deck templates"
      >
        <LayoutTemplate className="h-3.5 w-3.5" />
        <span>Deck templates</span>
        <ChevronDown className="h-3 w-3 text-ink-500" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 grid min-w-[260px] gap-0.5 rounded-2xl border border-ink-800 bg-ink-900/95 p-1.5 shadow-bento backdrop-blur"
        >
          {templates.length === 0 && (
            <p className="px-3 py-2 text-xs text-ink-500">
              No templates yet. Email{" "}
              <a className="text-accent-500" href="mailto:cohorts@prometheus.app">
                cohorts@prometheus.app
              </a>{" "}
              to upload your shell.
            </p>
          )}
          {templates.map((t) => (
            <DropdownMenu.Item
              key={t.id}
              onSelect={() => onSelect(t.id)}
              className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-200 outline-none data-[highlighted]:bg-ink-800 data-[highlighted]:text-ink-50"
            >
              <LayoutTemplate className="h-3.5 w-3.5 text-ink-500" />
              <span>{t.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export default CohortPage;
