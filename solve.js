// Faster drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
// Byte-identical output, faster: fused single-pass Markdown renderer, indexOf-based
// inline scanner (no per-character escaping), memoized slugify, manual word counting,
// and templates compiled to JS functions (scope objects pushed only for loops that
// contain an include, since only an include can observe a loop binding cross-function).

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const RESERVED = ['posts', 'tags', 'page'];

// ---------------------------------------------------------------- text

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
const ESC_TEST_RE = /[&<>"']/;
function esc(s) {
  // Most values hold no escapable character: one cheap test avoids the replace.
  if (!ESC_TEST_RE.test(s)) return s;
  return s.replace(ESC_RE, (c) => ESCAPES[c]);
}

const MARK_RE = /\p{M}/gu;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function slugifyRaw(text) {
  let plain = text;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      plain = text.normalize('NFKD').replace(MARK_RE, '');
      break;
    }
  }
  let out = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const c = plain.charCodeAt(i);
    let keep = 0;
    if (c >= 65 && c <= 90) keep = c + 32;
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
    if (keep === 0) {
      gap = out.length > 0;
      continue;
    }
    if (gap) {
      out += '-';
      if (out.length >= 64) break;
    }
    gap = false;
    out += String.fromCharCode(keep);
    if (out.length >= 64) break;
  }
  let e = out.length;
  while (e > 0 && out.charCodeAt(e - 1) === 45) e--;
  if (e !== out.length) out = out.slice(0, e);
  return out === '' ? 'untitled' : out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

function longDate(date) {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

/** The words of a body: its runs of characters other than whitespace (JS \s). */
const WS_TABLE = (() => {
  const t = new Uint8Array(65536);
  for (const c of [9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279]) t[c] = 1;
  for (let c = 8192; c <= 8202; c++) t[c] = 1;
  return t;
})();
function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (WS_TABLE[text.charCodeAt(i)]) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1)
          return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE_RE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo))
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG_RE.test(t)))
        return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c !== ' ' && c !== '\t') return false;
  }
  return true;
}

function parseFrontMatter(text) {
  const nl0 = text.indexOf('\n');
  const first = nl0 === -1 ? text : text.slice(0, nl0);
  if (first !== '---') return { error: 'no front matter' };
  // Find the closing '---' line.
  let pos = nl0 === -1 ? text.length : nl0 + 1;
  let lineNo = 2;
  let closeStart = -1;
  let closeEnd = -1;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    if (text.slice(pos, end) === '---') {
      closeStart = pos;
      closeEnd = end;
      break;
    }
    if (nl === -1) break;
    pos = nl + 1;
    lineNo++;
  }
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const data = {};
  let p = nl0 + 1;
  let ln = 2;
  while (p < closeStart) {
    const nl = text.indexOf('\n', p);
    const end = nl === -1 || nl > closeStart ? closeStart : nl;
    const line = text.slice(p, end);
    if (!isBlankLine(line) && line.charCodeAt(0) !== 35) {
      let i = 0;
      while (i < line.length) {
        const c = line.charCodeAt(i);
        if ((c >= 97 && c <= 122) || c === 95) i++;
        else break;
      }
      const key = line.slice(0, i);
      let raw;
      if (i === 0 || line[i] !== ':') return { error: `line ${ln} is not "key: value"` };
      if (i + 1 === line.length) raw = '';
      else if (line[i + 1] === ' ') raw = line.slice(i + 2);
      else return { error: `line ${ln} is not "key: value"` };
      raw = raw.replace(/[ \t]+$/, '');
      if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = valueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
    if (nl === -1 || nl >= closeStart) break;
    p = nl + 1;
    ln++;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: closeEnd === text.length ? '' : text.slice(closeEnd + 1) };
}

// ---------------------------------------------------------------- markdown

const CONTINUED_RE = /^ {2,}\S/;
const WS_RE = /\s/;
// Escape-pair alternatives shared by the inline finders (set lastIndex at entry; no re-entrancy inside).
const FIND_STRONG_RE = /\\[\\`*_\[\]()#+\-.!>]|\*\*/g;
const FIND_EM_RE = /\\[\\`*_\[\]()#+\-.!>]|\*/g;
const FIND_BRACKET_RE = /\\[\\`*_\[\]()#+\-.!>]|\]/g;
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

function findUnescaped(s, re, from) {
  re.lastIndex = from;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0].charCodeAt(0) === 92) continue; // an escape pair
    return m.index;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  FIND_EM_RE.lastIndex = from;
  let m;
  while ((m = FIND_EM_RE.exec(s)) !== null) {
    if (m[0].charCodeAt(0) === 92) continue; // an escape pair
    if (s[m.index + 1] === '*') {
      FIND_EM_RE.lastIndex = m.index + 2;
      continue;
    }
    return m.index;
  }
  return -1;
}

function nextSpecial(s, from) {
  INLINE_RE.lastIndex = from;
  const m = INLINE_RE.exec(s);
  return m === null ? -1 : m.index;
}

/**
 * `s` rendered inline; `link(target)` is a link's href. One regex pass finds both the
 * inline specials and the characters that need HTML-escaping, so a plain run between
 * two matches is copied verbatim (it holds neither) and needs no separate escape scan.
 * (lastIndex is set before every exec, so the recursive calls below cannot disturb it.)
 */
const INLINE_RE = /[&<>"'\\`*\[]/g;
function inline(s, link) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const j = nextSpecial(s, i);
    if (j === -1) {
      out += s.slice(i);
      break;
    }
    if (j > i) out += s.slice(i, j);
    const c = s[j];
    if (c === '&' || c === '<' || c === '>' || c === '"' || c === "'") {
      out += ESCAPES[c];
      i = j + 1;
      continue;
    }
    if (c === '\\') {
      const d = s[j + 1];
      if (d !== undefined && ESCAPABLE.has(d)) {
        out += d;
        i = j + 2;
      } else {
        out += '\\';
        i = j + 1;
      }
      continue;
    }
    if (c === '`') {
      const k = s.indexOf('`', j + 1);
      if (k > j + 1) {
        out += `<code>${esc(s.slice(j + 1, k))}</code>`;
        i = k + 1;
      } else {
        out += '`';
        i = j + 1;
      }
      continue;
    }
    if (c === '*') {
      if (s[j + 1] === '*') {
        const k = findUnescaped(s, FIND_STRONG_RE, j + 2);
        if (k > j + 2) {
          out += `<strong>${inline(s.slice(j + 2, k), link)}</strong>`;
          i = k + 2;
        } else {
          out += '**';
          i = j + 2;
        }
      } else {
        const k = findSingleStar(s, j + 1);
        if (k > j + 1) {
          out += `<em>${inline(s.slice(j + 1, k), link)}</em>`;
          i = k + 1;
        } else {
          out += '*';
          i = j + 1;
        }
      }
      continue;
    }
    // '['
    const k = findUnescaped(s, FIND_BRACKET_RE, j + 1);
    const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
    const target = m === -1 ? '' : s.slice(k + 2, m);
    if (target !== '' && !WS_RE.test(target)) {
      out += `<a href="${esc(link(target))}">${inline(s.slice(j + 1, k), link)}</a>`;
      i = m + 1;
    } else {
      out += '[';
      i = j + 1;
    }
  }
  return out;
}

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line[a] === ' ' || line[a] === '\t')) a++;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

function fenceLang(line) {
  let j = 3;
  const n = line.length;
  let lang = '';
  while (j < n) {
    const c = line.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) {
      lang += line[j];
      j++;
    } else break;
  }
  while (j < n && (line[j] === ' ' || line[j] === '\t')) j++;
  return j === n ? lang : null;
}

function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let j = 3; j < line.length; j++) if (line[j] !== ' ' && line[j] !== '\t') return false;
  return true;
}

function headingOf(line) {
  if (line.charCodeAt(0) !== 35) return null;
  let d = 0;
  while (d < line.length && line.charCodeAt(d) === 35) d++;
  if (d === 0 || d > 6) return null;
  const c = line[d];
  if (c !== ' ' && c !== '\t') return null;
  let j = d;
  while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
  const text = trimLine(line.slice(j));
  return text === '' ? null : { depth: d, text };
}

function isHR(line) {
  const c = line.charCodeAt(0);
  if (c !== 45 && c !== 42) return false;
  if (line.charCodeAt(1) !== c || line.charCodeAt(2) !== c) return false;
  for (let j = 3; j < line.length; j++) if (line[j] !== ' ' && line[j] !== '\t') return false;
  return true;
}

/** A list item's start: { ordered, start, text }, or null. `ordered` pins the kind. */
function listStart(line, ordered) {
  if (ordered === undefined) {
    const c = line.charCodeAt(0);
    if ((c === 45 || c === 42) && line.charCodeAt(1) === 32) return { ordered: false, start: 1, text: line.slice(2) };
    return listStart(line, true);
  }
  if (ordered) {
    let j = 0;
    while (j < line.length) {
      const c = line.charCodeAt(j);
      if (c >= 48 && c <= 57) j++;
      else break;
    }
    if (j === 0 || j > 9) return null;
    if (line.charCodeAt(j) !== 46 || line.charCodeAt(j + 1) !== 32) return null;
    return { ordered: true, start: Number(line.slice(0, j)), text: line.slice(j + 2) };
  }
  const c = line.charCodeAt(0);
  if ((c === 45 || c === 42) && line.charCodeAt(1) === 32) return { ordered: false, start: 1, text: line.slice(2) };
  return null;
}

/** One pass over a line's first characters: bit 1 blank, 2 fence-open, 4 heading, 8 hr, 16 quote, 32 bullet, 64 ordered. */
function lineFlags(line) {
  if (line.length === 0) return 1;
  const c0 = line.charCodeAt(0);
  if (c0 === 32 || c0 === 9) {
    for (let i = 0; i < line.length; i++) {
      const c = line.charCodeAt(i);
      if (c !== 32 && c !== 9) return 0;
    }
    return 1;
  }
  if (c0 === 96) {
    if (line.charCodeAt(1) === 96 && line.charCodeAt(2) === 96) return fenceLang(line) !== null ? 2 : 0;
    return 0;
  }
  if (c0 === 35) return headingOf(line) !== null ? 4 : 0;
  if (c0 === 45 || c0 === 42) {
    if (line.charCodeAt(1) === 32) return 32;
    if (line.charCodeAt(1) === c0 && line.charCodeAt(2) === c0) return isHR(line) ? 8 : 0;
    return 0;
  }
  if (c0 === 62) return 16;
  if (c0 >= 48 && c0 <= 57) {
    let j = 0;
    while (j < line.length) {
      const c = line.charCodeAt(j);
      if (c >= 48 && c <= 57) j++;
      else break;
    }
    if (j > 0 && j <= 9 && line.charCodeAt(j) === 46 && line.charCodeAt(j + 1) === 32) return 64;
    return 0;
  }
  return 0;
}

/** Whether `line` ends a paragraph: blank, a fence, a heading or a thematic break. */
const endsParagraph = (line) => (lineFlags(line) & 15) !== 0;

/**
 * `src` rendered: its HTML, its table of contents and its excerpt (the first paragraph's
 * inline HTML, or ""). `slugify` is the case's memoized slug function; `link` resolves links.
 */
function renderMarkdown(src, link, slugify) {
  const lines = src.split('\n');
  const n = lines.length;
  const blocks = [];
  const toc = [];
  const ids = new Set();
  let excerpt = null;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    const fl = lineFlags(line);
    if (fl === 1) {
      i++;
      continue;
    }
    if (fl & 2) {
      const lang = fenceLang(line);
      const body = [];
      i++;
      while (i < n && !isFenceClose(lines[i])) body.push(lines[i++]);
      i++;
      let s = '<pre><code';
      if (lang !== '') s += ` class="language-${esc(lang)}"`;
      s += '>';
      if (body.length > 0) s += esc(body.join('\n')) + '\n';
      s += '</code></pre>\n';
      blocks.push(s);
      continue;
    }
    if (fl & 4) {
      const hd = headingOf(line);
      const id = uniqueSlug(slugify(hd.text), ids);
      const html = inline(hd.text, link);
      blocks.push(`<h${hd.depth} id="${id}">${html}</h${hd.depth}>\n`);
      if (hd.depth === 2 || hd.depth === 3) toc.push({ level: hd.depth, id, html });
      i++;
      continue;
    }
    if (fl & 8) {
      blocks.push('<hr>\n');
      i++;
      continue;
    }
    if (fl & 16) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1));
      }
      const parts = [];
      for (let b = 0; b < body.length; b++) {
        const t = trimLine(body[b]);
        if (t !== '') parts.push(t);
      }
      blocks.push(parts.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(parts.join('\n'), link)}</p>\n</blockquote>\n`);
      continue;
    }
    if (fl & 96) {
      const lb = listStart(line);
      const isOrdered = lb.ordered;
      const items = [];
      while (i < n) {
        const m = listStart(lines[i], isOrdered);
        if (m !== null) {
          items.push([trimLine(m.text)]);
          i++;
        } else if (CONTINUED_RE.test(lines[i])) {
          items[items.length - 1].push(trimLine(lines[i]));
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && lb.start !== 1 ? `<ol start="${lb.start}">` : `<${tag}>`;
      let s = open + '\n';
      for (let k = 0; k < items.length; k++) s += `<li>${inline(items[k].join('\n'), link)}</li>\n`;
      s += `</${tag}>\n`;
      blocks.push(s);
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), link);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>\n`);
  }
  return { html: blocks.join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

// --- template codegen: each template becomes function(root,sc,o,depth).
// Includes are inlined at compile time when possible (the included template parses,
// is not already being inlined above this point, and the static depth is below 8);
// otherwise they go through R.inc at the effective depth (runtime depth + static
// depth). A loop pushes a scope object only when its body can reach a dynamic
// (non-inlined) include, since only that can observe a loop binding cross-function.

function hasDynamicInclude(nodes, parsed, stack, d) {
  for (const n of nodes) {
    if (n.kind === 'include') {
      const T = n.name;
      if (!parsed.has(T) || d >= 8) continue; // renders nothing
      if (stack.includes(T)) return true; // a cycle: a dynamic call
      if (hasDynamicInclude(parsed.get(T), parsed, [...stack, T], d + 1)) return true;
    } else if (n.kind === 'for') {
      if (hasDynamicInclude(n.body, parsed, stack, d)) return true;
    } else if (n.kind === 'if') {
      if (hasDynamicInclude(n.then, parsed, stack, d)) return true;
      if (n.else !== null && hasDynamicInclude(n.else, parsed, stack, d)) return true;
    }
  }
  return false;
}

// --- template codegen: each template becomes function(root, sc, o, depth).
// Loop variables are JS locals ($name, $loop); anything else resolves through R.lk.
// A loop pushes a scope object only when its body can reach an include.

function genPath(path, bound) {
  const first = path[0];
  let e;
  if (bound.has(first)) e = first === 'loop' ? '$loop' : '$' + first;
  else e = `R.lk(root,sc,${JSON.stringify(first)})`;
  for (let k = 1; k < path.length; k++) e = `R.get(${e},${JSON.stringify(path[k])})`;
  return e;
}

function genNodes(nodes, ctx) {
  for (const n of nodes) {
    if (n.kind === 'text') ctx.parts.push(`o.push(${JSON.stringify(n.text)});`);
    else if (n.kind === 'var') ctx.parts.push(`o.push(R.esc(R.txt(${genPath(n.path, ctx.bound)})));`);
    else if (n.kind === 'raw') ctx.parts.push(`o.push(R.txt(${genPath(n.path, ctx.bound)}));`);
    else if (n.kind === 'if') {
      const cond = `R.truthy(${genPath(n.path, ctx.bound)})`;
      ctx.parts.push(n.not ? `if(!${cond}){` : `if(${cond}){`);
      genNodes(n.then, ctx);
      if (n.else !== null) {
        ctx.parts.push('}else{');
        genNodes(n.else, ctx);
      }
      ctx.parts.push('}');
    } else if (n.kind === 'for') {
      const u = ctx.uid++;
      const xs = `$$x${u}`;
      const kk = `$$k${u}`;
      const nn = `$$n${u}`;
      const lp = `$$l${u}`;
      const scp = `$$s${u}`;
      const hasDyn = hasDynamicInclude(n.body, ctx.parsed, ctx.stack, ctx.d);
      const arrExpr = genPath(n.path, ctx.bound); // before binding the loop var (e.g. {% for x in x %})
      const had = ctx.bound.has(n.name);
      const hadLoop = ctx.bound.has('loop');
      ctx.bound.add(n.name);
      ctx.bound.add('loop');
      ctx.parts.push(`{const ${xs}=${arrExpr};if(Array.isArray(${xs})){const ${nn}=${xs}.length;const ${lp}={index:0,first:false,last:false,length:${nn}};for(let ${kk}=0;${kk}<${nn};${kk}++){`);
      if (n.name === 'loop') ctx.parts.push(`const $loop=${lp};`);
      else ctx.parts.push(`const $${n.name}=${xs}[${kk}];const $loop=${lp};`);
      ctx.parts.push(`${lp}.index=${kk}+1;${lp}.first=${kk}===0;${lp}.last=${kk}===${nn}-1;`);
      if (hasDyn) {
        if (n.name === 'loop') ctx.parts.push(`const ${scp}={};${scp}.loop=${lp};sc.push(${scp});`);
        else ctx.parts.push(`const ${scp}={};${scp}[${JSON.stringify(n.name)}]=$${n.name};${scp}.loop=${lp};sc.push(${scp});`);
      }
      genNodes(n.body, ctx);
      if (hasDyn) ctx.parts.push('sc.pop();');
      ctx.parts.push('}}}');
      if (!had) ctx.bound.delete(n.name);
      if (!hadLoop) ctx.bound.delete('loop');
    } else if (n.kind === 'include') {
      const T = n.name;
      const d = ctx.d;
      if (ctx.parsed.has(T) && !ctx.stack.includes(T) && d < 8) {
        ctx.parts.push(`if(depth+${d}<8){`);
        ctx.stack.push(T);
        ctx.d = d + 1;
        genNodes(ctx.parsed.get(T), ctx);
        ctx.d = d;
        ctx.stack.pop();
        ctx.parts.push('}');
      } else if (d < 8 && ctx.parsed.has(T)) {
        ctx.parts.push(`R.inc(${JSON.stringify(T)},root,sc,o,depth+${d});`);
      }
      // Unparsed, or at static depth 8: renders nothing.
    }
  }
}

function compileTemplate(name, nodes, R, parsed) {
  const ctx = { uid: 0, bound: new Set(), parts: [], parsed, stack: [name], d: 0 };
  genNodes(nodes, ctx);
  return new Function('R', `return function(root,sc,o,depth){${ctx.parts.join('')}}`)(R);
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

// ---------------------------------------------------------------- build

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

export function run(input) {
  const slugMemo = new Map();
  const slugify = (t) => {
    let s = slugMemo.get(t);
    if (s === undefined) {
      s = slugifyRaw(t);
      slugMemo.set(t, s);
    }
    return s;
  };

  // Templates are parsed up front (a parse failure is reported) but compiled lazily:
  // only the templates a build actually renders pay the `new Function` cost.
  const parsed = new Map();
  const compiled = new Map();
  const getCompiled = (name) => {
    let f = compiled.get(name);
    if (f === undefined) {
      const nodes = parsed.get(name);
      if (nodes === undefined) return undefined;
      f = compileTemplate(name, nodes, R, parsed);
      compiled.set(name, f);
    }
    return f;
  };
  const R = {
    esc,
    txt: textOf,
    truthy,
    lk(root, sc, name) {
      for (let i = sc.length - 1; i >= 0; i--) {
        const s = sc[i];
        if (Object.hasOwn(s, name)) return s[name];
      }
      return Object.hasOwn(root, name) ? root[name] : undefined;
    },
    get(v, seg) {
      return v !== null && typeof v === 'object' && Object.hasOwn(v, seg) ? v[seg] : undefined;
    },
    inc(name, root, sc, o, depth) {
      if (depth < 8) {
        const f = getCompiled(name);
        if (f !== undefined) f(root, sc, o, depth + 1);
      }
    },
  };
  const render = (name, vars) => {
    const f = getCompiled(name);
    if (f === undefined) return null;
    const o = [];
    f(vars, [], o, 0);
    return o.join('');
  };

  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      parsed.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }

  const base = input.site.base_url.replace(/\/+$/, '');
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.includes('\r') ? f.content.replace(/\r\n?/g, '\n') : f.content });
    else statics.push({ path: f.path, content: f.content });
  }

  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!parsed.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  const bySource = new Map();
  const taken = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const set = taken.get(dir) ?? taken.set(dir, new Set(dir === '' ? RESERVED : [])).get(dir);
    s.slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.outDir = dir === '' ? s.slug : `${dir}/${s.slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  const linkCache = new Map();
  for (const s of kept) {
    const dir = dirOf(s.path);
    let dirCache = linkCache.get(dir);
    if (dirCache === undefined) {
      dirCache = new Map();
      linkCache.set(dir, dirCache);
    }
    const link = (target) => {
      const hit = dirCache.get(target);
      if (hit !== undefined) {
        // A cached broken target still reports once per source that links it.
        if (hit === null) broken.add(`broken-link ${s.path} -> ${target}`);
        return hit === null ? target : hit;
      }
      let out;
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) out = target;
      else {
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) out = `${bySource.get(path).url}${frag}`;
        else if (path !== null && staticPaths.has(path)) out = `${base}/${path}${frag}`;
        else {
          broken.add(`broken-link ${s.path} -> ${target}`);
          out = null; // broken: cache the fact, report per source above
        }
      }
      dirCache.set(target, out);
      return out === null ? target : out;
    };
    const md = renderMarkdown(s.body, link, slugify);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  const bySlug = new Map();
  for (const p of posts) {
    p.tagRefs = [];
    const seen = new Set();
    for (const name of p.data.tags ?? []) {
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = [];
    const seen = new Set();
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      s.tagRefs.push(bySlug.get(slug) ?? { name, slug, url: '', posts: [] });
    }
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  const linkOf = (s) =>
    s === null
      ? null
      : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) };
  const cards = new Map();
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  for (const p of posts) cards.set(p, cardOf(p));
  const pageOf = (s) => ({
    ...(cards.get(s) ?? cardOf(s)),
    slug: s.slug,
    content: s.html,
    toc: s.toc, // entries already are exactly { level, id, html }
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });

  const output = {};
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { site, tags: allTags, recent, page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      site,
      tags: allTags,
      recent,
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', {
      site,
      tags: allTags,
      recent,
      tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) },
    });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', { site, tags: allTags, recent });
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  const lines = [...report, ...broken].sort(byCodeUnits);
  const pagesCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pagesCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
