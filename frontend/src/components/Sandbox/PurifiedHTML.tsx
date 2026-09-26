/**
 * PurifiedHTML — inline (non-iframe) renderer for sanitized agent HTML.
 *
 * Used for executive-summary markdown and other inline rich-text where an
 * iframe would be overkill. The wrapper div applies CSS isolation + a
 * scoped prose stylesheet so agent CSS cannot bleed into the host page.
 *
 * For untrusted HTML with scripts or forms, use SandboxedIframe instead.
 */
import { useMemo } from "react";
import { purifyHTML } from "../../lib/purify";
import { cn } from "../../lib/cn";

export interface PurifiedHTMLProps {
  html: string;
  className?: string;
  /** Apply prose typography (use for executive summary, descriptions). */
  prose?: boolean;
  as?: keyof JSX.IntrinsicElements;
  ariaLabel?: string;
}

export function PurifiedHTML({
  html,
  className,
  prose = true,
  as: Tag = "div",
  ariaLabel,
}: PurifiedHTMLProps): JSX.Element {
  const safe = useMemo(() => purifyHTML(html), [html]);
  return (
    <Tag
      // CSS isolation: contain + isolation prevents transform/filter leakage.
      className={cn(
        "isolate [contain:content] [&_a]:underline [&_a]:underline-offset-2 [&_a]:text-accent",
        prose && "prose-prometheus",
        className,
      )}
      style={{ contain: "content" }}
      aria-label={ariaLabel}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
