// Tiny C++ syntax highlighter -> lines of segments
export interface Seg { t: string; c?: string }

const KW = new Set([
  'if', 'else', 'while', 'for', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default', 'new', 'delete',
  'struct', 'class', 'public', 'private', 'protected', 'using', 'namespace', 'const', 'static', 'this', 'nullptr', 'NULL',
  'true', 'false', 'sizeof', 'typedef', 'enum', 'template', 'typename', 'inline', 'virtual', 'friend', 'operator', 'constexpr',
  'static_cast', 'goto', 'try', 'catch', 'throw',
]);
const TY = new Set(['int', 'double', 'float', 'char', 'bool', 'long', 'short', 'unsigned', 'signed', 'void', 'auto', 'string', 'vector', 'size_t', 'std']);

const RE = /(\/\/[^\n]*)|(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?)|('(?:\\.|[^'\\\n])*'?)|(^[ \t]*#[^\n]*)|(\b\d[\w.']*)|([A-Za-z_]\w*)|(\n)|([^\w\n"'/#]+|[/#])/gm;

export function highlight(code: string): Seg[][] {
  const userTypes = new Set<string>();
  for (const m of code.matchAll(/\b(?:struct|class|enum)\s+([A-Za-z_]\w*)/g)) userTypes.add(m[1]);
  const lines: Seg[][] = [[]];
  const push = (t: string, c?: string) => {
    const parts = t.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ t: p, c });
    });
  };
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  let last = 0;
  while ((m = RE.exec(code))) {
    if (m.index > last) push(code.slice(last, m.index));
    last = RE.lastIndex;
    if (m[0] === '') { RE.lastIndex++; continue; }
    if (m[1] || m[2]) push(m[0], 'tk-com');
    else if (m[3] || m[4]) push(m[0], 'tk-str');
    else if (m[5]) push(m[0], 'tk-pre');
    else if (m[6]) push(m[0], 'tk-num');
    else if (m[7]) push(m[0], KW.has(m[0]) ? 'tk-kw' : TY.has(m[0]) || userTypes.has(m[0]) ? 'tk-ty' : undefined);
    else push(m[0]);
  }
  if (last < code.length) push(code.slice(last));
  return lines;
}
