/**
 * composeLandingHtml — render LandingPageResult + per-section overrides into
 * a single HTML+CSS string suitable for SandboxedIframe srcDoc.
 *
 * The LandingEditor edits a structured `LandingSection[]` (NOT raw HTML); when
 * the user wants a preview, this composes that structure into a styled HTML
 * page with brand-token CSS variables injected. All output is run through
 * purifyHTML before being handed to the iframe — defense-in-depth.
 */
import type {
  BrandIdentityResult,
  BusinessModelResult,
  LandingPageResult,
} from "../types/agents";
import { purifyHTML } from "./purify";
import {
  contrastRatio,
  darken,
  lighten,
  normalizeHex,
  pickReadableForeground,
} from "./colorMath";

export type LandingSectionType =
  | "hero"
  | "features"
  | "pricing"
  | "testimonials"
  | "faq"
  | "cta"
  | "footer";

export interface LandingHero {
  variant: "asymmetric" | "centered" | "split";
  eyebrow?: string;
  headline: string;
  subheadline: string;
  cta_label: string;
  cta_href: string;
  hero_image_url?: string | null;
  background_pattern?: "noise" | "grid" | "none";
}

export interface LandingFeature {
  title: string;
  description: string;
  icon_name?: string;
  image_url?: string | null;
  emphasis?: boolean;
}

export interface LandingPricingTier {
  name: string;
  price_usd_monthly: number;
  features: string[];
  target_segment: string;
  highlighted?: boolean;
  cta_label?: string;
  cta_href?: string;
}

export interface LandingTestimonial {
  quote: string;
  author: string;
  role: string;
  company?: string;
  avatar_url?: string | null;
}

export interface LandingFAQEntry {
  question: string;
  answer: string;
}

export interface LandingCTA {
  headline: string;
  body: string;
  cta_label: string;
  cta_href: string;
}

export interface LandingFooter {
  company_name: string;
  tagline?: string;
  columns: { title: string; links: { label: string; href: string }[] }[];
  copyright?: string;
}

export type LandingSection =
  | { id: string; type: "hero"; data: LandingHero; locked?: boolean; updatedAt?: number }
  | {
      id: string;
      type: "features";
      data: { headline: string; subheadline?: string; features: LandingFeature[] };
      locked?: boolean;
      updatedAt?: number;
    }
  | {
      id: string;
      type: "pricing";
      data: { headline: string; tiers: LandingPricingTier[] };
      locked?: boolean;
      updatedAt?: number;
    }
  | {
      id: string;
      type: "testimonials";
      data: { headline: string; testimonials: LandingTestimonial[] };
      locked?: boolean;
      updatedAt?: number;
    }
  | {
      id: string;
      type: "faq";
      data: { headline: string; entries: LandingFAQEntry[] };
      locked?: boolean;
      updatedAt?: number;
    }
  | { id: string; type: "cta"; data: LandingCTA; locked?: boolean; updatedAt?: number }
  | { id: string; type: "footer"; data: LandingFooter; locked?: boolean; updatedAt?: number };

export interface LandingDoc {
  title: string;
  meta_description: string;
  sections: LandingSection[];
  /** Optional per-section color overrides: section.id -> { bg, fg, accent }. */
  section_color_overrides?: Record<
    string,
    { bg?: string; fg?: string; accent?: string }
  >;
}

/** Build LandingDoc from a fresh LandingPageResult — placeholder structure
 * the user can iterate on. The real source-of-truth structured sections come
 * from the agent, but we always seed a usable starting point. */
export function seedLandingDoc(
  result: LandingPageResult,
  brand: BrandIdentityResult | null,
  business: BusinessModelResult | null,
): LandingDoc {
  const company = brand?.company_name ?? result.title.split(" — ")[0] ?? "Untitled";
  const tagline = brand?.tagline ?? result.meta_description;
  const tiers: LandingPricingTier[] =
    business?.pricing_tiers.map((t, i) => ({
      name: t.name,
      price_usd_monthly: t.price_usd_monthly,
      features: t.features,
      target_segment: t.target_segment,
      highlighted: i === 1,
      cta_label: i === 0 ? "Start free" : "Choose plan",
      cta_href: "#signup",
    })) ?? [];

  return {
    title: result.title,
    meta_description: result.meta_description,
    sections: [
      {
        id: "hero",
        type: "hero",
        data: {
          variant: "asymmetric",
          eyebrow: brand?.industry_keywords[0] ?? undefined,
          headline: tagline,
          subheadline:
            result.meta_description ||
            `${company} helps you ship faster without sacrificing rigor.`,
          cta_label: "Get early access",
          cta_href: "#signup",
          hero_image_url: result.hero_image_url ?? null,
          background_pattern: "noise",
        },
      },
      {
        id: "features",
        type: "features",
        data: {
          headline: "Built for the work, not the demo.",
          subheadline: "What you get when you invest 30 seconds.",
          features: [
            {
              title: "Direct-source data",
              description:
                "Every metric on your dashboard ties back to a primary source. No silent estimates.",
              emphasis: true,
            },
            {
              title: "Branchable scenarios",
              description:
                "Fork the model. Compare side by side. Roll back without losing a thing.",
            },
            {
              title: "Real owner files",
              description:
                "Sheets, Slides, and Docs land in your Drive — owned by you, not a service account.",
            },
          ],
        },
      },
      ...(tiers.length > 0
        ? [
            {
              id: "pricing",
              type: "pricing" as const,
              data: { headline: "Simple, honest pricing.", tiers },
            },
          ]
        : []),
      {
        id: "testimonials",
        type: "testimonials",
        data: {
          headline: "What teams are saying.",
          testimonials: [],
        },
      },
      {
        id: "faq",
        type: "faq",
        data: {
          headline: "Common questions.",
          entries: [
            {
              question: "How is this different from a deck generator?",
              answer:
                "We pair a deterministic finance engine with grounded research and source-cited data. Decks come out the other side already correct.",
            },
            {
              question: "Who owns the files?",
              answer: "You do, at creation, via OAuth.",
            },
          ],
        },
      },
      {
        id: "cta",
        type: "cta",
        data: {
          headline: "Stop staring at a blank deck.",
          body: "Spin up the full company package in 90 seconds. Edit anything before you ship.",
          cta_label: "Start your run",
          cta_href: "#signup",
        },
      },
      {
        id: "footer",
        type: "footer",
        data: {
          company_name: company,
          tagline,
          columns: [
            {
              title: "Product",
              links: [
                { label: "Features", href: "#features" },
                { label: "Pricing", href: "#pricing" },
              ],
            },
            {
              title: "Company",
              links: [
                { label: "About", href: "#" },
                { label: "Contact", href: "mailto:hello@example.com" },
              ],
            },
            {
              title: "Legal",
              links: [
                { label: "Terms", href: "/terms" },
                { label: "Privacy", href: "/privacy" },
              ],
            },
          ],
          copyright: `© ${new Date().getFullYear()} ${company}. All rights reserved.`,
        },
      },
    ],
  };
}

/** Token shape applied as CSS custom properties in the iframe. */
export interface ResolvedTokens {
  bg: string;
  fg: string;
  accent: string;
  primary: string;
  secondary: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  fgMuted: string;
}

export function resolveBrandTokens(brand: BrandIdentityResult | null): ResolvedTokens {
  const palette = brand?.color_palette ?? [];
  const find = (role: string) => palette.find((c) => c.role === role)?.hex;
  const accent = normalizeHex(find("accent") ?? "#FF5A1F");
  const primary = normalizeHex(find("primary") ?? accent);
  const secondary = normalizeHex(find("secondary") ?? lighten(primary, 0.4));
  const bg = normalizeHex(find("background") ?? "#FAFAFA");
  const fg = normalizeHex(find("text") ?? pickReadableForeground(bg));
  const muted = normalizeHex(find("neutral_dark") ?? "#27272A");
  const surface =
    contrastRatio(bg, "#FFFFFF") > contrastRatio(bg, "#000000")
      ? darken(bg, 0.04)
      : lighten(bg, 0.04);
  return {
    bg,
    fg,
    accent,
    primary,
    secondary,
    surface,
    surfaceMuted: lighten(muted, 0.6),
    border: lighten(muted, 0.4),
    fgMuted: lighten(fg, 0.35),
  };
}

function escape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(input: string): string {
  // Strip any javascript:/data: hrefs at compose time; purify is final defense.
  if (/^\s*javascript:/i.test(input)) return "#";
  return escape(input);
}

function renderHero(s: { id: string; data: LandingHero }): string {
  const { eyebrow, headline, subheadline, cta_label, cta_href, hero_image_url, variant } = s.data;
  if (variant === "centered") {
    return `<section class="pm-hero pm-hero--centered" data-section="${s.id}">
      <div class="pm-hero-inner">
        ${eyebrow ? `<div class="pm-eyebrow">${escape(eyebrow)}</div>` : ""}
        <h1 class="pm-h1">${escape(headline)}</h1>
        <p class="pm-sub">${escape(subheadline)}</p>
        <a class="pm-cta" href="${escapeAttr(cta_href)}">${escape(cta_label)}</a>
      </div>
    </section>`;
  }
  if (variant === "split") {
    return `<section class="pm-hero pm-hero--split" data-section="${s.id}">
      <div class="pm-hero-text">
        ${eyebrow ? `<div class="pm-eyebrow">${escape(eyebrow)}</div>` : ""}
        <h1 class="pm-h1">${escape(headline)}</h1>
        <p class="pm-sub">${escape(subheadline)}</p>
        <a class="pm-cta" href="${escapeAttr(cta_href)}">${escape(cta_label)}</a>
      </div>
      <div class="pm-hero-art">
        ${
          hero_image_url
            ? `<img src="${escapeAttr(hero_image_url)}" alt="" loading="lazy" decoding="async" />`
            : `<div class="pm-art-placeholder" aria-hidden="true"></div>`
        }
      </div>
    </section>`;
  }
  // asymmetric
  return `<section class="pm-hero pm-hero--asym" data-section="${s.id}">
    <div class="pm-hero-text">
      ${eyebrow ? `<div class="pm-eyebrow">${escape(eyebrow)}</div>` : ""}
      <h1 class="pm-h1 pm-h1--display">${escape(headline)}</h1>
      <p class="pm-sub">${escape(subheadline)}</p>
      <a class="pm-cta" href="${escapeAttr(cta_href)}">${escape(cta_label)} <span aria-hidden="true">→</span></a>
    </div>
    ${
      hero_image_url
        ? `<figure class="pm-hero-figure"><img src="${escapeAttr(hero_image_url)}" alt="" loading="lazy" decoding="async" /></figure>`
        : `<figure class="pm-hero-figure"><div class="pm-art-placeholder" aria-hidden="true"></div></figure>`
    }
  </section>`;
}

function renderFeatures(
  s: {
    id: string;
    data: { headline: string; subheadline?: string; features: LandingFeature[] };
  },
): string {
  const { headline, subheadline, features } = s.data;
  if (features.length === 0) return "";
  const [primary, ...rest] = features;
  return `<section class="pm-features" data-section="${s.id}">
    <header class="pm-section-header">
      <h2 class="pm-h2">${escape(headline)}</h2>
      ${subheadline ? `<p class="pm-sub">${escape(subheadline)}</p>` : ""}
    </header>
    <div class="pm-bento">
      ${
        primary
          ? `<article class="pm-bento-cell pm-bento-cell--lead">
              <h3 class="pm-h3">${escape(primary.title)}</h3>
              <p>${escape(primary.description)}</p>
            </article>`
          : ""
      }
      ${rest
        .slice(0, 3)
        .map(
          (f) => `<article class="pm-bento-cell">
            <h3 class="pm-h3">${escape(f.title)}</h3>
            <p>${escape(f.description)}</p>
          </article>`,
        )
        .join("")}
    </div>
  </section>`;
}

function renderPricing(s: {
  id: string;
  data: { headline: string; tiers: LandingPricingTier[] };
}): string {
  const { headline, tiers } = s.data;
  if (tiers.length === 0) return "";
  return `<section class="pm-pricing" data-section="${s.id}">
    <header class="pm-section-header">
      <h2 class="pm-h2">${escape(headline)}</h2>
    </header>
    <div class="pm-pricing-grid" data-cols="${tiers.length}">
      ${tiers
        .map(
          (t) => `<article class="pm-tier ${t.highlighted ? "pm-tier--featured" : ""}">
            <h3 class="pm-h3">${escape(t.name)}</h3>
            <div class="pm-price">
              <span class="pm-price-num">$${t.price_usd_monthly.toFixed(0)}</span>
              <span class="pm-price-unit">/ mo</span>
            </div>
            <p class="pm-tier-segment">${escape(t.target_segment)}</p>
            <ul class="pm-tier-features">
              ${t.features.map((f) => `<li>${escape(f)}</li>`).join("")}
            </ul>
            <a class="pm-cta ${t.highlighted ? "" : "pm-cta--ghost"}" href="${escapeAttr(t.cta_href ?? "#")}">${escape(t.cta_label ?? "Choose plan")}</a>
          </article>`,
        )
        .join("")}
    </div>
  </section>`;
}

function renderTestimonials(s: {
  id: string;
  data: { headline: string; testimonials: LandingTestimonial[] };
}): string {
  const { headline, testimonials } = s.data;
  if (testimonials.length === 0) return "";
  return `<section class="pm-testimonials" data-section="${s.id}">
    <header class="pm-section-header"><h2 class="pm-h2">${escape(headline)}</h2></header>
    <div class="pm-testimonial-grid">
      ${testimonials
        .map(
          (t) => `<figure class="pm-testimonial">
            <blockquote>"${escape(t.quote)}"</blockquote>
            <figcaption>
              <strong>${escape(t.author)}</strong>
              <span>${escape(t.role)}${t.company ? `, ${escape(t.company)}` : ""}</span>
            </figcaption>
          </figure>`,
        )
        .join("")}
    </div>
  </section>`;
}

function renderFAQ(s: {
  id: string;
  data: { headline: string; entries: LandingFAQEntry[] };
}): string {
  const { headline, entries } = s.data;
  if (entries.length === 0) return "";
  return `<section class="pm-faq" data-section="${s.id}">
    <header class="pm-section-header"><h2 class="pm-h2">${escape(headline)}</h2></header>
    <ul class="pm-faq-list">
      ${entries
        .map(
          (e) => `<li>
            <details>
              <summary>${escape(e.question)}</summary>
              <p>${escape(e.answer)}</p>
            </details>
          </li>`,
        )
        .join("")}
    </ul>
  </section>`;
}

function renderCTA(s: { id: string; data: LandingCTA }): string {
  const { headline, body, cta_label, cta_href } = s.data;
  return `<section class="pm-final-cta" data-section="${s.id}">
    <h2 class="pm-h2">${escape(headline)}</h2>
    <p class="pm-sub">${escape(body)}</p>
    <a class="pm-cta" href="${escapeAttr(cta_href)}">${escape(cta_label)}</a>
  </section>`;
}

function renderFooter(s: { id: string; data: LandingFooter }): string {
  const { company_name, tagline, columns, copyright } = s.data;
  return `<footer class="pm-footer" data-section="${s.id}">
    <div class="pm-footer-grid">
      <div class="pm-footer-brand">
        <strong>${escape(company_name)}</strong>
        ${tagline ? `<p>${escape(tagline)}</p>` : ""}
      </div>
      ${columns
        .map(
          (col) => `<nav>
            <h4>${escape(col.title)}</h4>
            <ul>${col.links.map((l) => `<li><a href="${escapeAttr(l.href)}">${escape(l.label)}</a></li>`).join("")}</ul>
          </nav>`,
        )
        .join("")}
    </div>
    ${copyright ? `<p class="pm-copyright">${escape(copyright)}</p>` : ""}
  </footer>`;
}

function renderSection(section: LandingSection): string {
  switch (section.type) {
    case "hero":
      return renderHero(section);
    case "features":
      return renderFeatures(section);
    case "pricing":
      return renderPricing(section);
    case "testimonials":
      return renderTestimonials(section);
    case "faq":
      return renderFAQ(section);
    case "cta":
      return renderCTA(section);
    case "footer":
      return renderFooter(section);
  }
}

const BASE_CSS = `
:root{
  --pm-bg: #fafafa;
  --pm-fg: #18181b;
  --pm-fg-muted: #52525b;
  --pm-surface: #ffffff;
  --pm-surface-muted: #f4f4f5;
  --pm-border: #e4e4e7;
  --pm-accent: #ff5a1f;
  --pm-primary: #18181b;
  --pm-secondary: #71717a;
  --pm-radius: 18px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--pm-bg);color:var(--pm-fg);font-family:Geist,system-ui,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;display:block}
a{color:var(--pm-fg);text-underline-offset:2px}
.pm-eyebrow{display:inline-block;font-size:.75rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--pm-accent);padding:.4em .8em;border:1px solid color-mix(in oklab,var(--pm-accent) 30%,transparent);border-radius:999px;margin-bottom:1.25rem}
.pm-h1{font-family:'Cabinet Grotesk',Geist,system-ui,sans-serif;font-size:clamp(2.4rem,6vw,4.6rem);line-height:1.05;letter-spacing:-0.02em;margin:0 0 1rem;font-weight:600}
.pm-h1--display{font-size:clamp(3rem,8vw,6.4rem)}
.pm-h2{font-family:'Cabinet Grotesk',Geist,system-ui,sans-serif;font-size:clamp(1.6rem,3.6vw,2.6rem);line-height:1.1;margin:0 0 .75rem;font-weight:600;letter-spacing:-0.01em}
.pm-h3{font-family:'Cabinet Grotesk',Geist,system-ui,sans-serif;font-size:1.25rem;line-height:1.2;margin:0 0 .5rem;font-weight:600}
.pm-sub{font-size:1.05rem;color:var(--pm-fg-muted);max-width:64ch}
.pm-cta{display:inline-flex;align-items:center;gap:.5em;background:var(--pm-accent);color:#fff;font-weight:600;padding:.85rem 1.4rem;border-radius:999px;text-decoration:none;transition:transform .25s ease}
.pm-cta:hover{transform:translateY(-1px)}
.pm-cta--ghost{background:transparent;color:var(--pm-fg);border:1px solid var(--pm-border)}
.pm-section-header{margin-bottom:2.4rem;max-width:64ch}
.pm-hero{padding:5rem 6vw 4rem}
.pm-hero--centered{text-align:center}
.pm-hero--centered .pm-eyebrow{margin-inline:auto}
.pm-hero--centered .pm-sub{margin-inline:auto}
.pm-hero--asym{display:grid;grid-template-columns:1.2fr .8fr;gap:3rem;align-items:end}
.pm-hero-figure{margin:0;border-radius:var(--pm-radius);overflow:hidden;background:var(--pm-surface-muted);aspect-ratio:4/5}
.pm-hero--split{display:grid;grid-template-columns:1fr 1fr;gap:3rem;align-items:center}
.pm-art-placeholder{width:100%;height:100%;background:linear-gradient(135deg,var(--pm-surface-muted),var(--pm-surface));aspect-ratio:4/3}
.pm-features{padding:4rem 6vw}
.pm-bento{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:1fr;gap:1.25rem}
.pm-bento-cell{background:var(--pm-surface);border:1px solid var(--pm-border);border-radius:var(--pm-radius);padding:1.75rem;display:grid;grid-template-rows:auto 1fr;gap:.5rem}
.pm-bento-cell--lead{grid-column:span 2;grid-row:span 2;background:color-mix(in oklab,var(--pm-accent) 10%,var(--pm-surface));border-color:color-mix(in oklab,var(--pm-accent) 30%,var(--pm-border))}
.pm-pricing{padding:4rem 6vw;background:var(--pm-surface-muted)}
.pm-pricing-grid{display:grid;grid-template-columns:repeat(var(--cols, 3),minmax(0,1fr));gap:1.25rem}
.pm-pricing-grid[data-cols="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}
.pm-pricing-grid[data-cols="4"]{grid-template-columns:repeat(4,minmax(0,1fr))}
.pm-tier{background:var(--pm-surface);border:1px solid var(--pm-border);border-radius:var(--pm-radius);padding:2rem;display:grid;gap:1rem;align-content:start}
.pm-tier--featured{border-color:var(--pm-accent);box-shadow:0 30px 60px -30px color-mix(in oklab,var(--pm-accent) 25%,transparent)}
.pm-price{display:flex;align-items:baseline;gap:.25rem}
.pm-price-num{font-family:'Cabinet Grotesk',Geist,system-ui,sans-serif;font-size:2.4rem;font-weight:600}
.pm-price-unit{color:var(--pm-fg-muted)}
.pm-tier-segment{color:var(--pm-fg-muted);font-size:.9rem;margin:0}
.pm-tier-features{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
.pm-tier-features li{font-size:.95rem;padding-left:1.25rem;position:relative}
.pm-tier-features li::before{content:"";position:absolute;left:0;top:.55em;width:.55rem;height:.55rem;border:2px solid var(--pm-accent);border-top:0;border-right:0;transform:rotate(-45deg)}
.pm-testimonials{padding:4rem 6vw}
.pm-testimonial-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1.25rem}
.pm-testimonial{background:var(--pm-surface);border:1px solid var(--pm-border);border-radius:var(--pm-radius);padding:1.5rem;margin:0}
.pm-testimonial blockquote{margin:0 0 1rem;font-size:1.1rem;line-height:1.4}
.pm-testimonial figcaption strong{display:block;font-weight:600}
.pm-testimonial figcaption span{display:block;color:var(--pm-fg-muted);font-size:.9rem}
.pm-faq{padding:4rem 6vw}
.pm-faq-list{list-style:none;padding:0;margin:0;display:grid;gap:.75rem;max-width:64ch}
.pm-faq details{background:var(--pm-surface);border:1px solid var(--pm-border);border-radius:14px;padding:1.1rem 1.25rem}
.pm-faq summary{font-weight:600;cursor:pointer}
.pm-final-cta{padding:5rem 6vw;text-align:center;background:color-mix(in oklab,var(--pm-accent) 12%,var(--pm-bg))}
.pm-final-cta .pm-sub{margin:1rem auto}
.pm-footer{padding:3rem 6vw 2rem;border-top:1px solid var(--pm-border);background:var(--pm-surface)}
.pm-footer-grid{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:2rem;margin-bottom:2rem}
.pm-footer-brand strong{font-family:'Cabinet Grotesk',Geist,system-ui,sans-serif;font-size:1.2rem;display:block;margin-bottom:.5rem}
.pm-footer-brand p{color:var(--pm-fg-muted);font-size:.9rem;margin:0}
.pm-footer h4{font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;margin:0 0 .75rem;color:var(--pm-fg-muted)}
.pm-footer ul{list-style:none;padding:0;margin:0;display:grid;gap:.4rem;font-size:.93rem}
.pm-footer a{text-decoration:none}
.pm-copyright{font-size:.85rem;color:var(--pm-fg-muted);margin:0}
@media (max-width:900px){
  .pm-hero--asym,.pm-hero--split{grid-template-columns:1fr}
  .pm-bento{grid-template-columns:1fr}
  .pm-bento-cell--lead{grid-column:auto;grid-row:auto}
  .pm-pricing-grid,.pm-pricing-grid[data-cols="3"],.pm-pricing-grid[data-cols="4"]{grid-template-columns:1fr}
  .pm-footer-grid{grid-template-columns:1fr 1fr}
}
`;

export interface ComposeResult {
  html: string;
  css: string;
}

/**
 * Compose final HTML+CSS from a LandingDoc.
 * Output HTML is purified by purifyHTML() — second-line defense before iframe.
 */
export function composeLandingHtml(
  doc: LandingDoc,
  brand: BrandIdentityResult | null,
): ComposeResult {
  const tokens = resolveBrandTokens(brand);
  const css = `
${BASE_CSS}
:root{
  --pm-bg: ${tokens.bg};
  --pm-fg: ${tokens.fg};
  --pm-fg-muted: ${tokens.fgMuted};
  --pm-surface: ${tokens.surface};
  --pm-surface-muted: ${tokens.surfaceMuted};
  --pm-border: ${tokens.border};
  --pm-accent: ${tokens.accent};
  --pm-primary: ${tokens.primary};
  --pm-secondary: ${tokens.secondary};
}
${(doc.section_color_overrides
  ? Object.entries(doc.section_color_overrides)
      .map(([id, vars]) => {
        const out: string[] = [];
        if (vars.bg) out.push(`--pm-bg: ${normalizeHex(vars.bg)};`);
        if (vars.fg) out.push(`--pm-fg: ${normalizeHex(vars.fg)};`);
        if (vars.accent) out.push(`--pm-accent: ${normalizeHex(vars.accent)};`);
        return `[data-section="${id}"]{${out.join("")}}`;
      })
      .join("\n")
  : "")}
`;
  const body = doc.sections.map((s) => renderSection(s)).join("\n");
  const safeBody = purifyHTML(body);
  return { html: safeBody, css };
}

/** Map a LandingDoc back into LandingPageResult (post-edit save). */
export function flattenLandingDoc(
  doc: LandingDoc,
  brand: BrandIdentityResult | null,
): { html_sanitized: string; css: string; title: string; meta_description: string } {
  const { html, css } = composeLandingHtml(doc, brand);
  return {
    html_sanitized: html,
    css,
    title: doc.title,
    meta_description: doc.meta_description,
  };
}
