import { readFileSync } from 'fs';
import { runProgram } from '../lib/cpp/interpreter';

const files = process.argv.slice(2);
const inputs: Record<string, string> = {
  '1.cpp': '2\n99\n',
  '2.cpp': '1\nreport.pdf\n1\nphoto.png\n4\n2\n0\n',
  '4.cpp': '3\n2\n5\n3\n4\n',
  '5.cpp': '5\n',
  'MyLogic.cpp': '1\n10\n1\n20\n2\n0\n',
  'linkedLise copy 2.cpp': '1\n5\n2\n0\n',
};
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const base = f.split(/[\/]/).pop()!;
  const t0 = Date.now();
  const r = runProgram(src, inputs[base] ?? '');
  const ms = Date.now() - t0;
  console.log(`\n===== ${base}  (${ms}ms)`);
  if (r.parseError) { console.log('PARSE ERROR line', r.parseError.line, r.parseError.msg); continue; }
  const last = r.snaps[r.snaps.length - 1];
  console.log('steps:', r.snaps.length, 'last kind:', last.kind, 'line', last.line);
  console.log('note:', last.note, last.error ? '\nERROR: ' + last.error : '');
  console.log('events:', last.events.join(' | '));
  console.log('OUT:\n' + last.out.replace(/\u0001|\u0002/g, ''));
  console.log('heap objs:', last.heap.length, 'leaked:', last.heap.filter(h => h.leaked).length);
  if (process.env.V) for (const s of r.snaps.slice(0, Number(process.env.V))) console.log(s.kind, s.line, '|', s.note.replace(/\n/g,' / '), '|', s.events.join(' ; '));
}
