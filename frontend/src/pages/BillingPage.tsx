/**
 * BillingPage — tier overview + usage meter + Stripe portal handoff.
 *
 * Sections:
 *  - Current plan card (tier label, price, monthly reset date)
 *  - Usage meter (% of monthly cost cap consumed)
 *  - Tier upgrade cards (skips current tier)
 *  - Stripe portal CTA (manage card / cancel)
 *  - Invoice history table
 *  - Confirm modal on upgrade clicks
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  CircleDollarSign,
  CreditCard,
  ExternalLink,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

import { api, APIError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { Spinner } from "@/components/MicroWidgets/Spinner";
import { TIERS, type Invoice, type TierDefinition, type UsageSnapshot } from "@/types/billing";
import { TIER_RANK } from "@/types/user";
import { cn } from "@/lib/cn";
import { z } from "zod";

const SPRING = { type: "spring" as const, stiffness: 100, damping: 20 };

const InvoiceListSchema = z.object({ invoices: z.array(z.object({
  id: z.string(),
  amount_usd: z.number(),
  status: z.enum(["paid", "open", "void", "uncollectible"]),
  invoiced_at: z.string().datetime(),
  hosted_invoice_url: z.string().url().nullable().optional(),
  pdf_url: z.string().url().nullable().optional(),
  description: z.string().nullable().optional(),
})) });

export function BillingPage(): JSX.Element {
  const { tier, uid, loading: authLoading } = useAuth();
  const { error: errorToast } = useToast();

  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmTier, setConfirmTier] = useState<TierDefinition | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!uid) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      api.getUsage(),
      fetch("/api/billing/invoices", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { invoices: [] }))
        .then((j) => InvoiceListSchema.safeParse(j))
        .then((p) => (p.success ? p.data.invoices : [])),
    ])
      .then(([u, i]) => {
        if (cancelled) return;
        if (u.status === "fulfilled") setUsage(u.value);
        if (i.status === "fulfilled") setInvoices(i.value);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, authLoading]);

  const startCheckout = async (target: TierDefinition) => {
    setBusy(target.id);
    try {
      const res = await api.checkout({
        tier: target.id,
        return_url: window.location.href,
      });
      window.location.assign(res.url);
    } catch (e) {
      const msg =
        e instanceof APIError ? e.message : e instanceof Error ? e.message : "Checkout failed";
      errorToast("Checkout error", msg);
      setBusy(null);
    }
  };

  const openPortal = async () => {
    try {
      const res = await api.billingPortal();
      window.location.assign(res.url);
    } catch (e) {
      const msg =
        e instanceof APIError ? e.message : e instanceof Error ? e.message : "Portal failed";
      errorToast("Could not open Stripe portal", msg);
    }
  };

  const currentTier = useMemo<TierDefinition | undefined>(
    () => TIERS.find((t) => t.id === tier),
    [tier],
  );

  const upgradeOptions = useMemo<TierDefinition[]>(() => {
    return TIERS.filter((t) => TIER_RANK[t.id] > TIER_RANK[tier]);
  }, [tier]);

  return (
    <main role="main" className="min-h-[100dvh] bg-ink-950 text-ink-100">
      <header className="sticky top-0 z-30 grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-ink-900 bg-ink-950/80 px-4 py-3 backdrop-blur md:px-6">
        <Link to="/" className="grid grid-cols-[auto_1fr] items-center gap-2 font-display text-base text-ink-50 focus-ring">
          <Sparkles className="h-4 w-4 text-accent-500" />
          PROMETHEUS
        </Link>
        <h1 className="font-display text-base text-ink-50 justify-self-center">Billing &amp; usage</h1>
        <Link to="/settings" className="text-xs text-ink-400 hover:text-ink-100 focus-ring">
          Settings
        </Link>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 md:px-6">
        {loading ? (
          <div className="grid place-items-center rounded-bento border border-ink-800 bg-ink-900/30 py-20">
            <Spinner size={20} />
          </div>
        ) : (
          <>
            {/* Current plan + usage meter */}
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SPRING}
              className="grid gap-4 rounded-bento border border-ink-800 bg-ink-900/40 p-6 shadow-bento md:grid-cols-[1.4fr_1fr]"
            >
              <div className="grid gap-3">
                <span className="text-[11px] uppercase tracking-widest text-accent-500">
                  Current plan
                </span>
                <h2 className="font-display text-4xl text-ink-50">
                  {currentTier?.label ?? tier.replace(/^./, (c) => c.toUpperCase())}
                </h2>
                <p className="text-sm text-ink-400">
                  {currentTier?.blurb ??
                    "You're on the anonymous tier — sign in to claim your first generations."}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void openPortal()}
                    disabled={!uid}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-full border border-ink-800 bg-ink-900/60 px-4 py-2 text-sm text-ink-200 hover:bg-ink-900 focus-ring disabled:opacity-40"
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>Manage payment method</span>
                    <ExternalLink className="h-3 w-3 text-ink-500" />
                  </button>
                </div>
              </div>
              <UsageMeter usage={usage} />
            </motion.section>

            {/* Upgrade tiers */}
            <section aria-labelledby="upgrade-title" className="grid gap-3">
              <h2 id="upgrade-title" className="text-[11px] uppercase tracking-widest text-ink-500">
                Upgrade options
              </h2>
              {upgradeOptions.length === 0 ? (
                <p className="rounded-2xl border border-ink-800 bg-ink-950/40 p-4 text-sm text-ink-300">
                  You're on the highest tier. Need more?{" "}
                  <a href="mailto:hello@prometheus.app" className="text-accent-500 underline-offset-2 hover:underline">
                    Talk to us
                  </a>{" "}
                  about cohort or enterprise.
                </p>
              ) : (
                <div
                  className={cn(
                    "grid gap-3",
                    upgradeOptions.length === 1
                      ? "grid-cols-1"
                      : upgradeOptions.length === 2
                        ? "grid-cols-1 md:grid-cols-2"
                        : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
                  )}
                >
                  {upgradeOptions.map((t) => (
                    <article
                      key={t.id}
                      className={cn(
                        "grid gap-3 rounded-bento border bg-ink-900/40 p-5 shadow-bento",
                        t.highlight
                          ? "border-accent-500/50 ring-1 ring-accent-500/15"
                          : "border-ink-800",
                      )}
                    >
                      <header className="grid gap-1">
                        <h3 className="font-display text-2xl text-ink-50">{t.label}</h3>
                        <p className="text-xs text-ink-400">{t.blurb}</p>
                      </header>
                      <div className="grid grid-cols-[auto_1fr] items-baseline gap-1">
                        <span className="font-display text-3xl text-ink-50">
                          ${t.price_usd_monthly}
                        </span>
                        <span className="text-xs text-ink-500">/ mo</span>
                      </div>
                      <ul className="grid gap-1.5 text-sm text-ink-300">
                        {t.features.map((f) => (
                          <li key={f} className="grid grid-cols-[auto_1fr] items-start gap-2">
                            <Check className="mt-0.5 h-3.5 w-3.5 text-accent-500" />
                            {f}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => setConfirmTier(t)}
                        className={cn(
                          "grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold focus-ring",
                          t.highlight
                            ? "bg-accent-500 text-ink-950 hover:bg-accent-400"
                            : "bg-ink-800 text-ink-100 hover:bg-ink-700",
                        )}
                      >
                        <span aria-hidden />
                        <span>{t.cta}</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* Invoices */}
            <section aria-labelledby="invoices-title" className="grid gap-3">
              <h2 id="invoices-title" className="text-[11px] uppercase tracking-widest text-ink-500">
                Invoices
              </h2>
              {invoices.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-ink-800 bg-ink-950/40 p-6 text-center text-xs text-ink-500">
                  No invoices yet. They show up the first time you pay.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-ink-800 bg-ink-950/40">
                  <table className="w-full text-left text-xs">
                    <thead className="text-ink-500">
                      <tr className="border-b border-ink-800">
                        <th className="px-3 py-2 font-medium uppercase tracking-widest">Date</th>
                        <th className="px-3 py-2 font-medium uppercase tracking-widest">
                          Description
                        </th>
                        <th className="px-3 py-2 text-right font-medium uppercase tracking-widest">
                          Amount
                        </th>
                        <th className="px-3 py-2 font-medium uppercase tracking-widest">Status</th>
                        <th className="px-3 py-2 font-medium uppercase tracking-widest">Files</th>
                      </tr>
                    </thead>
                    <tbody className="text-ink-200">
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="border-t border-ink-900">
                          <td className="px-3 py-2 font-mono tabular-nums">
                            {new Date(inv.invoiced_at).toLocaleDateString()}
                          </td>
                          <td className="px-3 py-2">{inv.description ?? "Subscription"}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            ${inv.amount_usd.toFixed(2)}
                          </td>
                          <td className="px-3 py-2">
                            <StatusPill status={inv.status} />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                              {inv.hosted_invoice_url && (
                                <a
                                  href={inv.hosted_invoice_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded border border-ink-800 px-2 py-0.5 text-[10px] text-ink-200 hover:bg-ink-800 focus-ring"
                                >
                                  Web
                                </a>
                              )}
                              {inv.pdf_url && (
                                <a
                                  href={inv.pdf_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded border border-ink-800 px-2 py-0.5 text-[10px] text-ink-200 hover:bg-ink-800 focus-ring"
                                >
                                  PDF
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Confirm upgrade modal */}
      <Dialog.Root open={confirmTier !== null} onOpenChange={(v) => !v && setConfirmTier(null)}>
        <AnimatePresence>
          {confirmTier && (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-sm"
                />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount>
                <motion.div
                  initial={{ opacity: 0, y: 14, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={SPRING}
                  className="fixed left-1/2 top-1/2 z-50 w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-bento border border-ink-800 bg-ink-900/95 p-6 shadow-bento backdrop-blur"
                >
                  <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-500/15 text-accent-500">
                      <CircleDollarSign className="h-4 w-4" />
                    </span>
                    <div>
                      <Dialog.Title className="font-display text-xl text-ink-50">
                        Upgrade to {confirmTier.label}?
                      </Dialog.Title>
                      <Dialog.Description className="mt-1 text-sm text-ink-400">
                        ${confirmTier.price_usd_monthly}/mo · cancel anytime · prorated to today.
                      </Dialog.Description>
                    </div>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-full p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100 focus-ring"
                        aria-label="Close upgrade dialog"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </Dialog.Close>
                  </div>
                  <ul className="mt-5 grid gap-1.5 text-sm text-ink-300">
                    {confirmTier.features.map((f) => (
                      <li key={f} className="grid grid-cols-[auto_1fr] items-start gap-2">
                        <Check className="mt-0.5 h-3.5 w-3.5 text-accent-500" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 grid grid-cols-[auto_1fr] gap-2">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-full border border-ink-800 bg-ink-900/60 px-4 py-2 text-sm text-ink-200 hover:bg-ink-900 focus-ring"
                      >
                        Cancel
                      </button>
                    </Dialog.Close>
                    <button
                      type="button"
                      onClick={() => void startCheckout(confirmTier)}
                      disabled={busy === confirmTier.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-full bg-accent-500 px-5 py-2 text-sm font-semibold text-ink-950 hover:bg-accent-400 focus-ring disabled:opacity-60"
                    >
                      <span>
                        {busy === confirmTier.id
                          ? "Redirecting…"
                          : `Continue to Stripe — $${confirmTier.price_usd_monthly}/mo`}
                      </span>
                      {busy === confirmTier.id ? <Spinner size={14} /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </main>
  );
}

function UsageMeter({ usage }: { usage: UsageSnapshot | null }): JSX.Element {
  if (!usage) {
    return (
      <div className="grid gap-2 rounded-2xl border border-ink-800 bg-ink-950/40 p-4">
        <span className="text-[10px] uppercase tracking-widest text-ink-500">Usage</span>
        <p className="text-xs text-ink-500">No usage data yet — kick off a generation.</p>
      </div>
    );
  }
  const costPct = Math.min(100, (usage.cost_this_month_usd / Math.max(0.01, usage.cost_cap_usd)) * 100);
  const genPct = Math.min(
    100,
    (usage.generations_this_month / Math.max(1, usage.generations_cap)) * 100,
  );
  return (
    <div className="grid gap-3 rounded-2xl border border-ink-800 bg-ink-950/40 p-4">
      <div>
        <div className="grid grid-cols-[1fr_auto] items-baseline">
          <span className="text-[10px] uppercase tracking-widest text-ink-500">Cost this month</span>
          <span className="font-mono text-sm tabular-nums text-ink-100">
            ${usage.cost_this_month_usd.toFixed(2)}{" "}
            <span className="text-ink-500">/ ${usage.cost_cap_usd.toFixed(2)}</span>
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              costPct > 85 ? "bg-rose-400" : costPct > 60 ? "bg-amber-400" : "bg-accent-500",
            )}
            style={{ width: `${costPct}%` }}
          />
        </div>
      </div>
      <div>
        <div className="grid grid-cols-[1fr_auto] items-baseline">
          <span className="text-[10px] uppercase tracking-widest text-ink-500">Generations</span>
          <span className="font-mono text-sm tabular-nums text-ink-100">
            {usage.generations_this_month} <span className="text-ink-500">/ {usage.generations_cap}</span>
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${genPct}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-1.5 text-[10px] text-ink-500">
        <RefreshCw className="h-3 w-3" />
        Resets {new Date(usage.next_reset_at).toLocaleDateString()}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Invoice["status"] }): JSX.Element {
  const tone =
    status === "paid"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : status === "open"
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : status === "void"
          ? "bg-ink-800 text-ink-400 border-ink-700"
          : "bg-rose-500/15 text-rose-300 border-rose-500/30";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider", tone)}>
      {status}
    </span>
  );
}

export default BillingPage;
