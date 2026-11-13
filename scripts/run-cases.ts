import { readFileSync, readdirSync } from 'fs';
import { runProgram } from '../lib/cpp/interpreter';
const strip = (s: string) => s.replace(/[\u0001\u0002⁦-⁩]/g, '');
const inputs: Record<string,string> = { 'b.cpp': '70 60' };
for (const f of readdirSync('scripts/cases').sort()) {
  const r = runProgram(readFileSync('scripts/cases/' + f, 'utf8'), inputs[f] ?? '');
  if (r.parseError) { console.log('=====', f, 'PARSE', r.parseError); continue; }
  const last = r.snaps[r.snaps.length - 1];
  console.log('=====', f, r.snaps.length, 'steps', last.kind, 'line', last.line, strip(last.error ?? ''));
  console.log(strip(last.out));
}
