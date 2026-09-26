/**
 * NameCandidateList — keyboard-navigable list of candidate company names.
 *
 * Each row: name (display font), rationale snippet, NameAvailability badges,
 * and a "Make primary" action that promotes the candidate to BrandIdentity.company_name.
 *
 * Keyboard:
 *   ArrowUp/Down — move focus
 *   Enter        — make primary
 *   Cmd/Ctrl-Up  — bump candidate up the list
 *   Cmd/Ctrl-Down — bump down
 */
import { forwardRef, useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, MoreHorizontal, Star, Trash2 } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import type { NameCandidate } from "../../types/agents";
import { NameAvailability } from "./NameAvailability";
import { cn } from "../../lib/cn";

const SPRING = { type: "spring" as const, stiffness: 100, damping: 20 };

export interface NameCandidateListProps {
  primaryName: string;
  candidates: NameCandidate[];
  onMakePrimary: (name: string) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (idx: number) => void;
  onAddCustom: (name: string) => void;
  className?: string;
}

export const NameCandidateList = forwardRef<HTMLDivElement, NameCandidateListProps>(
  function NameCandidateList(
    { primaryName, candidates, onMakePrimary, onReorder, onRemove, onAddCustom, className },
    ref,
  ) {
    const [focusedIdx, setFocusedIdx] = useState(0);
    const [draft, setDraft] = useState("");
    const listRef = useRef<HTMLOListElement | null>(null);

    const focusItem = useCallback((idx: number) => {
      setFocusedIdx(idx);
      const node = listRef.current?.querySelector<HTMLLIElement>(`[data-idx="${idx}"]`);
      node?.focus();
    }, []);

    const handleKey = useCallback(
      (e: React.KeyboardEvent, idx: number) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (e.metaKey || e.ctrlKey) {
            if (idx < candidates.length - 1) onReorder(idx, idx + 1);
            focusItem(Math.min(candidates.length - 1, idx + 1));
          } else {
            focusItem(Math.min(candidates.length - 1, idx + 1));
          }
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (e.metaKey || e.ctrlKey) {
            if (idx > 0) onReorder(idx, idx - 1);
            focusItem(Math.max(0, idx - 1));
          } else {
            focusItem(Math.max(0, idx - 1));
          }
        } else if (e.key === "Enter") {
          e.preventDefault();
          onMakePrimary(candidates[idx]?.name ?? "");
        } else if (e.key === "Delete" || e.key === "Backspace") {
          if ((e.target as HTMLElement).tagName === "INPUT") return;
          e.preventDefault();
          onRemove(idx);
        }
      },
      [candidates, onMakePrimary, onRemove, onReorder, focusItem],
    );

    const handleAdd = useCallback(() => {
      const trimmed = draft.trim();
      if (!trimmed) return;
      onAddCustom(trimmed);
      setDraft("");
    }, [draft, onAddCustom]);

    return (
      <div
        ref={ref}
        className={cn(
          "grid h-full grid-rows-[auto_1fr_auto] gap-3 border-r border-ink-800 bg-ink-950/60 p-4",
          className,
        )}
      >
        <header>
          <h2 className="font-display text-sm font-medium text-ink-100">Candidate names</h2>
          <p className="text-[11px] uppercase tracking-widest text-ink-500">
            {candidates.length} options · arrow keys to navigate
          </p>
        </header>
        <ol
          ref={listRef}
          role="listbox"
          aria-label="Brand name candidates"
          className="flex flex-col gap-2 overflow-y-auto pr-1 [scrollbar-width:thin]"
        >
          <AnimatePresence initial={false}>
            {candidates.map((c, idx) => {
              const isPrimary = c.name === primaryName;
              return (
                <motion.li
                  key={`${c.name}-${idx}`}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={SPRING}
                  role="option"
                  aria-selected={isPrimary}
                  data-idx={idx}
                  tabIndex={focusedIdx === idx ? 0 : -1}
                  onFocus={() => setFocusedIdx(idx)}
                  onKeyDown={(e) => handleKey(e, idx)}
                  className={cn(
                    "group rounded-2xl border bg-ink-900/40 p-3 outline-none transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-accent/50",
                    isPrimary
                      ? "border-accent/50 bg-accent/5"
                      : "border-ink-800 hover:border-ink-700/80",
                  )}
                >
                  <div className="grid grid-cols-[1fr_auto] items-start gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-display text-base font-medium text-ink-50">
                          {c.name}
                        </h3>
                        {isPrimary && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-accent">
                            <Crown size={9} aria-hidden="true" />
                            Primary
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-400">
                        {c.rationale}
                      </p>
                    </div>
                    <RowMenu
                      isPrimary={isPrimary}
                      onMakePrimary={() => onMakePrimary(c.name)}
                      onRemove={() => onRemove(idx)}
                    />
                  </div>
                  <div className="mt-2">
                    <NameAvailability name={c.name} compact />
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
          {candidates.length === 0 && (
            <li className="rounded-xl border border-dashed border-ink-800 bg-ink-900/30 p-4 text-center text-[12px] text-ink-500">
              No candidates yet. Add one below or regenerate the brand.
            </li>
          )}
        </ol>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
          className="grid grid-cols-[1fr_auto] gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add your own…"
            aria-label="Add custom name candidate"
            maxLength={32}
            className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-[13px] text-ink-100 placeholder:text-ink-600 focus:border-accent/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-ink-950 transition-colors hover:bg-accent-400 disabled:opacity-40"
          >
            Add
          </button>
        </form>
      </div>
    );
  },
);

interface RowMenuProps {
  isPrimary: boolean;
  onMakePrimary: () => void;
  onRemove: () => void;
}

function RowMenu({ isPrimary, onMakePrimary, onRemove }: RowMenuProps): JSX.Element {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Row actions"
          className="rounded-md p-1 text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <MoreHorizontal size={14} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-48 rounded-xl border border-ink-700/80 bg-ink-900/95 p-1 text-xs text-ink-100 shadow-bento backdrop-blur"
        >
          <button
            type="button"
            disabled={isPrimary}
            onClick={onMakePrimary}
            className="grid w-full grid-cols-[16px_1fr] items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ink-800 disabled:opacity-40"
          >
            <Star size={13} aria-hidden="true" />
            Make primary
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="grid w-full grid-cols-[16px_1fr] items-center gap-2 rounded-md px-2 py-1.5 text-left text-rose-300 hover:bg-rose-500/10"
          >
            <Trash2 size={13} aria-hidden="true" />
            Remove
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
