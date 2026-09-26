/**
 * HomePage — the marketing + entry surface.
 *
 * Anti-slop layout (taste-skill rules):
 *  - Asymmetric hero (Hero component, NO 3-card row).
 *  - 3 escalating CTAs:
 *      1. Live example loop (lowest commitment)
 *      2. Idea templates (medium)
 *      3. Voice/Text input (high commitment, real submission)
 *  - Trust signals row (citation-first).
 *  - "How it works" timeline T-0 → T+90.
 *  - Real (not synthesized) testimonials placeholder.
 *  - Footer with legal + social.
 *
 * Mobile-first. CSS Grid, NOT flex math. Spring 100/20.
 */
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Activity,
  ChartNoAxesColumn,
  CheckCircle2,
  ChevronRight,
  Github,
  Globe,
  Linkedin,
  Mail,
  ShieldCheck,
  Sparkles,
  Twitter,
} from "lucide-react";

import { Hero } from "@/components/MicroWidgets/Hero";
import { IdeaTemplates } from "@/components/MicroWidgets/IdeaTemplates";
import { LiveExampleLoop } from "@/components/MicroWidgets/LiveExampleLoop";
import { TrustSignals } from "@/components/MicroWidgets/TrustSignals";
import { TextInput } from "@/components/TextInput";
import { VoiceInput } from "@/components/VoiceInput";
import { ArticulationStep } from "@/components/ArticulationStep";
import { useAuth } from "@/hooks/useAuth";
import { api, APIError } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { track, Events } from "@/lib/analytics";
import type { ArticulationOutput } from "@/types/agents";
import { cn } from "@/lib/cn";

const SPRING = { type: "spring" as const, stiffness: 100, damping: 20 };

type InputMode = "voice" | "text";

interface TimelineStep {
  t: string;
  title: string;
  body: string;
}

const TIMELINE: TimelineStep[] = [
  {
    t: "T-0",
    title: "Articulation",
    body: "Pre-Wave parses your input, surfaces clarifying questions, locks assumptions.",
  },
  {
    t: "T+10s",
    title: "Wave 1 — Foundation",
    body: "Six agents in parallel: market, competitive, model, brand, risk, tech.",
  },
  {
    t: "T+45s",
    title: "Gate 1",
    body: "Schema + Vertex Safety + USPTO + domain checks. Reject + reroll on conflict.",
  },
  {
    t: "T+50s",
    title: "Wave 2 — Build",
    body: "Financial engine, sandboxed landing page, GTM plan, lawyer-template legal.",
  },
  {
    t: "T+90s",
    title: "Wave 3 + Gate 3",
    body: "Pitch deck + executive summary, then cross-artifact coherence check. Done.",
  },
];

export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const { uid, signInAnon } = useAuth();
  const { error: errorToast } = useToast();

  const [mode, setMode] = useState<InputMode>("voice");
  const [submitting, setSubmitting] = useState(false);
  const [articulationOpen, setArticulationOpen] = useState(false);
  const [articulationOriginal, setArticulationOriginal] = useState("");
  const [articulationOutput, setArticulationOutput] = useState<ArticulationOutput | null>(null);
  const [pendingIdea, setPendingIdea] = useState<string | null>(null);

  const ensureSignedIn = useCallback(async () => {
    if (!uid) await signInAnon();
  }, [uid, signInAnon]);

  const submitGeneration = useCallback(
    async (idea: string) => {
      setSubmitting(true);
      track(Events.GENERATION_STARTED, { mode, idea_length: idea.length });
      try {
        await ensureSignedIn();
        const res = await api.generate({ idea_text: idea });
        navigate(`/generate/${encodeURIComponent(res.session_id)}`);
      } catch (e) {
        const msg =
          e instanceof APIError ? e.message : e instanceof Error ? e.message : "Generation failed";
        errorToast("Could not start generation", msg);
        setSubmitting(false);
      }
    },
    [ensureSignedIn, errorToast, mode, navigate],
  );

  const startArticulation = useCallback(
    async (idea: string) => {
      setSubmitting(true);
      try {
        await ensureSignedIn();
        const out = await api.articulate(idea);
        // Skip articulation overlay for high-confidence + no clarifying Qs.
        if (out.confidence >= 0.85 && out.clarifying_questions.length === 0) {
          await submitGeneration(out.polished_idea || idea);
          return;
        }
        setArticulationOriginal(idea);
        setArticulationOutput(out);
        setPendingIdea(idea);
        setArticulationOpen(true);
        setSubmitting(false);
      } catch (e) {
        const msg =
          e instanceof APIError ? e.message : e instanceof Error ? e.message : "Articulation failed";
        errorToast("Could not articulate", msg);
        setSubmitting(false);
      }
    },
    [ensureSignedIn, errorToast, submitGeneration],
  );

  const handleArticulationAccept = useCallback(
    (polished: string) => {
      setArticulationOpen(false);
      setArticulationOutput(null);
      void submitGeneration(polished || pendingIdea || "");
    },
    [submitGeneration, pendingIdea],
  );

  const handleArticulationOriginal = useCallback(() => {
    setArticulationOpen(false);
    setArticulationOutput(null);
    void submitGeneration(pendingIdea ?? articulationOriginal);
  }, [submitGeneration, pendingIdea, articulationOriginal]);

  return (
    <main role="main" className="min-h-[100dvh] bg-ink-950 text-ink-100">
      <NavBar />

      <div className="mx-auto grid w-full max-w-6xl gap-16 px-4 pb-24 pt-10 md:px-6 md:pt-14">
        <Hero
          ctaLabel="Whisper an idea"
          onCtaClick={() => {
            setMode("voice");
            document.getElementById("idea-input")?.scrollIntoView({ behavior: "smooth" });
          }}
          secondaryLabel="See a 30-second example"
          onSecondaryClick={() => {
            document.getElementById("live-example")?.scrollIntoView({ behavior: "smooth" });
          }}
        />

        {/* CTA escalator: live example → templates → input. */}
        <section
          id="live-example"
          aria-labelledby="live-example-title"
          className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:gap-8"
        >
          <div className="grid gap-3">
            <p className="text-[11px] uppercase tracking-widest text-accent-500">
              See it run
            </p>
            <h2 id="live-example-title" className="font-display text-3xl text-ink-50 md:text-4xl">
              30 seconds of a real generation.
            </h2>
            <p className="max-w-prose text-base text-ink-400">
              No "AI demo" cuts. The 13 agents are visible, the cost meter ticks,
              and every metric ties back to a citation. Skip ahead if you want.
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-ink-300">
              <Pill icon={Activity} label="Live reasoning" />
              <Pill icon={ShieldCheck} label="Sources cited" />
              <Pill icon={Globe} label="Sandboxed render" />
            </div>
          </div>
          <LiveExampleLoop className="md:col-start-2" />
        </section>

        {/* Idea Templates */}
        <section aria-labelledby="templates-title" className="grid gap-4">
          <header className="grid grid-cols-[1fr_auto] items-baseline gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-accent-500">
                Try a real founder idea
              </p>
              <h2 id="templates-title" className="font-display text-3xl text-ink-50 md:text-4xl">
                Start from one of these.
              </h2>
            </div>
            <p className="hidden max-w-xs text-sm text-ink-400 md:block">
              Each template is calibrated to a real market with real metrics — pick one
              and we'll rephrase before launching.
            </p>
          </header>
          <IdeaTemplates onPick={(idea) => void startArticulation(idea)} />
        </section>

        {/* Input mode switcher + actual input */}
        <section
          id="idea-input"
          aria-labelledby="input-title"
          className="grid gap-4"
        >
          <header className="grid grid-cols-[1fr_auto] items-baseline gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-accent-500">
                Step three
              </p>
              <h2 id="input-title" className="font-display text-3xl text-ink-50 md:text-4xl">
                Or whisper your own.
              </h2>
            </div>
            <div role="radiogroup" aria-label="Input mode" className="inline-flex gap-1 rounded-full border border-ink-800 bg-ink-900 p-1">
              {(["voice", "text"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-xs font-medium capitalize transition focus-ring",
                    mode === m ? "bg-accent-500 text-ink-950" : "text-ink-300 hover:text-ink-100",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </header>
          <motion.div layout transition={SPRING}>
            {mode === "voice" ? (
              <VoiceInput
                onTranscript={(text) => void startArticulation(text)}
                disabled={submitting}
              />
            ) : (
              <TextInput
                onSubmit={(text) => void startArticulation(text)}
                busy={submitting}
              />
            )}
          </motion.div>
        </section>

        {/* Trust signals */}
        <section aria-labelledby="trust-title" className="grid gap-3">
          <h2 id="trust-title" className="text-[11px] uppercase tracking-widest text-ink-500">
            What you should know
          </h2>
          <TrustSignals />
        </section>

        {/* How it works timeline */}
        <section aria-labelledby="timeline-title" className="grid gap-6">
          <header className="grid gap-2">
            <p className="text-[11px] uppercase tracking-widest text-accent-500">
              How it works
            </p>
            <h2 id="timeline-title" className="font-display text-3xl text-ink-50 md:text-4xl">
              T-0 to T+90s, no smoke.
            </h2>
          </header>
          <ol className="grid gap-3 md:grid-cols-5">
            {TIMELINE.map((step, i) => (
              <motion.li
                key={step.t}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ ...SPRING, delay: i * 0.05 }}
                className="grid gap-2 rounded-2xl border border-ink-800 bg-ink-900/30 p-4"
              >
                <span className="font-mono text-[10px] uppercase tracking-widest text-accent-500">
                  {step.t}
                </span>
                <span className="font-display text-base text-ink-50">{step.title}</span>
                <span className="text-[12.5px] leading-relaxed text-ink-400">{step.body}</span>
              </motion.li>
            ))}
          </ol>
        </section>

        {/* Testimonials placeholder — real quotes only */}
        <section aria-labelledby="proof-title" className="grid gap-4">
          <header>
            <p className="text-[11px] uppercase tracking-widest text-accent-500">Receipts</p>
            <h2 id="proof-title" className="font-display text-3xl text-ink-50 md:text-4xl">
              Quotes go here when we have real ones.
            </h2>
            <p className="mt-2 max-w-prose text-sm text-ink-400">
              We refuse fake testimonials with stock-photo people and made-up titles.
              First batch lands after the cohort beta closes.
            </p>
          </header>
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
            <article className="grid gap-3 rounded-2xl border border-dashed border-ink-700 bg-ink-900/30 p-5 text-sm text-ink-400">
              <span className="text-[10px] uppercase tracking-widest text-ink-500">Slot reserved</span>
              <p>
                Real founder, real company, real before/after. Drop us a note if you want
                early access — <a className="text-accent-500 underline-offset-2 hover:underline" href="mailto:beta@prometheus.app">beta@prometheus.app</a>.
              </p>
            </article>
            <article className="grid place-items-center rounded-2xl border border-dashed border-ink-700 bg-ink-900/30 p-5 text-xs text-ink-500">
              <CheckCircle2 className="mb-2 h-4 w-4 text-accent-500" />
              <span>No "John Doe"s. Ever.</span>
            </article>
            <article className="grid place-items-center rounded-2xl border border-dashed border-ink-700 bg-ink-900/30 p-5 text-xs text-ink-500">
              <ChartNoAxesColumn className="mb-2 h-4 w-4 text-accent-500" />
              <span>No "99.99% accurate" claims.</span>
            </article>
          </div>
        </section>

        <FooterStrip />
      </div>

      <ArticulationStep
        open={articulationOpen}
        original={articulationOriginal}
        output={articulationOutput}
        onAccept={handleArticulationAccept}
        onKeepOriginal={handleArticulationOriginal}
        onCancel={() => {
          setArticulationOpen(false);
          setArticulationOutput(null);
          setSubmitting(false);
        }}
      />
    </main>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function NavBar(): JSX.Element {
  return (
    <header className="sticky top-0 z-30 grid grid-cols-[1fr_auto] items-center gap-4 border-b border-ink-900 bg-ink-950/80 px-4 py-3 backdrop-blur md:px-6">
      <a
        href="/"
        className="inline-grid grid-cols-[auto_1fr] items-center gap-2 font-display text-lg text-ink-50 focus-ring"
      >
        <Sparkles className="h-4 w-4 text-accent-500" aria-hidden />
        <span>PROMETHEUS</span>
      </a>
      <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
        <NavLink href="/companies">Companies</NavLink>
        <NavLink href="/billing">Pricing</NavLink>
        <a
          href="/login"
          className="ml-2 rounded-full bg-accent-500 px-4 py-1.5 text-xs font-semibold text-ink-950 hover:bg-accent-400 focus-ring"
        >
          Sign in
        </a>
      </nav>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }): JSX.Element {
  return (
    <a
      href={href}
      className="rounded-full px-3 py-1.5 text-ink-300 transition hover:bg-ink-900 hover:text-ink-50 focus-ring"
    >
      {children}
    </a>
  );
}

function Pill({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-800 bg-ink-900/40 px-2.5 py-1">
      <Icon className="h-3 w-3 text-accent-500" />
      {label}
    </span>
  );
}

function FooterStrip(): JSX.Element {
  return (
    <footer className="grid gap-6 rounded-bento border border-ink-800 bg-ink-900/30 p-6 md:grid-cols-[1.5fr_1fr_1fr_1fr] md:gap-8">
      <div className="grid gap-2">
        <a href="/" className="inline-grid w-fit grid-cols-[auto_1fr] items-center gap-2 font-display text-base text-ink-50 focus-ring">
          <Sparkles className="h-4 w-4 text-accent-500" />
          PROMETHEUS
        </a>
        <p className="text-xs text-ink-400">
          Whisper an idea. Get a company. Built by Shaurya in San Francisco.
        </p>
        <div className="mt-2 flex items-center gap-2 text-ink-500">
          <a href="https://twitter.com" aria-label="Twitter" className="rounded p-1 hover:text-accent-500 focus-ring">
            <Twitter className="h-3.5 w-3.5" />
          </a>
          <a href="https://github.com" aria-label="GitHub" className="rounded p-1 hover:text-accent-500 focus-ring">
            <Github className="h-3.5 w-3.5" />
          </a>
          <a href="https://linkedin.com" aria-label="LinkedIn" className="rounded p-1 hover:text-accent-500 focus-ring">
            <Linkedin className="h-3.5 w-3.5" />
          </a>
          <a href="mailto:hello@prometheus.app" aria-label="Email" className="rounded p-1 hover:text-accent-500 focus-ring">
            <Mail className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
      <FooterCol
        title="Product"
        links={[
          { label: "Companies", href: "/companies" },
          { label: "Billing", href: "/billing" },
          { label: "Settings", href: "/settings" },
        ]}
      />
      <FooterCol
        title="Resources"
        links={[
          { label: "Docs", href: "https://docs.prometheus.app" },
          { label: "Status", href: "https://status.prometheus.app" },
          { label: "Changelog", href: "https://changelog.prometheus.app" },
        ]}
      />
      <FooterCol
        title="Legal"
        links={[
          { label: "Terms", href: "/terms" },
          { label: "Privacy", href: "/privacy" },
          { label: "DPA", href: "/dpa" },
        ]}
      />
      <p className="text-[11px] text-ink-500 md:col-span-4">
        © {new Date().getFullYear()} PROMETHEUS. All rights reserved. Idea text auto-deleted after 30 days.
      </p>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}): JSX.Element {
  return (
    <nav aria-label={title} className="grid gap-2">
      <h3 className="text-[11px] uppercase tracking-widest text-ink-500">{title}</h3>
      <ul className="grid gap-1 text-xs text-ink-300">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              className="inline-flex items-center gap-1 hover:text-accent-500 focus-ring"
            >
              {l.label}
              <ChevronRight className="h-3 w-3 text-ink-600" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default HomePage;
