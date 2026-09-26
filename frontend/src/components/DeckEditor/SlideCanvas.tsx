/**
 * SlideCanvas — main editing surface.
 *
 * Renders the active slide at design-size (1280x720) inside a viewport that
 * scales it via CSS transform. Tiptap edits the slide body inline (passed as
 * `bodyEditor` to the layout component). Speaker notes live in a bottom
 * drawer toggle.
 */
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { ChevronUp, ImagePlus, Mic2, RotateCw } from "lucide-react";
import type { BrandIdentityResult, PitchSlide } from "../../types/agents";
import { LAYOUT_REGISTRY } from "./SlideLayouts";
import { SLIDE_H, SLIDE_W } from "./SlideLayouts/layoutShared";
import { cn } from "../../lib/cn";

export interface SlideCanvasProps {
  slide: PitchSlide;
  brand: BrandIdentityResult | null;
  onChangeBody: (body: string) => void;
  onChangeNotes: (notes: string) => void;
  onChangeImage: (url: string) => void;
  /** Trigger Imagen regeneration of the slide image. */
  onRegenerateImage?: () => Promise<void> | void;
  imageBusy?: boolean;
}

export const SlideCanvas = forwardRef<HTMLDivElement, SlideCanvasProps>(
  function SlideCanvas(
    { slide, brand, onChangeBody, onChangeNotes, onChangeImage, onRegenerateImage, imageBusy },
    ref,
  ) {
    const Layout = LAYOUT_REGISTRY[slide.layout];

    // Tiptap editor for body
    const bodyEditor = useEditor(
      {
        extensions: [
          StarterKit.configure({
            heading: { levels: [2, 3] },
            codeBlock: false,
          }),
          Placeholder.configure({ placeholder: "Body copy…" }),
          Image,
          Link.configure({ openOnClick: false, autolink: true }),
        ],
        content: slide.body,
        onUpdate: ({ editor }) => onChangeBody(editor.getText()),
      },
      [slide.slide_number],
    );

    // Tiptap editor for speaker notes
    const notesEditor = useEditor(
      {
        extensions: [StarterKit, Placeholder.configure({ placeholder: "Speaker notes…" })],
        content: slide.speaker_notes,
        onUpdate: ({ editor }) => onChangeNotes(editor.getText()),
      },
      [slide.slide_number],
    );

    // Scaling — fit 1280x720 inside the viewport, never upscale beyond 1.0
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [scale, setScale] = useState(1);
    useLayoutEffect(() => {
      const recompute = () => {
        const el = viewportRef.current;
        if (!el) return;
        const w = el.clientWidth - 48;
        const h = el.clientHeight - 48;
        const s = Math.min(w / SLIDE_W, h / SLIDE_H, 1);
        setScale(Math.max(0.2, s));
      };
      recompute();
      const ro = new ResizeObserver(recompute);
      if (viewportRef.current) ro.observe(viewportRef.current);
      return () => ro.disconnect();
    }, []);

    const [notesOpen, setNotesOpen] = useState(false);

    return (
      <section
        ref={ref}
        className="grid h-full w-full grid-rows-[auto_1fr_auto] bg-ink-950"
        aria-label={`Slide ${slide.slide_number}: ${slide.layout}`}
      >
        <CanvasToolbar
          slide={slide}
          imageBusy={Boolean(imageBusy)}
          onRegenerateImage={onRegenerateImage}
          onUploadImage={(url) => onChangeImage(url)}
        />
        <div ref={viewportRef} className="relative grid place-items-center overflow-hidden p-6">
          <div
            className="origin-center bg-ink-900 shadow-bento"
            style={{
              width: SLIDE_W,
              height: SLIDE_H,
              transform: `scale(${scale})`,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <Layout
              slide={slide}
              brand={brand}
              bodyEditor={
                <div className="prose-prometheus" style={{ outline: "none" }}>
                  <EditorContent editor={bodyEditor} />
                </div>
              }
              onActivateBody={() => bodyEditor?.commands.focus()}
            />
          </div>
        </div>
        <SpeakerNotesDrawer
          open={notesOpen}
          onToggle={() => setNotesOpen((o) => !o)}
          editor={notesEditor}
        />
      </section>
    );
  },
);

// ─── Toolbar ─────────────────────────────────────────────────────────────────

interface CanvasToolbarProps {
  slide: PitchSlide;
  imageBusy: boolean;
  onRegenerateImage?: () => Promise<void> | void;
  onUploadImage: (url: string) => void;
}

function CanvasToolbar({
  slide,
  imageBusy,
  onRegenerateImage,
  onUploadImage,
}: CanvasToolbarProps): JSX.Element {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      // Validate type
      if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") onUploadImage(reader.result);
      };
      reader.readAsDataURL(f);
      e.target.value = "";
    },
    [onUploadImage],
  );

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-ink-800 px-4 py-2.5">
      <div className="grid grid-cols-[auto_1fr] items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-ink-500">
        <span className="rounded-md border border-ink-800 bg-ink-900 px-1.5 py-0.5">
          {String(slide.slide_number).padStart(2, "0")}
        </span>
        <span>{slide.layout.replace("_", " ")}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-md border border-ink-800 bg-ink-900 px-2.5 py-1.5 text-[12px] text-ink-200 hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <ImagePlus size={13} />
          <span>Upload image</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleFile}
          className="hidden"
        />
        {onRegenerateImage && (
          <button
            type="button"
            onClick={() => void onRegenerateImage()}
            disabled={imageBusy}
            className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-md border border-ink-800 bg-ink-900 px-2.5 py-1.5 text-[12px] text-ink-200 hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            aria-label="Regenerate slide image with Imagen"
          >
            <RotateCw size={13} className={cn(imageBusy && "animate-spin")} />
            <span>Regen image</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Notes drawer ────────────────────────────────────────────────────────────

interface SpeakerNotesDrawerProps {
  open: boolean;
  onToggle: () => void;
  editor: ReturnType<typeof useEditor>;
}

function SpeakerNotesDrawer({ open, onToggle, editor }: SpeakerNotesDrawerProps): JSX.Element {
  return (
    <div
      className={cn(
        "grid grid-rows-[auto_1fr] border-t border-ink-800 bg-ink-950 transition-[max-height] duration-200",
        open ? "max-h-[280px]" : "max-h-[40px]",
      )}
      style={{ overflow: "hidden" }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="speaker-notes"
        className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-4 py-2.5 text-left text-[11px] font-mono uppercase tracking-widest text-ink-500 hover:bg-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <Mic2 size={12} />
        <span>Speaker notes</span>
        <ChevronUp
          size={12}
          className={cn("transition-transform", !open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id="speaker-notes" className="overflow-y-auto px-4 pb-3">
          <div className="prose-prometheus min-h-[140px] rounded-md border border-ink-800 bg-ink-900 p-3 text-[13px] text-ink-200 focus-within:border-accent/60">
            <EditorContent editor={editor} />
          </div>
        </div>
      )}
    </div>
  );
}
