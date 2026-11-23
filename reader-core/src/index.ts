/**
 * Shared manuscript parser. Used by the mobile reader (HtmlView) and the API
 * paragraph registry so both sides agree on paragraph paths and text.
 */
export type El = { tag: string; attrs: Record<string, string>; kids: Node[] };
export type Node = El | string;

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** Decodes the server's entity set exactly once (mirrors writer-text decodeEntities). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    const v = ENTITY[e.toLowerCase()];
    return v ?? m;
  });
}

export const VOID = new Set(['br', 'img', 'hr']);
export const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math']);
export const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'img', 'hr']);

/** Deeper tags are flattened (their text kept) so hostile nesting cannot overflow recursive walkers. */
export const MAX_DEPTH = 128;

export function parseHtml(html: string): El {
  const root: El = { tag: 'root', attrs: {}, kids: [] };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)|</g;
  let m: RegExpExecArray | null;
  let skip = 0;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[4] !== undefined || m[0] === '<') { if (!skip) top.kids.push(decodeEntities(m[4] ?? '<')); continue; }
    const close = m[1] === '/', tag = m[2].toLowerCase();
    if (DROP.has(tag)) { skip += close ? -1 : 1; if (skip < 0) skip = 0; continue; }
    if (skip) continue;
    if (close) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const attrs: Record<string, string> = {};
    const ar = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[3] ?? ''))) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    if (!VOID.has(tag) && stack.length > MAX_DEPTH) continue;
    const el: El = { tag, attrs, kids: [] };
    top.kids.push(el);
    if (!VOID.has(tag)) stack.push(el);
  }
  return root;
}

export const hasImg = (n: Node): boolean => typeof n !== 'string' && (n.tag === 'img' || n.kids.some(hasImg));
export const isBlock = (n: Node): boolean => typeof n !== 'string' && (BLOCK.has(n.tag) || hasImg(n));

/** Text exactly as HtmlView's inline renderer produces it (whitespace runs collapsed, br as newline). */
function inlineText(n: Node): string {
  if (typeof n === 'string') return n.replace(/\s+/g, ' ');
  if (n.tag === 'br') return '\n';
  return n.kids.map(inlineText).join('');
}

export type ReaderParagraphText = { path: string; text: string };

/**
 * Every non-empty text flow with the same key HtmlView gives its flowText:
 * root "b", direct blocks k.i, inline runs k+"r"+out.length, list items k+"l"+j.
 */
export function getReaderParagraphs(html: string): ReaderParagraphText[] {
  const found: ReaderParagraphText[] = [];
  const flow = (nodes: Node[], k: string) => {
    const text = nodes.map(inlineText).join('');
    if (text.trim()) found.push({ path: k, text });
  };
  const blocks = (nodes: Node[], k: string) => {
    let count = 0; let run: Node[] = [];
    const flush = () => { if (run.some((r) => typeof r !== 'string' || r.trim())) { flow(run, k + 'r' + count); count++; } run = []; };
    nodes.forEach((n, i) => {
      if (!isBlock(n)) { run.push(n); return; }
      flush();
      block(n as El, k + '.' + i);
      count++;
    });
    flush();
  };
  const block = (n: El, k: string) => {
    switch (n.tag) {
      case 'img': case 'hr': return;
      case 'blockquote': blocks(n.kids, k); return;
      case 'ul': case 'ol':
        n.kids.filter((c): c is El => typeof c !== 'string' && c.tag === 'li').forEach((li, j) => {
          if (hasImg(li) || li.kids.some(isBlock)) blocks(li.kids, k + 'l' + j); else flow(li.kids, k + 'l' + j);
        });
        return;
      default:
        if (hasImg(n) || n.kids.some((c) => typeof c !== 'string' && BLOCK.has(c.tag))) { blocks(n.kids, k); return; }
        if (!n.kids.length || n.kids.every((c) => (typeof c === 'string' ? !c.trim() : c.tag === 'br'))) return;
        flow(n.kids, k);
    }
  };
  blocks(parseHtml(html).kids, 'b');
  return found;
}

/** Whitespace-normalized paragraph text, the basis for registry hashing. */
export function normalizeParagraphText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
