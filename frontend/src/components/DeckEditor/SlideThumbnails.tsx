/**
 * SlideThumbnails — vertical reorderable list, 1/8-scale slide previews.
 *
 * Native HTML5 drag-and-drop (no extra dep). Keyboard:
 *   ArrowUp/Down      — focus next/prev
 *   Cmd/Ctrl-Up/Down  — move focused slide up/down
 *   Enter             — select
 *   Backspace/Delete  — request delete (parent handles confirm)
 */
import {
  forwardRef,
  memo,
  useCallback,
  useRef,
  useState,
} from "react";
import { motion } from "framer-motion";
import { GripVertical, Plus, Copy, Trash2 } from "lucide-react";
import type { BrandIdentityResult, PitchSlide } from "../../types/agents";
import { LAYOUT_REGISTRY } from "./SlideLayouts";
import { SLIDE_H, SLIDE_W } from "./SlideLayouts/layoutShared";
import { cn } from "../../lib/cn";

const SPRING = { type: "spring" as const, stiffness: 100, damping: 20 };

export interface SlideThumbnailsProps {
  slides: PitchSlide[];
  activeIndex: number;
  brand: BrandIdentityResult | null;
  onSelect: (idx: number) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onDuplicate: (idx: number) => void;
  onDelete: (idx: number) => void;
  onAdd: (afterIdx: number) => void;
}

export const SlideThumbnails = forwardRef<HTMLDivElement, SlideThumbnailsProps>(
  function SlideThumbnails(
    { slides, activeIndex, brand, onSelect, onReorder, onDuplicate, onDelete, onAdd },
    ref,
  ) {
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const [overIdx, setOverIdx] = useState<number | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent, idx: number) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (e.metaKey || e.ctrlKey) {
            if (idx < slides.length - 1) onReorder(idx, idx + 1);
          } else {
            onSelect(Math.min(slides.length - 1, idx + 1));
          }
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (e.metaKey || e.ctrlKey) {
            if (idx > 0) onReorder(idx, idx - 1);
          } else {
            onSelect(Math.max(0, idx - 1));
          }
        } else if (e.key === "Enter") {
          onSelect(idx);
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(idx);
        } else if ((e.key === "d" || e.key === "D") && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onDuplicate(idx);
        }
      },
      [slides.length, onSelect, onReorder, onDelete, onDuplicate],
    );

    return (
      <div
        ref={(node) => {
          containerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        className="grid h-full w-[180px] grid-rows-[1fr_auto] border-r border-ink-800 bg-ink-950/60"
      >
        <ol
          className="flex flex-col gap-2 overflow-y-auto p-3 [scrollbar-width:thin]"
          aria-label="Slide thumbnails"
          role="listbox"
        >
          {slides.map((slide, idx) => (
            <ThumbItem
              key={`${slide.slide_number}-${idx}`}
              slide={slide}
              idx={idx}
              active={idx === activeIndex}
              brand={brand}
              isDragOver={overIdx === idx && dragIdx !== null && dragIdx !== idx}
              onSelect={onSelect}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onKeyDown={handleKeyDown}
              onDragStart={(i) => setDragIdx(i)}
              onDragEnd={() => {
                if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
                  onReorder(dragIdx, overIdx);
                }
                setDragIdx(null);
                setOverIdx(null);
              }}
              onDragEnterIdx={(i) => setOverIdx(i)}
            />
          ))}
        </ol>
        <div className="border-t border-ink-800 p-2">
          <button
            type="button"
            onClick={() => onAdd(slides.length - 1)}
            className={cn(
              "grid w-full grid-cols-[auto_1fr] items-center gap-2 rounded-lg",
              "bg-ink-900 px-3 py-2 text-xs font-medium text-ink-200 hover:bg-ink-800",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            )}
            aria-label="Add new slide"
          >
            <Plus size={14} />
            <span className="text-left">New slide</span>
          </button>
        </div>
      </div>
    );
  },
);

interface ThumbItemProps {
  slide: PitchSlide;
  idx: number;
  active: boolean;
  brand: BrandIdentityResult | null;
  isDragOver: boolean;
  onSelect: (idx: number) => void;
  onDuplicate: (idx: number) => void;
  onDelete: (idx: number) => void;
  onKeyDown: (e: React.KeyboardEvent, idx: number) => void;
  onDragStart: (idx: number) => void;
  onDragEnd: () => void;
  onDragEnterIdx: (idx: number) => void;
}

const ThumbItem = memo(function ThumbItem({
  slide,
  idx,
  active,
  brand,
  isDragOver,
  onSelect,
  onDuplicate,
  onDelete,
  onKeyDown,
  onDragStart,
  onDragEnd,
  onDragEnterIdx,
}: ThumbItemProps) {
  const Layout = LAYOUT_REGISTRY[slide.layout];
  const SCALE = 0.125; // 1/8
  const scaledW = SLIDE_W * SCALE;
  const scaledH = SLIDE_H * SCALE;
  return (
    <motion.li
      layout
      transition={SPRING}
      role="option"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      // Framer-Motion's `motion.li` types onDrag* as pan handlers; HTML5 drag is
      // delivered via the same DOM events. Cast to unknown to bridge the typing.
      draggable
      {...({
        onDragStart: (e: React.DragEvent<HTMLLIElement>) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(idx));
          onDragStart(idx);
        },
        onDragOver: (e: React.DragEvent<HTMLLIElement>) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        },
      } as unknown as Record<string, unknown>)}
      onDragEnter={() => onDragEnterIdx(idx)}
      onDragEnd={onDragEnd}
      onDrop={onDragEnd}
      onClick={() => onSelect(idx)}
      onKeyDown={(e) => onKeyDown(e, idx)}
      className={cn(
        "group relative grid grid-cols-[auto_1fr] gap-2 rounded-lg p-1.5 outline-none",
        "border border-transparent",
        active && "border-accent/60 bg-ink-800/60",
        !active && "hover:bg-ink-900",
        isDragOver && "ring-2 ring-accent/60",
        "focus-visible:ring-2 focus-visible:ring-accent/60",
      )}
    >
      <div className="grid place-items-center self-stretch px-1 text-ink-600">
        <GripVertical size={12} aria-hidden="true" />
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-1.5">
        <div
          className="overflow-hidden rounded-md ring-1 ring-ink-800"
          style={{ width: scaledW, height: scaledH }}
        >
          <div
            style={{
              width: SLIDE_W,
              height: SLIDE_H,
              transform: `scale(${SCALE})`,
              transformOrigin: "top left",
              pointerEvents: "none",
            }}
          >
            <Layout slide={slide} brand={brand} />
          </div>
        </div>
        <div className="grid gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-widest text-ink-500">
            {String(idx + 1).padStart(2, "0")}
          </span>
          <span className="font-mono text-[8px] uppercase tracking-widest text-ink-600">
            {slide.layout.replace("_", " ")}
          </span>
        </div>
      </div>
      <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate(idx);
          }}
          className="grid h-5 w-5 place-items-center rounded bg-ink-800 text-ink-300 hover:bg-ink-700"
          aria-label={`Duplicate slide ${idx + 1}`}
        >
          <Copy size={11} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(idx);
          }}
          className="grid h-5 w-5 place-items-center rounded bg-ink-800 text-red-300 hover:bg-red-500/20"
          aria-label={`Delete slide ${idx + 1}`}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </motion.li>
  );
});
