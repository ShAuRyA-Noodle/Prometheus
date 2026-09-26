/**
 * Shared types + helpers for slide layouts.
 *
 * Each layout component renders a 16:9 frame at the design size of 1280x720.
 * The wrapping SlideCanvas applies CSS scale() to fit the viewport — layouts
 * therefore deal in absolute design pixels (and percentages of design size).
 */
import type {
  BrandIdentityResult,
  PitchSlide,
  ColorEntry,
} from "../../../types/agents";

export interface LayoutProps {
  slide: PitchSlide;
  brand: BrandIdentityResult | null;
  /** Hook for inline editing — caller provides Tiptap editor or a plain editable block. */
  bodyEditor?: React.ReactNode;
  /** Callback when the body region is double-clicked → engage editor. */
  onActivateBody?: () => void;
  /** Optional speaker-notes editor instance (rendered in drawer, not on slide). */
  speakerNotesEditor?: React.ReactNode;
  /** Index for animation staggering. */
  index?: number;
}

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

export function pickColor(
  brand: BrandIdentityResult | null,
  role: ColorEntry["role"],
  fallback: string,
): string {
  if (!brand) return fallback;
  const entry = brand.color_palette.find((c) => c.role === role);
  return entry?.hex ?? fallback;
}

export function brandPalette(brand: BrandIdentityResult | null): {
  primary: string;
  accent: string;
  bg: string;
  fg: string;
  muted: string;
} {
  return {
    primary: pickColor(brand, "primary", "#FF5A1F"),
    accent: pickColor(brand, "accent", "#F4F4F5"),
    bg: pickColor(brand, "background", "#0A0A0B"),
    fg: pickColor(brand, "text", "#FAFAFA"),
    muted: pickColor(brand, "neutral_dark", "#27272A"),
  };
}

export function brandFonts(brand: BrandIdentityResult | null): {
  heading: string;
  body: string;
} {
  if (!brand) return { heading: "Cabinet Grotesk, system-ui, sans-serif", body: "Geist, system-ui, sans-serif" };
  return {
    heading: `${brand.typography.heading_font}, Cabinet Grotesk, system-ui, sans-serif`,
    body: `${brand.typography.body_font}, Geist, system-ui, sans-serif`,
  };
}

/** Parse "First Line\nSecond Line" or "- bullet\n- bullet" into segments. */
export interface ParsedBody {
  paragraphs: string[];
  bullets: string[];
  numbered: { label: string; value: string }[];
}

export function parseBody(raw: string): ParsedBody {
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const bullets: string[] = [];
  const paragraphs: string[] = [];
  const numbered: { label: string; value: string }[] = [];
  for (const line of lines) {
    const bm = /^[-•*]\s+(.+)$/.exec(line);
    if (bm) {
      bullets.push(bm[1] ?? "");
      continue;
    }
    const nm = /^([A-Z][A-Za-z0-9 -]{2,}):\s+(.+)$/.exec(line);
    if (nm) {
      numbered.push({ label: nm[1] ?? "", value: nm[2] ?? "" });
      continue;
    }
    paragraphs.push(line);
  }
  return { paragraphs, bullets, numbered };
}
