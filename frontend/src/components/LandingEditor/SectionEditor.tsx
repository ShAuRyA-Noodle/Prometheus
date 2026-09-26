/**
 * SectionEditor — per-section structured editor.
 *
 * Renders a different field set per section type. Headlines/body use Tiptap
 * for rich-text. Image slots have regen via api.regenerateImage. CTA buttons
 * expose label + href fields. Background pattern picker is hero-only.
 *
 * Strict contract: never produces raw HTML. All output goes back into the
 * structured LandingSection.data so composeLandingHtml + DOMPurify can sanitize
 * before render.
 */
import { useCallback, useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { motion } from "framer-motion";
import {
  Bold,
  ImageIcon,
  Italic,
  Link2,
  List,
  Plus,
  RefreshCw,
  Trash2,
  Wand2,
} from "lucide-react";

import { api, APIError } from "../../lib/api";
import type {
  LandingFAQEntry,
  LandingFeature,
  LandingHero,
  LandingPricingTier,
  LandingSection,
  LandingTestimonial,
} from "../../lib/composeLandingHtml";
import { cn } from "../../lib/cn";

const SPRING = { type: "spring" as const, stiffness: 100, damping: 20 };

export interface SectionEditorProps {
  sessionId: string;
  section: LandingSection;
  onChange: (next: LandingSection) => void;
  className?: string;
}

export function SectionEditor({
  sessionId,
  section,
  onChange,
  className,
}: SectionEditorProps): JSX.Element {
  const stamp = useCallback(
    (next: LandingSection) =>
      onChange({ ...next, updatedAt: Date.now() } as LandingSection),
    [onChange],
  );

  return (
    <motion.section
      layout
      transition={SPRING}
      aria-label={`Edit ${section.type}`}
      className={cn(
        "grid gap-4 rounded-bento border border-ink-800 bg-ink-900/40 p-5",
        className,
      )}
    >
      <header className="grid grid-cols-[1fr_auto] items-baseline gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink-500">
            Section
          </p>
          <h3 className="font-display text-base text-ink-50 capitalize">
            {section.type}
          </h3>
        </div>
        <span className="font-mono text-[10px] text-ink-500">
          id: {section.id}
        </span>
      </header>
      {section.type === "hero" && (
        <HeroEditor
          sessionId={sessionId}
          value={section.data}
          onChange={(d) => stamp({ ...section, data: d })}
        />
      )}
      {section.type === "features" && (
        <FeaturesEditor
          sessionId={sessionId}
          value={section.data}
          onChange={(d) => stamp({ ...section, data: d })}
        />
      )}
      {section.type === "pricing" && (
        <PricingEditor
          value={section.data}
          onChange={(d) => stamp({ ...section, data: d })}
        />
      )}
      {section.type === "testimonials" && (
        <TestimonialsEditor
          value={section.data}
          onChange={(d) => stamp({ ...section, data: d })}
        />
      )}
      {section.type === "faq" && (
        <FAQEditor
          value={section.data}
          onChange={(d) => stamp({ ...section, data: d })}
        />
      )}
      {section.type === "cta" && (
        <CTAEditor
          value={section.data}
          onChange={(d) => stamp({ ...section, data: d })}
        />
      )}
      {section.type === "footer" && (
        <FooterEditor
          value={section.data}
          onChange={(d) => stamp({ ...section, data: d })}
        />
      )}
    </motion.section>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function HeroEditor({
  sessionId,
  value,
  onChange,
}: {
  sessionId: string;
  value: LandingHero;
  onChange: (next: LandingHero) => void;
}): JSX.Element {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <Field label="Eyebrow (small label above headline)">
          <input
            type="text"
            value={value.eyebrow ?? ""}
            onChange={(e) => onChange({ ...value, eyebrow: e.target.value })}
            maxLength={60}
            placeholder="e.g. For Series A founders"
            className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus-ring"
          />
        </Field>
        <VariantPicker
          value={value.variant}
          onChange={(variant) => onChange({ ...value, variant })}
        />
      </div>
      <Field label="Headline">
        <RichTextarea
          value={value.headline}
          onChange={(headline) => onChange({ ...value, headline })}
          placeholder="One bold sentence."
          maxChars={120}
        />
      </Field>
      <Field label="Subheadline">
        <RichTextarea
          value={value.subheadline}
          onChange={(subheadline) => onChange({ ...value, subheadline })}
          placeholder="One supporting line — what + who + why now."
          maxChars={220}
          minHeight={80}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CTA label">
          <input
            type="text"
            value={value.cta_label}
            onChange={(e) => onChange({ ...value, cta_label: e.target.value })}
            maxLength={40}
            className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
          />
        </Field>
        <Field label="CTA link (href)">
          <input
            type="text"
            value={value.cta_href}
            onChange={(e) => onChange({ ...value, cta_href: e.target.value })}
            maxLength={300}
            placeholder="#signup or https://…"
            className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-xs text-ink-100 focus-ring"
          />
        </Field>
      </div>
      <ImageSlot
        sessionId={sessionId}
        label="Hero image"
        target="hero"
        url={value.hero_image_url ?? null}
        onChange={(url) => onChange({ ...value, hero_image_url: url })}
      />
      <PatternPicker
        value={value.background_pattern ?? "none"}
        onChange={(p) => onChange({ ...value, background_pattern: p })}
      />
    </div>
  );
}

function VariantPicker({
  value,
  onChange,
}: {
  value: LandingHero["variant"];
  onChange: (v: LandingHero["variant"]) => void;
}): JSX.Element {
  const variants: { id: LandingHero["variant"]; label: string }[] = [
    { id: "asymmetric", label: "Asymmetric" },
    { id: "centered", label: "Centered" },
    { id: "split", label: "Split" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Hero variant"
      className="inline-grid grid-cols-3 gap-1 rounded-full border border-ink-800 bg-ink-950 p-1"
    >
      {variants.map((v) => (
        <button
          key={v.id}
          type="button"
          role="radio"
          aria-checked={value === v.id}
          onClick={() => onChange(v.id)}
          className={cn(
            "rounded-full px-3 py-1 text-[11px] font-medium transition focus-ring",
            value === v.id
              ? "bg-accent-500 text-ink-950"
              : "text-ink-300 hover:bg-ink-800",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function PatternPicker({
  value,
  onChange,
}: {
  value: NonNullable<LandingHero["background_pattern"]>;
  onChange: (v: NonNullable<LandingHero["background_pattern"]>) => void;
}): JSX.Element {
  const patterns: NonNullable<LandingHero["background_pattern"]>[] = [
    "none",
    "noise",
    "grid",
  ];
  return (
    <Field label="Background pattern">
      <div className="inline-grid grid-cols-3 gap-1 rounded-md border border-ink-800 bg-ink-950 p-1">
        {patterns.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "rounded px-3 py-1 text-[11px] font-medium capitalize transition focus-ring",
              value === p
                ? "bg-accent-500 text-ink-950"
                : "text-ink-300 hover:bg-ink-800",
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </Field>
  );
}

// ─── Features ────────────────────────────────────────────────────────────────

function FeaturesEditor({
  sessionId,
  value,
  onChange,
}: {
  sessionId: string;
  value: { headline: string; subheadline?: string; features: LandingFeature[] };
  onChange: (next: {
    headline: string;
    subheadline?: string;
    features: LandingFeature[];
  }) => void;
}): JSX.Element {
  const setFeature = (idx: number, next: LandingFeature) => {
    const features = value.features.map((f, i) => (i === idx ? next : f));
    onChange({ ...value, features });
  };
  const addFeature = () => {
    if (value.features.length >= 6) return;
    onChange({
      ...value,
      features: [
        ...value.features,
        {
          title: "New feature",
          description: "Why it matters in one sentence.",
        },
      ],
    });
  };
  const removeFeature = (idx: number) => {
    onChange({
      ...value,
      features: value.features.filter((_, i) => i !== idx),
    });
  };

  return (
    <div className="grid gap-4">
      <Field label="Section headline">
        <input
          type="text"
          value={value.headline}
          onChange={(e) => onChange({ ...value, headline: e.target.value })}
          maxLength={120}
          className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
        />
      </Field>
      <Field label="Subheadline (optional)">
        <input
          type="text"
          value={value.subheadline ?? ""}
          onChange={(e) => onChange({ ...value, subheadline: e.target.value })}
          maxLength={160}
          className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
        />
      </Field>
      <ul className="grid gap-3">
        {value.features.map((f, i) => (
          <li
            key={i}
            className="grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-2xl border border-ink-800 bg-ink-950/40 p-3"
          >
            <span className="mt-1 grid h-6 w-6 place-items-center rounded-md bg-ink-800 font-mono text-[10px] text-ink-300">
              #{i + 1}
            </span>
            <div className="grid gap-2">
              <input
                type="text"
                value={f.title}
                onChange={(e) => setFeature(i, { ...f, title: e.target.value })}
                maxLength={60}
                className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-sm font-medium text-ink-100 focus-ring"
              />
              <textarea
                value={f.description}
                onChange={(e) =>
                  setFeature(i, { ...f, description: e.target.value })
                }
                maxLength={240}
                rows={2}
                className="w-full resize-none rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-sm text-ink-200 focus-ring"
              />
              <ImageSlot
                sessionId={sessionId}
                label="Feature image (optional)"
                target="feature"
                targetId={`feature-${i}`}
                url={f.image_url ?? null}
                onChange={(url) => setFeature(i, { ...f, image_url: url })}
                compact
              />
            </div>
            <button
              type="button"
              onClick={() => removeFeature(i)}
              aria-label="Remove feature"
              className="rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-rose-300 focus-ring"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={addFeature}
        disabled={value.features.length >= 6}
        className="grid grid-cols-[auto_1fr] items-center justify-self-start gap-2 rounded-full border border-dashed border-ink-700 bg-ink-900/30 px-4 py-2 text-xs text-ink-300 hover:border-accent-500/40 focus-ring disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        Add feature
      </button>
    </div>
  );
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

function PricingEditor({
  value,
  onChange,
}: {
  value: { headline: string; tiers: LandingPricingTier[] };
  onChange: (next: { headline: string; tiers: LandingPricingTier[] }) => void;
}): JSX.Element {
  const setTier = (idx: number, next: LandingPricingTier) => {
    onChange({
      ...value,
      tiers: value.tiers.map((t, i) => (i === idx ? next : t)),
    });
  };
  return (
    <div className="grid gap-4">
      <Field label="Section headline">
        <input
          type="text"
          value={value.headline}
          onChange={(e) => onChange({ ...value, headline: e.target.value })}
          maxLength={120}
          className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
        />
      </Field>
      <ul className="grid gap-3">
        {value.tiers.map((t, i) => (
          <li
            key={i}
            className="grid gap-2 rounded-2xl border border-ink-800 bg-ink-950/40 p-3"
          >
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
              <input
                type="text"
                value={t.name}
                onChange={(e) => setTier(i, { ...t, name: e.target.value })}
                maxLength={40}
                className="rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-sm font-semibold text-ink-100 focus-ring"
              />
              <span className="font-mono text-xs text-ink-500">$/mo</span>
              <input
                type="number"
                value={t.price_usd_monthly}
                onChange={(e) =>
                  setTier(i, {
                    ...t,
                    price_usd_monthly: Number(e.target.value),
                  })
                }
                min={0}
                className="w-24 rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-sm tabular-nums text-ink-100 focus-ring"
              />
            </div>
            <input
              type="text"
              value={t.target_segment}
              onChange={(e) =>
                setTier(i, { ...t, target_segment: e.target.value })
              }
              maxLength={120}
              placeholder="Target segment"
              className="rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-xs text-ink-200 focus-ring"
            />
            <textarea
              value={t.features.join("\n")}
              onChange={(e) =>
                setTier(i, {
                  ...t,
                  features: e.target.value.split("\n").filter((s) => s.trim()),
                })
              }
              rows={Math.max(3, t.features.length)}
              placeholder="One feature per line."
              className="resize-none rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-sm text-ink-100 focus-ring"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={t.cta_label ?? ""}
                onChange={(e) =>
                  setTier(i, { ...t, cta_label: e.target.value })
                }
                placeholder="CTA label"
                maxLength={40}
                className="rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-xs text-ink-100 focus-ring"
              />
              <input
                type="text"
                value={t.cta_href ?? ""}
                onChange={(e) => setTier(i, { ...t, cta_href: e.target.value })}
                placeholder="CTA href"
                maxLength={300}
                className="rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 font-mono text-xs text-ink-100 focus-ring"
              />
            </div>
            <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-xs text-ink-300">
              <input
                type="checkbox"
                checked={Boolean(t.highlighted)}
                onChange={(e) =>
                  setTier(i, { ...t, highlighted: e.target.checked })
                }
                className="h-3.5 w-3.5 accent-accent-500"
              />
              Highlight this tier
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Testimonials ────────────────────────────────────────────────────────────

function TestimonialsEditor({
  value,
  onChange,
}: {
  value: { headline: string; testimonials: LandingTestimonial[] };
  onChange: (next: {
    headline: string;
    testimonials: LandingTestimonial[];
  }) => void;
}): JSX.Element {
  const addOne = () => {
    onChange({
      ...value,
      testimonials: [
        ...value.testimonials,
        { quote: "", author: "", role: "", company: "" },
      ],
    });
  };
  const setOne = (idx: number, next: LandingTestimonial) => {
    onChange({
      ...value,
      testimonials: value.testimonials.map((t, i) => (i === idx ? next : t)),
    });
  };
  const removeOne = (idx: number) => {
    onChange({
      ...value,
      testimonials: value.testimonials.filter((_, i) => i !== idx),
    });
  };
  return (
    <div className="grid gap-4">
      <Field label="Section headline">
        <input
          type="text"
          value={value.headline}
          onChange={(e) => onChange({ ...value, headline: e.target.value })}
          maxLength={120}
          className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
        />
      </Field>
      {value.testimonials.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-800 bg-ink-950/40 px-4 py-6 text-center text-xs text-ink-500">
          No testimonials yet. Real quotes only — placeholders read as fake.
        </p>
      ) : (
        <ul className="grid gap-3">
          {value.testimonials.map((t, i) => (
            <li
              key={i}
              className="grid gap-2 rounded-2xl border border-ink-800 bg-ink-950/40 p-3"
            >
              <textarea
                value={t.quote}
                onChange={(e) => setOne(i, { ...t, quote: e.target.value })}
                rows={3}
                placeholder="The quote (use exact words)."
                className="resize-none rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={t.author}
                  onChange={(e) => setOne(i, { ...t, author: e.target.value })}
                  placeholder="Real name"
                  className="rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-xs text-ink-100 focus-ring"
                />
                <input
                  type="text"
                  value={t.role}
                  onChange={(e) => setOne(i, { ...t, role: e.target.value })}
                  placeholder="Role"
                  className="rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-xs text-ink-100 focus-ring"
                />
                <input
                  type="text"
                  value={t.company ?? ""}
                  onChange={(e) => setOne(i, { ...t, company: e.target.value })}
                  placeholder="Company"
                  className="rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-xs text-ink-100 focus-ring"
                />
              </div>
              <button
                type="button"
                onClick={() => removeOne(i)}
                className="justify-self-end text-[11px] text-ink-500 hover:text-rose-300 focus-ring"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={addOne}
        className="grid grid-cols-[auto_1fr] items-center justify-self-start gap-2 rounded-full border border-dashed border-ink-700 bg-ink-900/30 px-4 py-2 text-xs text-ink-300 hover:border-accent-500/40 focus-ring"
      >
        <Plus className="h-3.5 w-3.5" />
        Add testimonial
      </button>
    </div>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

function FAQEditor({
  value,
  onChange,
}: {
  value: { headline: string; entries: LandingFAQEntry[] };
  onChange: (next: { headline: string; entries: LandingFAQEntry[] }) => void;
}): JSX.Element {
  const setOne = (idx: number, next: LandingFAQEntry) => {
    onChange({
      ...value,
      entries: value.entries.map((e, i) => (i === idx ? next : e)),
    });
  };
  return (
    <div className="grid gap-4">
      <Field label="Section headline">
        <input
          type="text"
          value={value.headline}
          onChange={(e) => onChange({ ...value, headline: e.target.value })}
          maxLength={120}
          className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
        />
      </Field>
      <ul className="grid gap-3">
        {value.entries.map((entry, i) => (
          <li
            key={i}
            className="grid gap-2 rounded-2xl border border-ink-800 bg-ink-950/40 p-3"
          >
            <input
              type="text"
              value={entry.question}
              onChange={(e) =>
                setOne(i, { ...entry, question: e.target.value })
              }
              maxLength={160}
              placeholder="Question"
              className="rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-sm font-semibold text-ink-100 focus-ring"
            />
            <textarea
              value={entry.answer}
              onChange={(e) => setOne(i, { ...entry, answer: e.target.value })}
              rows={3}
              maxLength={600}
              placeholder="Answer"
              className="resize-none rounded-md border border-ink-800 bg-ink-950 px-3 py-1.5 text-sm text-ink-200 focus-ring"
            />
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  entries: value.entries.filter((_, j) => j !== i),
                })
              }
              className="justify-self-end text-[11px] text-ink-500 hover:text-rose-300 focus-ring"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() =>
          onChange({
            ...value,
            entries: [...value.entries, { question: "", answer: "" }],
          })
        }
        className="grid grid-cols-[auto_1fr] items-center justify-self-start gap-2 rounded-full border border-dashed border-ink-700 bg-ink-900/30 px-4 py-2 text-xs text-ink-300 hover:border-accent-500/40 focus-ring"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Q&amp;A
      </button>
    </div>
  );
}

// ─── CTA + Footer ────────────────────────────────────────────────────────────

function CTAEditor({
  value,
  onChange,
}: {
  value: {
    headline: string;
    body: string;
    cta_label: string;
    cta_href: string;
  };
  onChange: (next: {
    headline: string;
    body: string;
    cta_label: string;
    cta_href: string;
  }) => void;
}): JSX.Element {
  return (
    <div className="grid gap-3">
      <Field label="Headline">
        <input
          type="text"
          value={value.headline}
          onChange={(e) => onChange({ ...value, headline: e.target.value })}
          maxLength={120}
          className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
        />
      </Field>
      <Field label="Body">
        <textarea
          value={value.body}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          rows={3}
          maxLength={300}
          className="w-full resize-none rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-200 focus-ring"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CTA label">
          <input
            type="text"
            value={value.cta_label}
            onChange={(e) => onChange({ ...value, cta_label: e.target.value })}
            maxLength={40}
            className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
          />
        </Field>
        <Field label="CTA href">
          <input
            type="text"
            value={value.cta_href}
            onChange={(e) => onChange({ ...value, cta_href: e.target.value })}
            maxLength={300}
            className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-xs text-ink-100 focus-ring"
          />
        </Field>
      </div>
    </div>
  );
}

function FooterEditor({
  value,
  onChange,
}: {
  value: import("../../lib/composeLandingHtml").LandingFooter;
  onChange: (
    next: import("../../lib/composeLandingHtml").LandingFooter,
  ) => void;
}): JSX.Element {
  return (
    <div className="grid gap-3">
      <Field label="Company name">
        <input
          type="text"
          value={value.company_name}
          onChange={(e) => onChange({ ...value, company_name: e.target.value })}
          maxLength={80}
          className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
        />
      </Field>
      <Field label="Tagline">
        <input
          type="text"
          value={value.tagline ?? ""}
          onChange={(e) => onChange({ ...value, tagline: e.target.value })}
          maxLength={120}
          className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
        />
      </Field>
      <Field label="Copyright">
        <input
          type="text"
          value={value.copyright ?? ""}
          onChange={(e) => onChange({ ...value, copyright: e.target.value })}
          maxLength={200}
          className="w-full rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus-ring"
        />
      </Field>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-ink-500">
        {label}
      </span>
      {children}
    </label>
  );
}

interface RichTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxChars: number;
  minHeight?: number;
}

function RichTextarea({
  value,
  onChange,
  placeholder,
  maxChars,
  minHeight = 60,
}: RichTextareaProps): JSX.Element {
  // We use Tiptap for the toolbar but persist the plain-text serialization to
  // avoid leaking arbitrary HTML to composeLandingHtml. The editor produces
  // HTML; we strip tags before persisting.
  const editor = useEditor({
    // The toolbar reads selection state directly from the editor.
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    onUpdate: ({ editor: ed }) => {
      const text = ed.getText().slice(0, maxChars);
      onChange(text);
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-invert max-w-none rounded-md border border-ink-800 bg-ink-950 p-3 text-sm text-ink-100 focus:border-accent-500/40 focus:outline-none [&_p]:m-0",
        "data-mask": "true",
        spellcheck: "true",
      },
    },
  });

  // Keep editor in sync if parent overwrites value (e.g. preset swap).
  useEffect(() => {
    if (!editor) return;
    if (editor.getText() === value) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  if (!editor) {
    return (
      <textarea
        defaultValue={value}
        placeholder={placeholder}
        rows={3}
        onChange={(e) => onChange(e.target.value.slice(0, maxChars))}
        style={{ minHeight }}
        className="w-full resize-none rounded-md border border-ink-800 bg-ink-950 p-3 text-sm text-ink-100 focus-ring"
      />
    );
  }

  return (
    <div className="grid gap-1">
      <Toolbar editor={editor} />
      <div style={{ minHeight }}>
        <EditorContent editor={editor} />
      </div>
      <span className="justify-self-end font-mono text-[10px] tabular-nums text-ink-500">
        {editor.getText().length} / {maxChars}
      </span>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }): JSX.Element {
  const items = [
    {
      id: "bold",
      icon: Bold,
      isActive: editor.isActive("bold"),
      onClick: () => editor.chain().focus().toggleBold().run(),
    },
    {
      id: "italic",
      icon: Italic,
      isActive: editor.isActive("italic"),
      onClick: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      id: "list",
      icon: List,
      isActive: editor.isActive("bulletList"),
      onClick: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: "link",
      icon: Link2,
      isActive: false,
      onClick: () => {
        const url = window.prompt("URL");
        if (!url) return;
        editor
          .chain()
          .focus()
          .setMark("link" as never, { href: url } as never)
          .run();
      },
    },
  ];
  return (
    <div className="flex items-center gap-1 rounded-md border border-ink-800 bg-ink-950 p-1">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={it.onClick}
          aria-pressed={it.isActive}
          className={cn(
            "rounded p-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-50 focus-ring",
            it.isActive && "bg-ink-800 text-accent-500",
          )}
        >
          <it.icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

// ─── Image slot with regen ──────────────────────────────────────────────────

interface ImageSlotProps {
  sessionId: string;
  label: string;
  target: "hero" | "feature" | "logo" | "slide";
  targetId?: string;
  url: string | null;
  onChange: (url: string | null) => void;
  compact?: boolean;
}

function ImageSlot({
  sessionId,
  label,
  target,
  targetId,
  url,
  onChange,
  compact,
}: ImageSlotProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regen = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.regenerateImage(
        targetId
          ? { session_id: sessionId, target, target_id: targetId }
          : { session_id: sessionId, target },
      );
      onChange(res.image_url);
    } catch (e) {
      const msg =
        e instanceof APIError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Image regen failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [onChange, sessionId, target, targetId]);

  return (
    <div
      className={cn(
        "grid gap-2",
        compact ? "" : "rounded-2xl border border-ink-800 bg-ink-950/40 p-3",
      )}
    >
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-ink-500">
          {label}
        </span>
        <button
          type="button"
          onClick={() => void regen()}
          disabled={busy}
          className="grid grid-cols-[auto_1fr] items-center gap-1.5 rounded-full border border-ink-800 bg-ink-900/60 px-3 py-1 text-[11px] text-ink-200 hover:bg-ink-900 focus-ring disabled:opacity-50"
        >
          {busy ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <Wand2 className="h-3 w-3" />
          )}
          {busy ? "Generating…" : "Regenerate"}
        </button>
      </div>
      <div
        className={cn(
          "grid place-items-center overflow-hidden rounded-md border border-ink-800 bg-ink-900/40",
          compact ? "aspect-video" : "aspect-[16/9]",
        )}
      >
        {url ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-ink-600">
            <ImageIcon className="h-6 w-6" aria-hidden />
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}
