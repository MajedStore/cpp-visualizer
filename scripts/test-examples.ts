import { runProgram } from '../lib/cpp/interpreter';
import { EXAMPLES } from '../lib/examples';
for (const ex of EXAMPLES) {
  const r = runProgram(ex.code, ex.input ?? '');
  if (r.parseError) { console.log('X', ex.id, 'PARSE', r.parseError); continue; }
  const last = r.snaps[r.snaps.length - 1];
  console.log(last.kind === 'end' ? 'OK' : '!!', ex.id, r.snaps.length, 'steps |', last.error ?? '', '| out:', JSON.stringify(last.out.replace(/\u0001|\u0002/g, '')), '| heap', last.heap.length, 'leak', last.heap.filter(h=>h.leaked).length);
}
