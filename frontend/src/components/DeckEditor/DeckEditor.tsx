/**
 * DeckEditor — replaces the Google Slides iframe with a native, Pitch.com-style
 * editor. Pitch slides remain the source of truth (PitchSlide[]).
 *
 * Layout (CSS Grid, 3 columns ≥768px, single column <768px):
 *   ┌─────────┬───────────────┬──────────────┐
 *   │ Thumbs  │   SlideCanvas │  AI Rail     │
 *   │ 180px   │     1fr       │   320px      │
 *   └─────────┴───────────────┴──────────────┘
 *
 * Top toolbar: title + export buttons (PDF / PPTX / Google Slides).
 *
 * Keyboard:
 *   ArrowDown/Up         — next/prev slide (when thumbs focused)
 *   Cmd-/Ctrl-D          — duplicate active slide
 *   Cmd-/Ctrl-Backspace  — delete active slide
 *   Cmd-/Ctrl-S          — manual save (parent persists)
 */
import { useCallback, useEffect, useState } from "react";
import { Download, FileImage, Presentation, Save } from "lucide-react";
import type { BrandIdentityResult, PitchDeckResult, PitchSlide } from "../../types/agents";
import { SlideThumbnails } from "./SlideThumbnails";
import { SlideCanvas } from "./SlideCanvas";
import { AIAssistantRail, type RegenDiff } from "./AIAssistantRail";
import { exportDeck, downloadAndSave, deckFilename, openInGoogleSlides } from "../../lib/deckExport";
import { cn } from "../../lib/cn";

export interface DeckEditorProps {
  sessionId: string;
  deck: PitchDeckResult;
  brand: BrandIdentityResult | null;
  onChange: (deck: PitchDeckResult) => void;
  onSave?: (deck: PitchDeckResult) => Promise<void> | void;
  /** Inject the same regen function ResultsView uses. */
  onRegen: (args: {
    scope: "slide" | "deck";
    activeSlideIdx: number;
    steering: string;
    propagate_downstream: boolean;
  }) => Promise<RegenDiff>;
  className?: string;
}

export function DeckEditor({
  sessionId,
  deck,
  brand,
  onChange,
  onSave,
  onRegen,
  className,
}: DeckEditorProps): JSX.Element {
  const [activeIdx, setActiveIdx] = useState(0);
  const [imageBusy, setImageBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState<"pdf" | "pptx" | "gslides" | null>(null);
  const [saving, setSaving] = useState(false);

  const activeSlide = (deck.slides[activeIdx] ?? deck.slides[0])!;

  const updateSlideAt = useCallback(
    (idx: number, patch: Partial<PitchSlide>) => {
      const next = deck.slides.map((s, i) => (i === idx ? { ...s, ...patch } : s));
      onChange({ ...deck, slides: next });
    },
    [deck, onChange],
  );

  const addSlide = useCallback(
    (afterIdx: number) => {
      const newSlide: PitchSlide = {
        slide_number: afterIdx + 2,
        layout: "solution",
        title: "New slide",
        body: "",
        speaker_notes: "",
        image_url: null,
      };
      const next = [
        ...deck.slides.slice(0, afterIdx + 1),
        newSlide,
        ...deck.slides.slice(afterIdx + 1),
      ].map((s, i) => ({ ...s, slide_number: i + 1 }));
      onChange({ ...deck, slides: next });
      setActiveIdx(afterIdx + 1);
    },
    [deck, onChange],
  );

  const duplicateSlide = useCallback(
    (idx: number) => {
      const src = deck.slides[idx];
      if (!src) return;
      const clone: PitchSlide = { ...src, slide_number: idx + 2 };
      const next = [
        ...deck.slides.slice(0, idx + 1),
        clone,
        ...deck.slides.slice(idx + 1),
      ].map((s, i) => ({ ...s, slide_number: i + 1 }));
      onChange({ ...deck, slides: next });
      setActiveIdx(idx + 1);
    },
    [deck, onChange],
  );

  const deleteSlide = useCallback(
    (idx: number) => {
      if (deck.slides.length <= 1) return;
      const next = deck.slides
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, slide_number: i + 1 }));
      onChange({ ...deck, slides: next });
      setActiveIdx((i) => Math.max(0, Math.min(i, next.length - 1)));
    },
    [deck, onChange],
  );

  const reorder = useCallback(
    (from: number, to: number) => {
      const next = [...deck.slides];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      const renum = next.map((s, i) => ({ ...s, slide_number: i + 1 }));
      onChange({ ...deck, slides: renum });
      setActiveIdx(to);
    },
    [deck, onChange],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "s") {
        e.preventDefault();
        if (!onSave) return;
        setSaving(true);
        Promise.resolve(onSave(deck)).finally(() => setSaving(false));
      }
      if (meta && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        duplicateSlide(activeIdx);
      }
      if (meta && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        deleteSlide(activeIdx);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deck, activeIdx, onSave, duplicateSlide, deleteSlide]);

  const handleAcceptDiff = useCallback(
    (diff: RegenDiff) => {
      onChange(diff.proposed);
    },
    [onChange],
  );

  const handleExport = useCallback(
    async (fmt: "pdf" | "pptx" | "gslides") => {
      setExportBusy(fmt);
      try {
        if (fmt === "gslides") {
          await openInGoogleSlides({
            session_id: sessionId,
            format: "gslides",
            slides: deck.slides,
          });
        } else {
          const res = await exportDeck({
            session_id: sessionId,
            format: fmt,
            slides: deck.slides,
          });
          await downloadAndSave(
            res.url,
            deckFilename(deck, fmt, brand?.company_name ?? "deck"),
          );
        }
      } finally {
        setExportBusy(null);
      }
    },
    [sessionId, deck, brand],
  );

  return (
    <div
      className={cn(
        "grid h-[100dvh] min-h-[100dvh] w-full grid-rows-[auto_1fr] bg-ink-950 text-ink-100",
        className,
      )}
    >
      <DeckTopBar
        title={brand?.company_name ?? "Untitled deck"}
        subtitle={`${deck.slides.length} slides`}
        saving={saving}
        exportBusy={exportBusy}
        onExport={handleExport}
        onSave={
          onSave
            ? () => {
                setSaving(true);
                void Promise.resolve(onSave(deck)).finally(() => setSaving(false));
              }
            : undefined
        }
      />
      <div
        className={cn(
          "grid h-full w-full overflow-hidden",
          // Single column on small screens, 3-col on ≥768
          "grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)_320px]",
        )}
      >
        <div className="hidden md:block">
          <SlideThumbnails
            slides={deck.slides}
            activeIndex={activeIdx}
            brand={brand}
            onSelect={setActiveIdx}
            onReorder={reorder}
            onDuplicate={duplicateSlide}
            onDelete={deleteSlide}
            onAdd={addSlide}
          />
        </div>
        <SlideCanvas
          slide={activeSlide}
          brand={brand}
          imageBusy={imageBusy}
          onChangeBody={(body) => updateSlideAt(activeIdx, { body })}
          onChangeNotes={(speaker_notes) => updateSlideAt(activeIdx, { speaker_notes })}
          onChangeImage={(image_url) =>
            updateSlideAt(activeIdx, { image_url: image_url as unknown as PitchSlide["image_url"] })
          }
          onRegenerateImage={async () => {
            setImageBusy(true);
            try {
              // Parent owns Imagen call. We could expose via prop, but safe default:
              // simply trigger a regen with image-focused steering.
              const diff = await onRegen({
                scope: "slide",
                activeSlideIdx: activeIdx,
                steering: "Regenerate the image for this slide only — keep all text identical.",
                propagate_downstream: false,
              });
              onChange(diff.proposed);
            } finally {
              setImageBusy(false);
            }
          }}
        />
        <div className="hidden md:block">
          <AIAssistantRail
            activeSlideIdx={activeIdx}
            activeSlideTitle={activeSlide?.title ?? ""}
            onRegen={({ scope, steering, propagate_downstream }) =>
              onRegen({ scope, steering, propagate_downstream, activeSlideIdx: activeIdx })
            }
            onAcceptDiff={handleAcceptDiff}
            onRejectDiff={() => undefined}
          />
        </div>
      </div>
    </div>
  );
}

interface DeckTopBarProps {
  title: string;
  subtitle: string;
  saving: boolean;
  exportBusy: "pdf" | "pptx" | "gslides" | null;
  onExport: (fmt: "pdf" | "pptx" | "gslides") => Promise<void> | void;
  onSave?: () => void;
}

function DeckTopBar({
  title,
  subtitle,
  saving,
  exportBusy,
  onExport,
  onSave,
}: DeckTopBarProps): JSX.Element {
  return (
    <header className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-ink-800 bg-ink-950/80 px-5 py-3 backdrop-blur">
      <div>
        <h1 className="font-display text-base font-medium text-ink-50">{title}</h1>
        <p className="text-[11px] uppercase tracking-widest text-ink-500">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-md border border-ink-800 bg-ink-900 px-3 py-1.5 text-[12.5px] text-ink-200 hover:bg-ink-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Save size={13} />
            <span>{saving ? "Saving…" : "Save"}</span>
          </button>
        )}
        <ExportBtn
          icon={<FileImage size={13} />}
          label="PDF"
          busy={exportBusy === "pdf"}
          onClick={() => onExport("pdf")}
        />
        <ExportBtn
          icon={<Presentation size={13} />}
          label="PPTX"
          busy={exportBusy === "pptx"}
          onClick={() => onExport("pptx")}
        />
        <ExportBtn
          icon={<Download size={13} />}
          label="Slides"
          accent
          busy={exportBusy === "gslides"}
          onClick={() => onExport("gslides")}
        />
      </div>
    </header>
  );
}

function ExportBtn({
  icon,
  label,
  busy,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  accent?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "grid grid-cols-[auto_1fr] items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        accent
          ? "bg-accent text-ink-950 hover:bg-accent-400"
          : "border border-ink-800 bg-ink-900 text-ink-200 hover:bg-ink-800",
        busy && "opacity-60",
      )}
    >
      {icon}
      <span>{busy ? "…" : label}</span>
    </button>
  );
}
