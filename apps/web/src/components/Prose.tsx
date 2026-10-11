import type { ReactNode } from 'react';

/**
 * Renders assistant commentary: paragraphs, headings, bullet lists, bold and italic. Nothing else is interpreted,
 * and no value is ever read back out of the text. Markdown tables are dropped when structured results are shown
 * with the message (the artifact is the authoritative table); otherwise they are kept as plain text lines.
 */
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if ((part.startsWith('*') && part.endsWith('*') && part.length > 2) || (part.startsWith('_') && part.endsWith('_') && part.length > 2)) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

type Block = { kind: 'p'; text: string } | { kind: 'h'; text: string } | { kind: 'ul'; items: string[] };

const isTableLine = (line: string): boolean => line.trimStart().startsWith('|');
const bullet = /^\s*(?:[-*•])\s+(.*)$/;
const heading = /^\s*#{1,6}\s+(.*)$/;

export function parseProse(text: string, dropTables: boolean): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (isTableLine(line)) {
      if (dropTables) continue;
      flush();
      if (/^\s*\|[\s:|-]+\|?\s*$/.test(line)) continue;
      blocks.push({ kind: 'p', text: line.split('|').map((c) => c.trim()).filter(Boolean).join(' · ') });
      continue;
    }
    const h = heading.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: 'h', text: h[1] ?? '' });
      continue;
    }
    const b = bullet.exec(line);
    if (b) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ul') last.items.push(b[1] ?? '');
      else blocks.push({ kind: 'ul', items: [b[1] ?? ''] });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

export function Prose({ text, dropTables }: { text: string; dropTables: boolean }) {
  return (
    <div className="prose">
      {parseProse(text, dropTables).map((block, index) => {
        if (block.kind === 'h') return <p key={index} className="prose-heading">{inline(block.text)}</p>;
        if (block.kind === 'ul') {
          return (
            <ul key={index}>
              {block.items.map((item, i) => (
                <li key={i}>{inline(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{inline(block.text)}</p>;
      })}
    </div>
  );
}
