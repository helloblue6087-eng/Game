/**
 * Minimal, dependency-free Markdown renderer.
 *
 * Supports the subset the agent actually emits: headings, paragraphs, ordered
 * and unordered lists, blockquotes, fenced code blocks, inline code, bold,
 * italic and links. It renders to React elements (never
 * `dangerouslySetInnerHTML`), so agent output — which is untrusted input — can
 * never inject markup or script into the console.
 */

import { Fragment, memo, type ReactNode } from "react";

interface MarkdownProps {
  content: string;
  className?: string;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Order matters: code first so ** inside code stays literal.
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))|(_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-${index++}`;
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]"));
      const href = token.slice(token.indexOf("(") + 1, -1);
      nodes.push(
        <a key={key} href={href} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownImpl({ content, className = "" }: MarkdownProps) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let quote: string[] = [];
  let codeFence: { lang: string; lines: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ");
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(text, `p${blocks.length}`)}</p>);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    const Tag = listOrdered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l-${blocks.length}`}>
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item, `li${blocks.length}-${i}`)}</li>
        ))}
      </Tag>,
    );
    listItems = [];
  };

  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push(
      <blockquote key={`q-${blocks.length}`}>{renderInline(quote.join(" "), `q${blocks.length}`)}</blockquote>,
    );
    quote = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");

    if (codeFence) {
      if (line.trim().startsWith("```")) {
        blocks.push(
          <pre key={`c-${blocks.length}`} data-lang={codeFence.lang}>
            <code>{codeFence.lines.join("\n")}</code>
          </pre>,
        );
        codeFence = null;
      } else {
        codeFence.lines.push(rawLine);
      }
      continue;
    }

    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      flushQuote();
      codeFence = { lang: line.trim().slice(3), lines: [] };
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = heading[1].length;
      const Tag = (level === 1 ? "h1" : level === 2 ? "h2" : "h3") as "h1" | "h2" | "h3";
      blocks.push(<Tag key={`h-${blocks.length}`}>{renderInline(heading[2], `h${blocks.length}`)}</Tag>);
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      flushQuote();
      listOrdered = false;
      listItems.push(bullet[1]);
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      flushQuote();
      listOrdered = true;
      listItems.push(numbered[1]);
      continue;
    }

    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  if (codeFence) {
    blocks.push(
      <pre key={`c-${blocks.length}`}>
        <code>{codeFence.lines.join("\n")}</code>
      </pre>,
    );
  }
  flushParagraph();
  flushList();
  flushQuote();

  return (
    <div className={`prose-agent ${className}`}>
      {blocks.map((block, i) => (
        <Fragment key={i}>{block}</Fragment>
      ))}
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
