import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe Markdown renderer for AI assistant replies.
 *
 * Builds React elements directly — never injects HTML — so model output (or
 * anything echoed from user data) can't run script or add markup. Supports
 * the subset the assistant actually produces: paragraphs, line breaks,
 * #/##/### headings, "-"/"*" and "1." lists, **bold**, *italic* / _italic_,
 * `code`, and [links](https://…) restricted to http(s).
 */
export function SafeMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const cls = heading[1].length === 1 ? "text-base font-bold" : "text-sm font-bold";
      blocks.push(
        <p key={key++} className={cls}>
          {inline(heading[2])}
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*•])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/).test(lines[i])) {
        items.push(
          <li key={items.length}>{inline(lines[i].replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))}</li>,
        );
        i++;
      }
      blocks.push(
        ordered ? (
          <ol key={key++} className="list-decimal space-y-1 ps-5">
            {items}
          </ol>
        ) : (
          <ul key={key++} className="list-disc space-y-1 ps-5">
            {items}
          </ul>
        ),
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s/.test(lines[i]) &&
      !/^\s*(?:[-*•]|\d+[.)])\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++}>
        {para.map((l, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {inline(l)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="space-y-2">{blocks}</div>;
}

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`"))
      out.push(
        <code key={k++} className="rounded bg-background/60 px-1 font-mono text-[0.85em]">
          {t.slice(1, -1)}
        </code>,
      );
    else if (t.startsWith("[")) {
      const link = t.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const href = link?.[2] ?? "";
      if (link && /^https?:\/\//i.test(href)) {
        out.push(
          <a
            key={k++}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-medium text-primary underline"
          >
            {link[1]}
          </a>,
        );
      } else out.push(link ? link[1] : t);
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
