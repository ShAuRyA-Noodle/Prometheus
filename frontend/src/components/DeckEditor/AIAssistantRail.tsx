/**
 * AIAssistantRail — chat UI for steering deck regeneration.
 *
 * User asks "make this slide more bold" → we call api.regen with steering +
 * `propagate_downstream: false` so only the deck regenerates. Result diff is
 * shown inline as a "before / after" preview before the user accepts.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Check, Loader2, Sparkles, Undo2 } from "lucide-react";
import type { PitchDeckResult } from "../../types/agents";
import { cn } from "../../lib/cn";

const SPRING = { type: "spring" as const, stiffness: 100, damping: 20 };

export interface RegenDiff {
  /** Which slides changed, by index. */
  changedSlideIndexes: number[];
  /** Side-by-side title pairs for quick scan. */
  titlePairs: { before: string; after: string; idx: number }[];
  /** Steering text used to produce this diff. */
  steering: string;
  proposed: PitchDeckResult;
}

export interface AIAssistantRailProps {
  /** The slide currently focused in the editor. Steers context. */
  activeSlideIdx: number;
  activeSlideTitle: string;
  /**
   * Trigger a regeneration. Returns a diff the user must accept/reject.
   * `scope = "slide"` regenerates this slide only; `"deck"` regenerates whole deck.
   */
  onRegen: (args: {
    scope: "slide" | "deck";
    steering: string;
    propagate_downstream: boolean;
  }) => Promise<RegenDiff>;
  onAcceptDiff: (diff: RegenDiff) => void;
  onRejectDiff: () => void;
  className?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  diff?: RegenDiff;
  busy?: boolean;
}

const SUGGESTIONS = [
  "Make the financials slide more conservative",
  "Tighten the problem statement to 12 words",
  "Make this slide more bold and direct",
  "Reorder so traction comes before market sizing",
  "Rewrite the team slide for a YC partner audience",
];

export function AIAssistantRail({
  activeSlideIdx,
  activeSlideTitle,
  onRegen,
  onAcceptDiff,
  onRejectDiff,
  className,
}: AIAssistantRailProps): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "system-0",
      role: "system",
      text:
        "Tell me what you want to change. I'll regenerate just this slide (default) or the whole deck — your choice. You'll see a diff before anything is applied.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<"slide" | "deck">("slide");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputId = useId();

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        text: text.trim(),
      };
      const placeholder: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: scope === "slide" ? "Regenerating this slide…" : "Regenerating the deck…",
        busy: true,
      };
      setMessages((m) => [...m, userMsg, placeholder]);
      setDraft("");
      try {
        const diff = await onRegen({
          scope,
          steering: text.trim(),
          propagate_downstream: false,
        });
        setMessages((m) =>
          m.map((msg) =>
            msg.id === placeholder.id
              ? {
                  ...msg,
                  busy: false,
                  text: `Proposed ${diff.changedSlideIndexes.length} change${diff.changedSlideIndexes.length === 1 ? "" : "s"}.`,
                  diff,
                }
              : msg,
          ),
        );
      } catch (err) {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === placeholder.id
              ? {
                  ...msg,
                  busy: false,
                  text: `Couldn't generate that. ${err instanceof Error ? err.message : "Try again."}`,
                }
              : msg,
          ),
        );
      }
    },
    [scope, onRegen],
  );

  const handleAccept = useCallback(
    (diff: RegenDiff) => {
      onAcceptDiff(diff);
      setMessages((m) => [
        ...m,
        {
          id: `s-${Date.now()}`,
          role: "system",
          text: "Applied. Use Cmd-Z to revert if it didn't land.",
        },
      ]);
    },
    [onAcceptDiff],
  );

  const handleReject = useCallback(() => {
    onRejectDiff();
    setMessages((m) => [
      ...m,
      {
        id: `s-${Date.now()}`,
        role: "system",
        text: "Discarded.",
      },
    ]);
  }, [onRejectDiff]);

  return (
    <aside
      className={cn(
        "grid h-full w-full grid-rows-[auto_1fr_auto] border-l border-ink-800 bg-ink-950/60",
        className,
      )}
      aria-label="AI assistant"
    >
      <header className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-ink-800 px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent/15 text-accent">
          <Sparkles size={14} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">Assistant</p>
          <p className="truncate font-display text-sm text-ink-100">
            Slide {activeSlideIdx + 1} · {activeSlideTitle}
          </p>
        </div>
        <ScopeToggle value={scope} onChange={setScope} />
      </header>

      <div ref={listRef} className="overflow-y-auto px-4 py-4 [scrollbar-width:thin]">
        <ol className="grid gap-3">
          {messages.map((m) => (
            <Message
              key={m.id}
              msg={m}
              onAccept={handleAccept}
              onReject={handleReject}
            />
          ))}
        </ol>
        {messages.length <= 2 && (
          <div className="mt-4 grid gap-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Try
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void submit(s)}
                className="rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-left text-[12.5px] text-ink-300 hover:border-ink-700 hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        className="grid grid-cols-[1fr_auto] items-end gap-2 border-t border-ink-800 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(draft);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Steering instruction
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(draft);
            }
          }}
          rows={2}
          placeholder={`Steer ${scope === "slide" ? "this slide" : "the deck"}…`}
          className="resize-none rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-[13px] text-ink-100 placeholder:text-ink-600 focus:border-accent/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="grid h-9 w-9 place-items-center rounded-md bg-accent text-ink-950 hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label="Send"
        >
          <ArrowUp size={16} />
        </button>
      </form>
    </aside>
  );
}

function ScopeToggle({
  value,
  onChange,
}: {
  value: "slide" | "deck";
  onChange: (v: "slide" | "deck") => void;
}): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Regeneration scope"
      className="flex rounded-md border border-ink-800 bg-ink-900 p-0.5 text-[10px] font-mono uppercase tracking-widest"
    >
      {(["slide", "deck"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={value === opt}
          onClick={() => onChange(opt)}
          className={cn(
            "rounded px-2 py-1",
            value === opt ? "bg-accent text-ink-950" : "text-ink-400 hover:text-ink-100",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

interface MessageProps {
  msg: ChatMessage;
  onAccept: (diff: RegenDiff) => void;
  onReject: () => void;
}

function Message({ msg, onAccept, onReject }: MessageProps): JSX.Element {
  if (msg.role === "system") {
    return (
      <li className="rounded-md border border-ink-800/60 bg-ink-900/40 px-3 py-2 text-[12px] leading-relaxed text-ink-400">
        {msg.text}
      </li>
    );
  }
  if (msg.role === "user") {
    return (
      <li className="ml-6 rounded-2xl rounded-br-sm bg-accent/15 px-3 py-2 text-[13px] leading-relaxed text-ink-100">
        {msg.text}
      </li>
    );
  }
  return (
    <li className="grid gap-2">
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="grid grid-cols-[auto_1fr] items-start gap-2"
      >
        <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-ink-800 text-ink-300">
          {msg.busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
        </span>
        <div className="text-[13px] leading-relaxed text-ink-200">{msg.text}</div>
      </motion.div>
      {msg.diff && <DiffBlock diff={msg.diff} onAccept={onAccept} onReject={onReject} />}
    </li>
  );
}

function DiffBlock({
  diff,
  onAccept,
  onReject,
}: {
  diff: RegenDiff;
  onAccept: (diff: RegenDiff) => void;
  onReject: () => void;
}): JSX.Element {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="overflow-hidden rounded-xl border border-ink-800 bg-ink-900/80"
    >
      <div className="border-b border-ink-800 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-ink-500">
        Diff · {diff.titlePairs.length} slide{diff.titlePairs.length === 1 ? "" : "s"}
      </div>
      <ul className="divide-y divide-ink-800/60">
        {diff.titlePairs.slice(0, 6).map((p) => (
          <li key={p.idx} className="grid grid-cols-2 gap-3 p-3 text-[12.5px]">
            <div className="grid gap-1">
              <span className="text-[10px] uppercase tracking-wider text-red-300">Was</span>
              <span className="text-ink-300 line-through decoration-red-300/50">{p.before}</span>
            </div>
            <div className="grid gap-1">
              <span className="text-[10px] uppercase tracking-wider text-emerald-300">Now</span>
              <span className="text-ink-100">{p.after}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2 border-t border-ink-800 p-2">
        <button
          type="button"
          onClick={onReject}
          className="grid grid-cols-[auto_1fr] items-center justify-center gap-1.5 rounded-md border border-ink-800 bg-ink-900 px-3 py-1.5 text-[12px] text-ink-300 hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-500"
        >
          <Undo2 size={12} />
          <span>Discard</span>
        </button>
        <button
          type="button"
          onClick={() => onAccept(diff)}
          className="grid grid-cols-[auto_1fr] items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-ink-950 hover:bg-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Check size={12} />
          <span>Apply</span>
        </button>
      </div>
    </motion.div>
  );
}
