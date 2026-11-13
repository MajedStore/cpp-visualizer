// Lexer for a teaching subset of C++

export type TokKind = 'id' | 'num' | 'str' | 'char' | 'op' | 'eof';

export interface Token {
  k: TokKind;
  v: string;
  line: number;
  pos: number;
  end: number;
  num?: number;
  isFloat?: boolean;
}

export class CppError extends Error {
  line: number;
  constructor(msg: string, line: number) {
    super(msg);
    this.line = line;
  }
}

const OPS3 = ['<<=', '>>=', '...', '->*'];
const OPS2 = ['->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::'];
const OPS1 = '+-*/%<>=!&|^~?:;,.()[]{}';

const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v', '?': '?' };

export function lex(src: string): Token[] {
  const toks: Token[] = [];
  const macros = new Map<string, Token[]>();
  let i = 0;
  let line = 1;
  const n = src.length;

  const push = (t: Token) => {
    if (t.k === 'id' && macros.has(t.v)) {
      for (const m of macros.get(t.v)!) toks.push({ ...m, line: t.line, pos: t.pos, end: t.end });
      return;
    }
    toks.push(t);
  };

  const readEscaped = (quote: string): string => {
    // i points after opening quote
    let s = '';
    while (i < n && src[i] !== quote) {
      if (src[i] === '\n') throw new CppError('نص (string) لم يُغلق بعلامة التنصيص', line);
      if (src[i] === '\\') {
        const e = src[i + 1];
        if (e === 'x') {
          let j = i + 2;
          let hex = '';
          while (j < n && /[0-9a-fA-F]/.test(src[j])) hex += src[j++];
          s += String.fromCharCode(parseInt(hex || '0', 16));
          i = j;
          continue;
        }
        s += ESC[e] ?? e;
        i += 2;
        continue;
      }
      s += src[i++];
    }
    if (i >= n) throw new CppError('نص (string) لم يُغلق بعلامة التنصيص', line);
    i++; // closing quote
    return s;
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    if (c === '#') {
      const start = i;
      const startLine = line;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\' && src[i + 1] === '\n') { i += 2; line++; continue; }
        i++;
      }
      const text = src.slice(start, i).replace(/\\\n/g, ' ').trim();
      if (/^#\s*define\s+[A-Za-z_]\w*\(/.test(text)) {
        throw new CppError('الماكرو الدالّي (#define بمعاملات) غير مدعوم — استخدم دالة عادية', startLine);
      }
      const m = /^#\s*define\s+([A-Za-z_]\w*)(?:\s+(.*))?$/.exec(text);
      if (m) {
        const body = (m[2] || '').replace(/\/\/.*$/, '');
        macros.set(m[1], lex(body).filter((t) => t.k !== 'eof'));
      }
      continue;
    }
    // identifiers
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      // string/char prefixes like L"..", u8".."
      if ((word === 'L' || word === 'u8' || word === 'u' || word === 'U') && (src[j] === '"' || src[j] === "'")) {
        i = j;
        continue;
      }
      push({ k: 'id', v: word, line, pos: i, end: j });
      i = j;
      continue;
    }
    // numbers
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const rest = src.slice(i);
      const m = /^(0[xX][0-9a-fA-F']+|0[bB][01']+|(?:\d[\d']*\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?))([uUlLfF]*)/.exec(rest)!;
      const raw = m[1].replace(/'/g, '');
      const suf = m[2];
      let val: number;
      let isFloat = false;
      if (/^0[xX]/.test(raw)) val = parseInt(raw, 16);
      else if (/^0[bB]/.test(raw)) val = parseInt(raw.slice(2), 2);
      else {
        isFloat = /[.eE]/.test(raw) || /[fF]/.test(suf);
        val = isFloat ? parseFloat(raw) : (raw.length > 1 && raw[0] === '0' ? parseInt(raw, 8) : parseInt(raw, 10));
      }
      push({ k: 'num', v: m[0], line, pos: i, end: i + m[0].length, num: val, isFloat });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      const start = i;
      i++;
      const s = readEscaped('"');
      push({ k: 'str', v: s, line, pos: start, end: i });
      continue;
    }
    if (c === "'") {
      const start = i;
      i++;
      const s = readEscaped("'");
      if (s.length === 0) throw new CppError("حرف فارغ '' غير صالح", line);
      push({ k: 'char', v: s, line, pos: start, end: i, num: s.charCodeAt(0) });
      continue;
    }
    let op = '';
    for (const o of OPS3) if (src.startsWith(o, i)) { op = o; break; }
    if (!op) for (const o of OPS2) if (src.startsWith(o, i)) { op = o; break; }
    if (!op && OPS1.includes(c)) op = c;
    if (!op) throw new CppError(`رمز غير متوقع '${c}'`, line);
    push({ k: 'op', v: op, line, pos: i, end: i + op.length });
    i += op.length;
  }
  toks.push({ k: 'eof', v: '', line, pos: n, end: n });
  return toks;
}
