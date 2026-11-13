// Step-recording interpreter for a teaching subset of C++.
// Runs the whole program up-front and records a memory snapshot at every step.
import { CppError } from './lexer';
import { parseProgram, Program, StructDef, FuncDef, TypeSpec, Declarator, Expr, Stmt } from './parser';
import { Snapshot, SnapVal, SnapVar, SnapFrame, SnapHeap, RunResult, SnapKind } from './types';

type Type = any;

interface Cell {
  id: number;
  t: Type;
  v: any;
  init: boolean;
  addr: number;
  heap: boolean;
  alive: boolean;
  parent?: Cell;
  key?: string | number;
  root: Cell;
  born: number;
  diedAt?: number;
  name?: string;
  proxy?: { get(): any; set(v: any): void };
  temp?: boolean;
  cap?: number;
  buf?: number;
}

interface RV {
  t: Type;
  v: any;
  cell?: Cell;
  lit?: boolean;
}

interface Frame {
  id: number;
  name: string;
  fn: FuncDef;
  scopes: { map: Map<string, Cell>; sp: number }[];
  thisCell: Cell | null;
  line: number;
  spSave: number;
}

class BreakSig {}
class ContinueSig {}
class ReturnSig { constructor(public v?: RV) {} }
class StopSig { constructor(public msg: string, public kind: SnapKind) {} }
class ExitSig { constructor(public code: number) {} }

const INT = { k: 'prim', name: 'int' };
const LL = { k: 'prim', name: 'long long' };
const ULONG = { k: 'prim', name: 'unsigned long' };
const DBL = { k: 'prim', name: 'double' };
const BOOL = { k: 'prim', name: 'bool' };
const CHAR = { k: 'prim', name: 'char' };
const VOID = { k: 'prim', name: 'void' };
const STR = { k: 'string' };
const NULLT = { k: 'nullptr' };
const OSTREAM = { k: 'ostream' };
const ISTREAM = { k: 'istream' };
const MANIP = { k: 'manip' };
const VOIDRV: RV = { t: VOID, v: undefined };
const GARBAGE = { target: null, garbage: true };
const NOT_BUILTIN = Symbol('nb');

const PRIM_SIZE: Record<string, number> = {
  char: 1, 'unsigned char': 1, bool: 1, short: 2, 'unsigned short': 2, int: 4, 'unsigned int': 4, float: 4,
  long: 8, 'unsigned long': 8, 'long long': 8, 'unsigned long long': 8, double: 8, void: 1,
};

const isFloatName = (n: string) => n === 'float' || n === 'double';
const hex = (a: number) => '0x' + Math.max(0, a).toString(16);

export function typeName(t: Type): string {
  if (!t) return '?';
  switch (t.k) {
    case 'prim': return t.name;
    case 'string': return 'string';
    case 'ptr': return typeName(t.to) + '*';
    case 'ref': return typeName(t.to) + '&';
    case 'array': {
      let b = t;
      const dims: number[] = [];
      while (b.k === 'array') { dims.push(b.n); b = b.of; }
      return typeName(b) + dims.map((d) => `[${d}]`).join('');
    }
    case 'struct': return t.name;
    case 'vector': return `vector<${typeName(t.of)}>`;
    case 'nullptr': return 'nullptr_t';
    default: return t.k;
  }
}

function numConv(v: number, name: string): number {
  if (typeof v !== 'number' || isNaN(v)) v = 0;
  switch (name) {
    case 'double': return +v;
    case 'float': return Math.fround(+v);
    case 'bool': return v ? 1 : 0;
    case 'char': { const x = Math.trunc(v) & 255; return x > 127 ? x - 256 : x; }
    case 'unsigned char': return Math.trunc(v) & 255;
    case 'short': { const x = Math.trunc(v) & 0xffff; return x > 32767 ? x - 65536 : x; }
    case 'unsigned short': return Math.trunc(v) & 0xffff;
    case 'int': return isFinite(v) ? Math.trunc(v) | 0 : 0;
    case 'unsigned int': return isFinite(v) ? Math.trunc(v) >>> 0 : 0;
    default: return isFinite(v) ? Math.trunc(v) : 0;
  }
}

function stripZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function fmtG(v: number, prec = 6): string {
  if (isNaN(v)) return 'nan';
  if (!isFinite(v)) return v < 0 ? '-inf' : 'inf';
  if (v === 0) return Object.is(v, -0) ? '-0' : '0';
  const p = Math.max(1, prec);
  let exp = Math.floor(Math.log10(Math.abs(v)));
  const rounded = Number(v.toPrecision(p));
  if (rounded !== 0) exp = Math.floor(Math.log10(Math.abs(rounded)));
  if (exp < -4 || exp >= p) {
    const [m, e] = v.toExponential(p - 1).split('e');
    const en = parseInt(e, 10);
    return stripZeros(m) + 'e' + (en < 0 ? '-' : '+') + String(Math.abs(en)).padStart(2, '0');
  }
  return stripZeros(v.toFixed(Math.max(0, p - 1 - exp)));
}

function charDisp(c: number): string {
  const ch = String.fromCharCode(c < 0 ? c + 256 : c);
  const esc: Record<string, string> = { '\n': '\\n', '\t': '\\t', '\0': '\\0', '\r': '\\r', "'": "\\'", '\\': '\\\\' };
  if (esc[ch]) return `'${esc[ch]}'`;
  if (c < 32) return `'\\x${c.toString(16)}'`;
  return `'${ch}'`;
}

export class Interp {
  prog: Program;
  input: string;
  inPos = 0;
  cinFail = false;
  maxSteps: number;

  snaps: Snapshot[] = [];
  events: string[] = [];
  printed = '';
  out = '';

  globals = new Map<string, Cell>();
  globalOrder: Cell[] = [];
  statics = new Map<string, Cell>();
  hidden = new Map<string, Cell>();
  frames: Frame[] = [];
  heapList: Cell[] = [];
  layouts = new Map<string, { fields: { name: string; t: Type; off: number }[]; size: number; align: number }>();
  layoutBusy = new Set<string>();
  warned = new Set<number>();

  nextId = 1;
  nextFrameId = 1;
  sp = 0x7ffe0000;
  hp = 0x01a2b000;
  gp = 0x00404000;
  curLine = 0;
  inCond = 0;
  randSeed = 1;
  // stream formatting
  fixed = false;
  precision = 6;
  width = 0;
  boolalpha = false;

  constructor(prog: Program, input: string, maxSteps: number) {
    this.prog = prog;
    this.input = input;
    this.maxSteps = maxSteps;
    const mk = (name: string, t: Type, v: any = null) => {
      const c = this.newCell(t, 0, false);
      c.v = v;
      c.init = true;
      c.temp = true;
      c.name = name;
      this.hidden.set(name, c);
    };
    mk('cout', OSTREAM);
    mk('cerr', OSTREAM);
    mk('clog', OSTREAM);
    mk('cin', ISTREAM);
    mk('endl', MANIP, { endl: true });
    mk('fixed', MANIP, { fixed: true });
    mk('boolalpha', MANIP, { boolalpha: true });
    mk('INT_MAX', INT, 2147483647);
    mk('INT_MIN', INT, -2147483648);
    mk('RAND_MAX', INT, 2147483647);
    mk('npos', LL, -1);
    mk('EOF', INT, -1);
  }

  get frame(): Frame | undefined { return this.frames[this.frames.length - 1]; }

  err(msg: string, line?: number): never {
    throw new CppError(msg, line ?? this.curLine);
  }

  event(s: string) {
    if (this.events.length < 14) this.events.push(s);
  }

  // =================== snapshots ===================
  snap(kind: SnapKind, line: number, note: string, force = false) {
    if (!force && this.snaps.length >= this.maxSteps) {
      throw new StopSig(`Step limit reached (${this.maxSteps} steps) — possible infinite loop`, 'error');
    }
    const evs = this.events;
    this.events = [];
    if (this.printed) {
      evs.push(`output: «${this.printed.replace(/\u0001|\u0002/g, '').replace(/\n/g, '⏎')}»`);
      this.printed = '';
    }
    this.snaps.push(this.serialize(kind, line, note, evs));
  }

  serialize(kind: SnapKind, line: number, note: string, events: string[]): Snapshot {
    const idx = this.snaps.length;
    // reachability
    const reach = new Set<Cell>();
    const pointed = new Set<Cell>();
    const visit = (c: Cell, live: boolean) => {
      if (!c) return;
      const t = c.t;
      if (t.k === 'ptr') {
        if (c.init && c.v && c.v.target) {
          const r: Cell = c.v.target.root;
          pointed.add(r);
          if (live && r.heap && r.alive && !reach.has(r)) { reach.add(r); visit(r, true); }
        } else if (c.init && c.v && c.v.base) {
          const r: Cell = c.v.base.root;
          pointed.add(r);
          if (live && r.heap && r.alive && !reach.has(r)) { reach.add(r); visit(r, true); }
        }
      } else if (t.k === 'ref') {
        if (c.v) {
          const r: Cell = c.v.root;
          if (live && r.heap && r.alive && !reach.has(r)) { reach.add(r); visit(r, true); }
        }
      } else if (t.k === 'struct') {
        for (const k in c.v) visit(c.v[k], live);
      } else if (t.k === 'array' || t.k === 'vector') {
        for (const e of c.v) visit(e, live);
      }
    };
    for (const c of this.globalOrder) visit(c, true);
    for (const f of this.frames) {
      for (const s of f.scopes) for (const c of s.map.values()) visit(c, true);
      if (f.thisCell) {
        const r = f.thisCell.root;
        if (r.heap && r.alive && !reach.has(r)) { reach.add(r); visit(r, true); }
      }
    }
    for (const h of this.heapList) if (h.alive && !reach.has(h)) visit(h, false);

    const frames: SnapFrame[] = [];
    frames.push({ id: 0, name: 'Global', line: 0, global: true, vars: this.globalOrder.map((c) => this.sVar(c.name!, c)) });
    for (const f of this.frames) {
      const vars: SnapVar[] = [];
      if (f.thisCell) {
        const tc = f.thisCell;
        vars.push({ id: -f.id, name: 'this', type: typeName(tc.t) + '*', addr: '', born: idx, val: { k: 'ptr', text: hex(tc.addr), target: tc.id } });
      }
      for (const s of f.scopes) for (const [n, c] of s.map) vars.push(this.sVar(n, c));
      frames.push({ id: f.id, name: f.name, line: f.line, vars });
    }
    const heap: SnapHeap[] = [];
    for (const h of this.heapList) {
      const show = h.alive || h.diedAt === idx || pointed.has(h);
      if (!show) continue;
      heap.push({
        id: h.id,
        type: typeName(h.t),
        addr: hex(h.addr),
        val: this.sVal(h),
        alive: h.alive,
        leaked: h.alive && !reach.has(h),
        born: h.born,
        diedAt: h.diedAt,
        isArray: h.t.k === 'array',
      });
    }
    return { kind, line, note, events, frames, heap, out: this.out };
  }

  sVar(name: string, c: Cell): SnapVar {
    return { id: c.id, name, type: typeName(c.t), addr: hex(c.addr), val: this.sVal(c), born: c.born };
  }

  sVal(c: Cell): SnapVal {
    const t = c.t;
    switch (t.k) {
      case 'ref':
        return { k: 'ref', target: c.v ? c.v.id : null };
      case 'ptr': {
        if (!c.init) return { k: 'ptr', text: '?', uninit: true };
        const p = c.v;
        if (p === null) return { k: 'ptr', text: 'nullptr', null: true };
        if (p.garbage) return { k: 'ptr', text: '?', uninit: true };
        if (p.target) {
          const r: Cell = p.target.root;
          return { k: 'ptr', text: hex(p.target.addr), target: p.target.temp || r.temp ? null : p.target.id, dangling: !r.alive && r.heap, outOfScope: !r.alive && !r.heap };
        }
        return { k: 'ptr', text: hex(this.addrOf(p)), target: null, pastEnd: true };
      }
      case 'struct':
        return { k: 'struct', fields: Object.keys(c.v).map((k) => this.sVar(k, c.v[k])) };
      case 'array':
      case 'vector': {
        const lim = 120;
        const els: Cell[] = c.v;
        const val: any = { k: 'array', elems: els.slice(0, lim).map((e, i) => this.sVar(String(i), e)), vector: t.k === 'vector' };
        if (els.length > lim) val.more = els.length - lim;
        return val;
      }
      case 'string':
        return { k: 'prim', text: JSON.stringify(c.v ?? ''), str: true };
      case 'prim':
        if (!c.init) return { k: 'prim', text: '?', uninit: true };
        return { k: 'prim', text: this.fmtPrim(c.v, t.name) };
      default:
        return { k: 'prim', text: '…' };
    }
  }

  fmtPrim(v: number, name: string): string {
    if (name === 'bool') return v ? 'true' : 'false';
    if (name === 'char' || name === 'unsigned char') return charDisp(v);
    if (isFloatName(name)) {
      const s = fmtG(v, 6);
      return /^-?\d+$/.test(s) ? s + '.0' : s;
    }
    return String(v);
  }

  dispCell(c: Cell): string {
    if (c.t.k === 'ref') return '&' + (c.v ? this.label(c.v) : '?');
    if (c.proxy) return charDisp(c.proxy.get());
    const v = this.sVal(c);
    if (v.k === 'ptr') {
      if (v.null) return 'nullptr';
      if (v.uninit) return '? (uninitialized)';
      const p = c.v;
      if (p && p.target) return `→ ${this.label(p.target)}`;
      return v.text;
    }
    if (v.k === 'prim') return v.uninit ? '? (uninitialized)' : v.text;
    if (v.k === 'struct') return `{${v.fields.map((f) => f.name).join(', ')}}`;
    if (v.k === 'array') return `[${c.v.length} items]`;
    return '…';
  }

  fmtRV(rv?: RV): string {
    if (!rv) return 'void';
    const t = rv.t;
    if (t.k === 'prim') return this.fmtPrim(rv.v, t.name);
    if (t.k === 'string') return JSON.stringify(rv.v);
    if (t.k === 'nullptr') return 'nullptr';
    if (t.k === 'ptr') {
      if (rv.v === null) return 'nullptr';
      if (rv.v.garbage) return '? (garbage)';
      if (rv.v.target) return `→ ${this.label(rv.v.target)}`;
      return hex(this.addrOf(rv.v));
    }
    if (t.k === 'struct') return `${t.name} object`;
    return typeName(t);
  }

  label(c: Cell): string {
    const root = c.root;
    const keys: (string | number)[] = [];
    let x: Cell | undefined = c;
    while (x && x !== root) { keys.unshift(x.key!); x = x.parent; }
    const path = keys.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('');
    if (root.heap) {
      let name = typeName(root.t);
      if (root.t.k === 'struct') {
        const first = Object.values(root.v as Record<string, Cell>).find((f) => f.t.k === 'prim' || f.t.k === 'string');
        name += first && first.init ? `(${first.t.k === 'string' ? JSON.stringify(first.v) : this.fmtPrim(first.v, first.t.name)})` : '';
      } else if (root.t.k === 'array') name = `${typeName(root.t.of)}[${root.t.n}]`;
      return name + path;
    }
    if (c.proxy) return 'string char';
    return `${root.name ?? 'temporary'}${path}`;
  }

  // =================== types & memory ===================
  sd(name: string): StructDef {
    const s = this.prog.structs.get(name);
    if (!s) this.err(`struct/class '${name}' is incomplete`);
    return s;
  }

  tsType(ts: TypeSpec, extraPtr = 0, dims: number[] = [], ref = false): Type {
    let t: Type;
    const b = ts.base;
    if (b === 'string') t = STR;
    else if (b === 'vector') t = { k: 'vector', of: this.tsType(ts.args![0]) };
    else if (b === 'auto') t = { k: 'auto' };
    else if (this.prog.structs.has(b)) t = { k: 'struct', name: b };
    else if (PRIM_SIZE[b] !== undefined) t = { k: 'prim', name: b };
    else this.err(`Type '${b}' is incomplete`);
    for (let i = 0; i < ts.ptr + extraPtr; i++) t = { k: 'ptr', to: t };
    for (let i = dims.length - 1; i >= 0; i--) t = { k: 'array', of: t, n: dims[i] };
    if (ts.ref || ref) t = { k: 'ref', to: t };
    return t;
  }

  layout(name: string) {
    const got = this.layouts.get(name);
    if (got) return got;
    const sd = this.sd(name);
    if (this.layoutBusy.has(name)) this.err(`struct ${name} contains itself — use a pointer (${name}*)`, sd.line);
    this.layoutBusy.add(name);
    const fields: { name: string; t: Type; off: number }[] = [];
    let off = 0;
    let maxAl = 1;
    for (const f of sd.fields) {
      if (f.isStatic) continue;
      const dims = f.d.dims.map((x) => (x == null ? 0 : this.toInt(this.ev(x), 'array size')));
      const t = this.tsType(f.ts, f.d.ptr, dims, f.d.ref);
      const al = this.alignOf(t);
      const sz = this.sizeOf(t);
      off = Math.ceil(off / al) * al;
      fields.push({ name: f.d.name, t, off });
      off += sz;
      maxAl = Math.max(maxAl, al);
    }
    const L = { fields, size: Math.max(1, Math.ceil(off / maxAl) * maxAl), align: maxAl };
    this.layouts.set(name, L);
    this.layoutBusy.delete(name);
    return L;
  }

  sizeOf(t: Type): number {
    switch (t.k) {
      case 'prim': return PRIM_SIZE[t.name] ?? 4;
      case 'ptr': case 'ref': case 'nullptr': return 8;
      case 'string': return 32;
      case 'vector': return 24;
      case 'array': return t.n * this.sizeOf(t.of);
      case 'struct': return this.layout(t.name).size;
      default: return 8;
    }
  }

  alignOf(t: Type): number {
    switch (t.k) {
      case 'prim': return Math.min(8, PRIM_SIZE[t.name] ?? 4);
      case 'array': return this.alignOf(t.of);
      case 'struct': return this.layout(t.name).align;
      default: return 8;
    }
  }

  newCell(t: Type, addr: number, zero: boolean, parent?: Cell, key?: string | number): Cell {
    const c: Cell = { id: this.nextId++, t, v: undefined, init: false, addr, heap: parent ? parent.heap : false, alive: true, parent, key, root: null as any, born: this.snaps.length };
    c.root = parent ? parent.root : c;
    switch (t.k) {
      case 'prim': if (zero) { c.v = 0; c.init = true; } break;
      case 'ptr': if (zero) { c.v = null; c.init = true; } break;
      case 'string': c.v = ''; c.init = true; break;
      case 'vector': c.v = []; c.init = true; c.cap = 0; break;
      case 'array': {
        if (t.n > 20000) this.err(`Array too large to visualize (${t.n} elements)`);
        const es = this.sizeOf(t.of);
        c.v = [];
        for (let i = 0; i < t.n; i++) c.v.push(this.newCell(t.of, addr + i * es, zero, c, i));
        c.init = true;
        break;
      }
      case 'struct': {
        const L = this.layout(t.name);
        c.v = Object.create(null);
        for (const f of L.fields) c.v[f.name] = this.newCell(f.t, addr + f.off, zero, c, f.name);
        c.init = true;
        break;
      }
    }
    return c;
  }

  setAddr(c: Cell, addr: number) {
    c.addr = addr;
    if (c.t.k === 'struct') {
      const L = this.layout(c.t.name);
      for (const f of L.fields) this.setAddr(c.v[f.name], addr + f.off);
    } else if (c.t.k === 'array') {
      const es = this.sizeOf(c.t.of);
      c.v.forEach((e: Cell, i: number) => this.setAddr(e, addr + i * es));
    }
  }

  allocStack(t: Type): Cell {
    const sz = Math.max(1, this.sizeOf(t));
    const al = this.alignOf(t);
    this.sp = Math.floor((this.sp - sz) / al) * al;
    return this.newCell(t, this.sp, false);
  }

  allocGlobal(t: Type): Cell {
    const al = this.alignOf(t);
    this.gp = Math.ceil(this.gp / al) * al;
    const c = this.newCell(t, this.gp, true);
    this.gp += Math.max(1, this.sizeOf(t));
    return c;
  }

  heapAddr(size: number): number {
    this.hp = Math.ceil((this.hp + 16) / 16) * 16;
    const a = this.hp;
    this.hp += Math.max(1, size);
    return a;
  }

  allocHeap(t: Type): Cell {
    const c = this.newCell(t, 0, false);
    this.setAddr(c, this.heapAddr(this.sizeOf(t)));
    const mark = (x: Cell) => {
      x.heap = true;
      if (x.t.k === 'struct') for (const k in x.v) mark(x.v[k]);
      else if (x.t.k === 'array') x.v.forEach(mark);
    };
    mark(c);
    this.heapList.push(c);
    return c;
  }

  tempCell(t: Type): Cell {
    const c = this.newCell(t, 0, false);
    c.temp = true;
    return c;
  }

  tempFrom(rv: RV): Cell {
    let t = rv.t;
    if (t.k === 'nullptr') t = { k: 'ptr', to: VOID };
    if (t.k === 'initlist' || t.k === 'manip') this.err('Invalid value here');
    const c = this.tempCell(t);
    this.store(c, rv);
    return c;
  }

  vecElem(vec: Cell, i: number): Cell {
    const of = vec.t.of;
    const es = this.sizeOf(of);
    if (vec.cap === undefined) vec.cap = 0;
    if (i >= vec.cap) {
      const ncap = Math.max(1, vec.cap * 2, i + 1);
      vec.buf = this.heapAddr(ncap * es);
      vec.cap = ncap;
      vec.v.forEach((e: Cell, j: number) => this.setAddr(e, vec.buf! + j * es));
    }
    const c = this.newCell(of, vec.buf! + i * es, false, vec, i);
    return c;
  }

  killCell(c: Cell) {
    c.alive = false;
    c.diedAt = this.snaps.length;
  }

  checkAlive(c: Cell) {
    const r = c.root;
    if (!r.alive) {
      if (r.heap) this.err('Use-after-free: accessing memory that was deleted (dangling pointer)');
      this.err('Accessing a local variable that is out of scope');
    }
  }

  // =================== values ===================
  read(c: Cell): RV {
    if (c.t.k === 'ref') {
      if (!c.v) this.err('Uninitialized reference');
      return this.read(c.v);
    }
    if (c.proxy) return { t: c.t, v: c.proxy.get() };
    this.checkAlive(c);
    switch (c.t.k) {
      case 'array':
        return { t: { k: 'ptr', to: c.t.of }, v: c.v.length ? this.ptrTo(c.v[0]) : { target: null, base: c, idx: 0 }, cell: c };
      case 'struct': case 'vector': case 'ostream': case 'istream': case 'manip':
        return { t: c.t, v: c.v, cell: c };
    }
    if (!c.init) {
      this.warnUninit(c);
      if (c.t.k === 'ptr') return { t: c.t, v: GARBAGE, cell: c };
      return { t: c.t, v: 0, cell: c };
    }
    return { t: c.t, v: c.v, cell: c };
  }

  warnUninit(c: Cell) {
    if (this.warned.has(c.id)) return;
    this.warned.add(c.id);
    const what = c.t.k === 'ptr' ? 'pointer' : 'variable';
    this.event(`reading uninitialized ${what} ${this.label(c)}`);
  }

  copyCell(dst: Cell, src: Cell) {
    if (src.t.k === 'ref') src = src.v;
    if (dst.t.k === 'ref') dst = dst.v;
    this.checkAlive(src);
    switch (dst.t.k) {
      case 'struct':
        for (const k in dst.v) this.copyCell(dst.v[k], src.v[k]);
        return;
      case 'array':
        dst.v.forEach((e: Cell, i: number) => this.copyCell(e, src.v[i]));
        return;
      case 'vector': {
        dst.v.forEach((e: Cell) => this.killCell(e));
        dst.v = [];
        dst.cap = 0;
        src.v.forEach((se: Cell, i: number) => {
          const nc = this.vecElem(dst, i);
          this.copyCell(nc, se);
          dst.v.push(nc);
        });
        return;
      }
      default:
        if (src.proxy) { dst.v = src.proxy.get(); dst.init = true; }
        else { dst.v = src.v; dst.init = src.init; }
    }
  }

  store(c: Cell, rv: RV) {
    if (c.t.k === 'ref') { if (!c.v) this.err('Uninitialized reference'); return this.store(c.v, rv); }
    if (c.proxy) { c.proxy.set(this.convert(rv, c.t)); return; }
    this.checkAlive(c);
    const t = c.t;
    if (rv.t.k === 'initlist') { this.initFromList(c, rv.v); return; }
    switch (t.k) {
      case 'struct': {
        if (rv.t.k !== 'struct' || rv.t.name !== t.name) {
          const sd = this.sd(t.name);
          if (sd.ctors.length) { this.constructWith(c, [{ pre: rv }], false); return; }
          this.err(`Cannot assign ${typeName(rv.t)} to ${t.name}` + (rv.t.k === 'ptr' ? ' — did you mean *ptr?' : ''));
        }
        if (rv.cell && rv.cell !== c) this.copyCell(c, rv.cell);
        return;
      }
      case 'array':
        if (t.of.k === 'prim' && t.of.name === 'char' && rv.t.k === 'string') {
          const s: string = rv.v;
          if (s.length + 1 > t.n) this.err(`String is longer than char[${t.n}]`);
          c.v.forEach((e: Cell, i: number) => { e.v = i < s.length ? s.charCodeAt(i) : 0; e.init = true; });
          return;
        }
        this.err('Arrays cannot be assigned with = — copy elements in a loop');
      case 'vector':
        if (rv.t.k !== 'vector') this.err(`Cannot assign ${typeName(rv.t)} to ${typeName(t)}`);
        if (rv.cell && rv.cell !== c) this.copyCell(c, rv.cell);
        return;
      default:
        c.v = this.convert(rv, t);
        c.init = true;
    }
  }

  convert(rv: RV, t: Type, explicit = false): any {
    const s = rv.t;
    switch (t.k) {
      case 'prim':
        if (t.name === 'void') return undefined;
        if (s.k === 'prim') {
          if (s.name === 'void') this.err('void value used');
          return numConv(rv.v, t.name);
        }
        if (s.k === 'ptr' || s.k === 'nullptr') {
          if (t.name === 'bool') return rv.v === null ? 0 : 1;
          if (explicit) return rv.v === null ? 0 : this.addrOf(rv.v);
          this.err(`Cannot convert pointer (${typeName(s)}) to ${t.name}` + (s.k === 'ptr' ? ' — did you mean *ptr or ptr->field?' : ''));
        }
        if (s.k === 'istream') return this.cinFail ? 0 : 1;
        if (s.k === 'string') this.err(`Cannot convert string to ${t.name} — use stoi() or stod()`);
        this.err(`Cannot convert ${typeName(s)} to ${t.name}`);
      case 'string':
        if (s.k === 'string') return rv.v;
        if (s.k === 'prim' && s.name === 'char') return String.fromCharCode(rv.v < 0 ? rv.v + 256 : rv.v);
        this.err(`Cannot convert ${typeName(s)} to string` + (s.k === 'prim' ? ' — use to_string()' : ''));
      case 'ptr':
        if (s.k === 'nullptr') return null;
        if (s.k === 'ptr') {
          if (!explicit && rv.v !== null) {
            const a = typeName(t.to), b = typeName(s.to);
            if (a !== b && a !== 'void' && b !== 'void') this.err(`Cannot assign ${b}* to ${a}*`);
          }
          return rv.v;
        }
        if (s.k === 'prim' && rv.v === 0 && !isFloatName(s.name)) return null;
        if (s.k === 'string' && t.to.k === 'prim' && t.to.name === 'char') this.err('char* strings are not supported — use string');
        if (s.k === 'struct') this.err(`Cannot assign ${s.name} object to ${typeName(t)} — missing & or new?`);
        this.err(`Cannot assign ${typeName(s)} to ${typeName(t)}`);
      default:
        return rv.v;
    }
  }

  ptrTo(c: Cell): any {
    if (c.parent && (c.parent.t.k === 'array' || c.parent.t.k === 'vector')) return { target: c, base: c.parent, idx: c.key };
    return { target: c };
  }

  addrOf(p: any): number {
    if (!p) return 0;
    if (p.target) return p.target.addr;
    if (p.base) return p.base.addr + p.idx * this.sizeOf(p.base.t.of);
    return 0;
  }

  ptrAdd(p: any, n: number): any {
    if (p === null) this.err('Pointer arithmetic on nullptr');
    if (p.garbage) this.err('Pointer arithmetic on an uninitialized pointer');
    n = Math.trunc(n);
    if (n === 0) return p;
    let base = p.base;
    let idx = p.idx;
    if (!base) {
      const t: Cell = p.target;
      if (t.parent && (t.parent.t.k === 'array' || t.parent.t.k === 'vector')) { base = t.parent; idx = t.key; }
      else this.err('Pointer arithmetic is only valid inside an array');
    }
    const ni = idx + n;
    if (ni < 0 || ni > base.v.length) this.err(`Pointer out of array bounds (index ${ni}, size ${base.v.length})`);
    return { target: base.v[ni] ?? null, base, idx: ni };
  }

  ptrEq(a: any, b: any): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    if (a.garbage || b.garbage) return false;
    if (a.target && b.target) return a.target === b.target;
    return a.base === b.base && a.idx === b.idx;
  }

  deref(rv: RV, src?: string): Cell {
    const what = src ? `'${src}'` : '';
    if (rv.t.k === 'nullptr' || rv.v === null) this.err(`Segmentation fault: dereferencing ${what} which is nullptr`);
    if (rv.t.k !== 'ptr') this.err(`Cannot use * or -> on ${what}: not a pointer (${typeName(rv.t)})` + (rv.t.k === 'struct' ? " — use '.'" : ''));
    const p = rv.v;
    if (p.garbage) this.err(`Segmentation fault: pointer ${what} is uninitialized (garbage address)`);
    if (!p.target) this.err(`Out of bounds access through ${what}`);
    const r: Cell = p.target.root;
    if (!r.alive) {
      if (r.heap) this.err(`Use-after-free: ${what} points to deleted memory (dangling pointer)`);
      this.err(`${what} points to a local variable that is out of scope`);
    }
    return p.target;
  }

  truthy(rv: RV): boolean {
    switch (rv.t.k) {
      case 'prim':
        if (rv.t.name === 'void') this.err('void value used as a condition');
        return rv.v !== 0;
      case 'ptr': return rv.v !== null;
      case 'nullptr': return false;
      case 'istream': return !this.cinFail;
      case 'string': this.err('string cannot be used as a condition');
      default: this.err(`${typeName(rv.t)} cannot be used as a condition`);
    }
  }

  toNum(rv: RV, what = 'value'): number {
    if (rv.t.k === 'prim' && rv.t.name !== 'void') return rv.v;
    this.err(`${what} must be a number, got ${typeName(rv.t)}`);
  }
  toInt(rv: RV, what = 'value'): number { return Math.trunc(this.toNum(rv, what)); }

  cond(e: Expr): boolean {
    this.inCond++;
    try { return this.truthy(this.ev(e)); } finally { this.inCond--; }
  }

  // =================== lookup ===================
  curScope(): Map<string, Cell> {
    const f = this.frame!;
    return f.scopes[f.scopes.length - 1].map;
  }

  lookup(name: string, scope?: string): Cell | null {
    if (scope && scope !== 'std') {
      return this.statics.get(`${scope}::${name}`) ?? (scope === 'string' ? this.hidden.get(name) ?? null : null);
    }
    const fr = this.frame;
    if (fr && !scope) {
      for (let i = fr.scopes.length - 1; i >= 0; i--) {
        const c = fr.scopes[i].map.get(name);
        if (c) return c;
      }
      if (fr.thisCell) {
        const tc = fr.thisCell;
        if (Object.prototype.hasOwnProperty.call(tc.v, name)) return tc.v[name];
      }
      const cls = fr.thisCell ? fr.thisCell.t.name : fr.fn.cls;
      if (cls) {
        const st = this.statics.get(`${cls}::${name}`);
        if (st) return st;
      }
    }
    return this.globals.get(name) ?? this.hidden.get(name) ?? null;
  }

  // =================== expressions ===================
  isLvalExpr(e: Expr): boolean {
    return e.t === 'id' || e.t === 'index' || e.t === 'member' || e.t === 'assign' || e.t === 'pre' || (e.t === 'un' && e.op === '*');
  }

  evalLorTemp(e: Expr): Cell {
    if (this.isLvalExpr(e)) return this.evalL(e);
    if (e.t === 'call') {
      const r = this.callExpr(e);
      if (!r || r.t.k === 'prim' && r.t.name === 'void') this.err('Function returns void');
      return r.cell && !r.cell.temp && r.t.k === 'struct' ? r.cell : r.cell && r.cell.t.k !== 'array' && (r.t.k === 'struct' || r.t.k === 'vector') ? r.cell : this.tempFrom(r);
    }
    return this.tempFrom(this.ev(e));
  }

  evalL(e: Expr): Cell {
    switch (e.t) {
      case 'id': {
        const c = this.lookup(e.name, e.scope);
        if (!c) this.undefinedName(e);
        return c.t.k === 'ref' ? c.v : c;
      }
      case 'un':
        if (e.op === '*') return this.deref(this.ev(e.e), e.e.s);
        break;
      case 'index': return this.indexL(e);
      case 'member': return this.memberL(e);
      case 'assign': return this.assign(e);
      case 'pre': {
        const c = this.evalL(e.e);
        this.incdec(c, e.op, e.e.s);
        return c;
      }
      case 'call': {
        const r = this.callExpr(e);
        if (r && r.cell) return r.cell;
        break;
      }
      case 'tern':
        return this.truthy(this.ev(e.c)) ? this.evalL(e.a) : this.evalL(e.b);
      case 'comma':
        this.ev(e.l);
        return this.evalL(e.r);
    }
    this.err(`'${e.s ?? ''}' is not an lvalue`);
  }

  undefinedName(e: Expr): never {
    if (this.prog.funcs.has(e.name)) this.err(`'${e.name}' is a function — missing ()?`);
    if (e.scope) this.err(`'${e.scope}::${e.name}' is not declared`);
    this.err(`'${e.name}' was not declared in this scope`);
  }

  charProxy(s: Cell, i: number): Cell {
    const self = this;
    const c: Cell = {
      id: this.nextId++, t: CHAR, v: 0, init: true, addr: 0, heap: s.heap, alive: true, root: s.root, born: this.snaps.length,
      proxy: {
        get() { self.checkAlive(s); return i < s.v.length ? s.v.charCodeAt(i) : 0; },
        set(v: number) { self.checkAlive(s); const str: string = s.v; s.v = str.slice(0, i) + String.fromCharCode(v < 0 ? v + 256 : v) + str.slice(i + 1); },
      },
    };
    return c;
  }

  indexL(e: Expr): Cell {
    const a = e.a;
    let base: Cell | null = null;
    if (this.isLvalExpr(a)) base = this.evalL(a);
    const i = this.toInt(this.ev(e.i), 'index');
    if (base) {
      if (base.t.k === 'array' || base.t.k === 'vector') {
        this.checkAlive(base);
        const n = base.v.length;
        if (i < 0 || i >= n) {
          const kind = base.t.k === 'vector' ? 'vector' : 'array';
          this.err(`Out of bounds: ${kind} '${a.s}' index ${i}, size ${n}` + (n ? ` (valid 0..${n - 1})` : ' (empty)'));
        }
        return base.v[i];
      }
      if (base.t.k === 'string') {
        this.checkAlive(base);
        if (i < 0 || i > base.v.length) this.err(`Out of bounds: string '${a.s}' index ${i}, length ${base.v.length}`);
        return this.charProxy(base, i);
      }
      if (base.t.k === 'struct') this.err(`Cannot use [] on ${base.t.name}`);
      return this.ptrIndex(this.read(base), i, e);
    }
    const rv = this.ev(a);
    if (rv.t.k === 'string') { const tmp = this.tempFrom(rv); return this.charProxy(tmp, i); }
    return this.ptrIndex(rv, i, e);
  }

  ptrIndex(rv: RV, i: number, e: Expr): Cell {
    if (rv.t.k !== 'ptr') this.err(`Cannot use [] on '${e.a.s}' (${typeName(rv.t)})`);
    if (rv.v && !rv.v.garbage && rv.v !== null) {
      const p = rv.v;
      const base = p.base ?? (p.target && p.target.parent && (p.target.parent.t.k === 'array' || p.target.parent.t.k === 'vector') ? p.target.parent : null);
      const idx = p.base ? p.idx : base ? p.target.key : 0;
      if (base) {
        const ni = idx + i;
        if (ni < 0 || ni >= base.v.length) this.err(`Out of bounds through '${e.a.s}': index ${ni}, size ${base.v.length}`);
        if (!base.root.alive) this.deref(rv, e.a.s);
        return base.v[ni];
      }
      if (i !== 0) this.err(`'${e.a.s}[${i}]': pointer does not point into an array`);
    }
    return this.deref(rv, e.a.s);
  }

  memberL(e: Expr): Cell {
    let obj: Cell;
    if (e.arrow) {
      const p = this.ev(e.e);
      if (p.t.k !== 'ptr' && p.t.k !== 'nullptr') this.err(`'${e.e.s}' is not a pointer — use '.' instead of '->'`);
      obj = this.deref(p, e.e.s);
    } else {
      obj = this.evalLorTemp(e.e);
      if (obj.t.k === 'ref') obj = obj.v;
      if (obj.t.k === 'ptr') this.err(`'${e.e.s}' is a pointer — use '->' instead of '.'`);
    }
    if (obj.t.k !== 'struct') this.err(`Cannot access '.${e.name}' on ${typeName(obj.t)}`);
    this.checkAlive(obj);
    if (!Object.prototype.hasOwnProperty.call(obj.v, e.name)) {
      const st = this.statics.get(`${obj.t.name}::${e.name}`);
      if (st) return st;
      const sd = this.sd(obj.t.name);
      if (sd.methods.has(e.name)) this.err(`'${e.name}' is a method of ${obj.t.name} — call it with ()`);
      this.err(`${obj.t.name} has no member named '${e.name}'`);
    }
    const f: Cell = obj.v[e.name];
    return f.t.k === 'ref' ? f.v : f;
  }

  ev(e: Expr): RV {
    switch (e.t) {
      case 'num': return { t: e.isFloat ? DBL : Math.abs(e.v) > 2147483647 ? LL : INT, v: e.v };
      case 'char': return { t: CHAR, v: e.v };
      case 'str': return { t: STR, v: e.v, lit: true };
      case 'bool': return { t: BOOL, v: e.v };
      case 'null': return { t: NULLT, v: null };
      case 'this': {
        const fr = this.frame;
        if (!fr || !fr.thisCell) this.err("'this' is only available inside member functions");
        return { t: { k: 'ptr', to: fr.thisCell.t }, v: { target: fr.thisCell } };
      }
      case 'id': {
        const c = this.lookup(e.name, e.scope);
        if (!c) this.undefinedName(e);
        return this.read(c);
      }
      case 'assign': return this.read(this.assign(e));
      case 'bin': return this.binExpr(e);
      case 'un': return this.unExpr(e);
      case 'pre': {
        const c = this.evalL(e.e);
        this.incdec(c, e.op, e.e.s);
        return this.read(c);
      }
      case 'post': {
        const c = this.evalL(e.e);
        const old = this.read(c);
        const oldCopy: RV = { t: old.t, v: old.v };
        this.incdec(c, e.op, e.e.s);
        return oldCopy;
      }
      case 'tern': return this.truthy(this.ev(e.c)) ? this.ev(e.a) : this.ev(e.b);
      case 'call': return this.callExpr(e) ?? VOIDRV;
      case 'index': case 'member': return this.read(this.evalL(e));
      case 'new': return this.newExpr(e);
      case 'delete': this.deleteExpr(e); return VOIDRV;
      case 'sizeof': return { t: ULONG, v: this.sizeofExpr(e) };
      case 'cast': {
        const t = this.tsType(e.ts);
        const rv = this.ev(e.e);
        if (t.k === 'ref') return this.read(this.evalL(e.e));
        return { t, v: this.convert(rv, t, true) };
      }
      case 'construct': return this.constructTemp(e);
      case 'initlist': return { t: { k: 'initlist' }, v: e.items };
      case 'comma': this.ev(e.l); return this.ev(e.r);
    }
    this.err('Unsupported expression: ' + e.t);
  }

  sizeofExpr(e: Expr): number {
    if (e.ts) {
      const dims = (e.dims || []).map((d: Expr) => this.toInt(this.ev(d)));
      return this.sizeOf(this.tsType(e.ts, 0, dims));
    }
    const x = e.e;
    if (this.isLvalExpr(x) && !(x.t === 'assign' || x.t === 'pre')) {
      const c = this.evalL(x);
      return this.sizeOf(c.t);
    }
    if (x.t === 'str') return x.v.length + 1;
    const rv = this.ev(x);
    return this.sizeOf(rv.t);
  }

  unExpr(e: Expr): RV {
    if (e.op === '&') {
      const c = this.evalL(e.e);
      if (c.proxy) this.err('Taking the address of a string character is not supported');
      return { t: { k: 'ptr', to: c.t }, v: this.ptrTo(c) };
    }
    if (e.op === '*') return this.read(this.deref(this.ev(e.e), e.e.s));
    const v = this.ev(e.e);
    if (e.op === '!') return { t: BOOL, v: this.truthy(v) ? 0 : 1 };
    if (v.t.k !== 'prim') this.err(`Operator ${e.op} needs a number, '${e.e.s}' is ${typeName(v.t)}`);
    const rt = isFloatName(v.t.name) ? v.t : (v.t.name === 'long' || v.t.name === 'long long' ? v.t : INT);
    if (e.op === '-') return { t: rt, v: numConv(-v.v, rt.name) };
    if (e.op === '+') return { t: rt, v: v.v };
    if (e.op === '~') { if (isFloatName(v.t.name)) this.err('~ does not work on floating point'); return { t: rt, v: numConv(~v.v, rt.name) }; }
    this.err('Unsupported operator ' + e.op);
  }

  incdec(c: Cell, op: string, src: string) {
    const cur = this.read(c);
    const d = op === '++' ? 1 : -1;
    if (cur.t.k === 'ptr') this.store(c, { t: cur.t, v: this.ptrAdd(cur.v, d) });
    else if (cur.t.k === 'prim') {
      if (cur.t.name === 'bool' && d < 0) this.err('-- cannot be used on bool');
      this.store(c, { t: cur.t, v: cur.v + d });
    } else this.err(`${op} cannot be used on ${typeName(cur.t)}`);
    this.noteStore(src, c);
  }

  noteStore(src: string, cell: Cell) {
    const c = cell.t.k === 'ref' ? cell.v : cell;
    if (c.proxy) { this.event(`${src} = ${charDisp(c.proxy.get())}`); return; }
    if (c.t.k === 'ptr') {
      if (c.v === null) this.event(`${src} = nullptr`);
      else if (c.v && c.v.target) this.event(`${src} → ${this.label(c.v.target)}`);
      else this.event(`${src} = ${this.dispCell(c)}`);
    } else if (c.t.k === 'struct') this.event(`copy → ${src}`);
    else if (c.t.k === 'vector') this.event(`copy → ${src}`);
    else this.event(`${src} = ${this.dispCell(c)}`);
  }

  assign(e: Expr): Cell {
    if (e.op === '=') {
      const rv = e.r.t === 'initlist' ? { t: { k: 'initlist' }, v: e.r.items } : this.ev(e.r);
      const lc = this.evalL(e.l);
      this.store(lc, rv);
      this.noteStore(e.l.s, lc);
      return lc;
    }
    const rhs = this.ev(e.r);
    const lc = this.evalL(e.l);
    const op = e.op.slice(0, -1);
    const res = this.binop(op, this.read(lc), rhs);
    this.store(lc, res);
    this.noteStore(e.l.s, lc);
    return lc;
  }

  binExpr(e: Expr): RV {
    if (e.op === '&&') {
      if (!this.truthy(this.ev(e.l))) return { t: BOOL, v: 0 };
      return { t: BOOL, v: this.truthy(this.ev(e.r)) ? 1 : 0 };
    }
    if (e.op === '||') {
      if (this.truthy(this.ev(e.l))) return { t: BOOL, v: 1 };
      return { t: BOOL, v: this.truthy(this.ev(e.r)) ? 1 : 0 };
    }
    const l = this.ev(e.l);
    if (e.op === '<<' && l.t.k === 'ostream') { this.output(e.r); return l; }
    if (e.op === '>>' && l.t.k === 'istream') { this.inputTo(e.r); return l; }
    if (l.t.k === 'ostream' || l.t.k === 'istream') this.err(l.t.k === 'ostream' ? 'use << with cout' : 'use >> with cin');
    const r = this.ev(e.r);
    return this.binop(e.op, l, r);
  }

  binop(op: string, a: RV, b: RV): RV {
    const at = a.t, bt = b.t;
    const aP = at.k === 'ptr' || at.k === 'nullptr';
    const bP = bt.k === 'ptr' || bt.k === 'nullptr';
    const CMP = ['==', '!=', '<', '>', '<=', '>='];
    if (aP || bP) {
      if ((op === '+' || op === '-') && at.k === 'ptr' && bt.k === 'prim') return { t: at, v: this.ptrAdd(a.v, op === '+' ? b.v : -b.v) };
      if (op === '+' && bt.k === 'ptr' && at.k === 'prim') return { t: bt, v: this.ptrAdd(b.v, a.v) };
      if (op === '-' && at.k === 'ptr' && bt.k === 'ptr') {
        const pa = a.v, pb = b.v;
        if (!pa || !pb || pa.garbage || pb.garbage) this.err('Invalid pointer subtraction');
        const ba = pa.base ?? null, bb = pb.base ?? null;
        if (!ba || ba !== bb) this.err('Pointer subtraction requires pointers into the same array');
        return { t: LL, v: pa.idx - pb.idx };
      }
      if (CMP.includes(op)) {
        const norm = (x: RV) => (x.t.k === 'ptr' || x.t.k === 'nullptr' ? x.v : x.t.k === 'prim' && x.v === 0 ? null : this.err('Cannot compare a pointer with a non-zero number'));
        const av = norm(a), bv = norm(b);
        if (op === '==') return { t: BOOL, v: this.ptrEq(av, bv) ? 1 : 0 };
        if (op === '!=') return { t: BOOL, v: this.ptrEq(av, bv) ? 0 : 1 };
        const x = this.addrOf(av), y = this.addrOf(bv);
        const res = op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
        return { t: BOOL, v: res ? 1 : 0 };
      }
      this.err(`Operator ${op} is not allowed on pointers`);
    }
    if (at.k === 'string' || bt.k === 'string') {
      const toS = (x: RV): string => {
        if (x.t.k === 'string') return x.v;
        if (x.t.k === 'prim' && x.t.name === 'char') return String.fromCharCode(x.v < 0 ? x.v + 256 : x.v);
        this.err(`Cannot concatenate string with ${typeName(x.t)} — use to_string()`);
      };
      if (op === '+') {
        if (a.lit && b.lit) this.err('Cannot add two string literals');
        return { t: STR, v: toS(a) + toS(b) };
      }
      if (CMP.includes(op)) {
        if (at.k !== 'string' || bt.k !== 'string') this.err('Cannot compare string with non-string');
        const x: string = a.v, y: string = b.v;
        const res = op === '==' ? x === y : op === '!=' ? x !== y : op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
        return { t: BOOL, v: res ? 1 : 0 };
      }
      this.err(`Operator ${op} is not allowed on string`);
    }
    if (at.k !== 'prim' || bt.k !== 'prim') {
      const st = at.k === 'struct' || bt.k === 'struct';
      this.err(`Operator ${op} not supported between ${typeName(at)} and ${typeName(bt)}` + (st ? ' (operator overloading is not supported)' : ''));
    }
    if (at.name === 'void' || bt.name === 'void') this.err('void value used in an expression');
    const fl = isFloatName(at.name) || isFloatName(bt.name);
    const big = (n: string) => n === 'long' || n === 'long long' || n === 'unsigned long' || n === 'unsigned long long';
    const rt = fl ? DBL : big(at.name) || big(bt.name) ? LL : INT;
    const x = a.v, y = b.v;
    const num = (v: number): RV => ({ t: rt, v: numConv(v, rt.name) });
    switch (op) {
      case '+': return num(x + y);
      case '-': return num(x - y);
      case '*': return rt === INT ? { t: INT, v: Math.imul(x, y) } : num(x * y);
      case '/':
        if (!fl && y === 0) this.err('Division by zero');
        return num(fl ? x / y : Math.trunc(x / y));
      case '%':
        if (fl) this.err('% does not work on float/double — use fmod()');
        if (y === 0) this.err('Modulo by zero');
        return num(x % y);
      case '==': return { t: BOOL, v: x === y ? 1 : 0 };
      case '!=': return { t: BOOL, v: x !== y ? 1 : 0 };
      case '<': return { t: BOOL, v: x < y ? 1 : 0 };
      case '>': return { t: BOOL, v: x > y ? 1 : 0 };
      case '<=': return { t: BOOL, v: x <= y ? 1 : 0 };
      case '>=': return { t: BOOL, v: x >= y ? 1 : 0 };
    }
    if (fl) this.err(`Operator ${op} does not work on floating point`);
    switch (op) {
      case '&': return num(rt === INT ? x & y : Number(BigInt(x) & BigInt(y)));
      case '|': return num(rt === INT ? x | y : Number(BigInt(x) | BigInt(y)));
      case '^': return num(rt === INT ? x ^ y : Number(BigInt(x) ^ BigInt(y)));
      case '<<': return num(rt === INT ? x << y : x * Math.pow(2, y));
      case '>>': return num(rt === INT ? x >> y : Math.floor(x / Math.pow(2, y)));
    }
    this.err('Unsupported operator ' + op);
  }

  // =================== I/O ===================
  write(s: string) {
    if (this.width > 0 && s.length < this.width) s = ' '.repeat(this.width - s.length) + s;
    this.width = 0;
    this.out += s;
    this.printed += s;
    if (this.out.length > 200000) this.err('Output too large');
  }

  fmtOut(rv: RV): string {
    const t = rv.t;
    switch (t.k) {
      case 'string': return rv.v;
      case 'prim':
        if (t.name === 'void') this.err('Cannot print a void value');
        if (t.name === 'char' || t.name === 'unsigned char') return String.fromCharCode(rv.v < 0 ? rv.v + 256 : rv.v);
        if (t.name === 'bool') return this.boolalpha ? (rv.v ? 'true' : 'false') : rv.v ? '1' : '0';
        if (isFloatName(t.name)) return this.fixed ? rv.v.toFixed(this.precision) : fmtG(rv.v, this.precision);
        return String(rv.v);
      case 'nullptr': return '0';
      case 'ptr':
        if (rv.v === null) return '0';
        if (rv.v.garbage) return '0x7f3a9c2e10';
        return hex(this.addrOf(rv.v));
      case 'struct': this.err(`Cannot print a ${t.name} object with cout — print its fields`);
      case 'vector': this.err('Cannot print a vector with cout — use a loop');
    }
    this.err(`Cannot print ${typeName(t)}`);
  }

  output(e: Expr) {
    const rv = this.ev(e);
    if (rv.t.k === 'manip') {
      const m = rv.v;
      if (m.endl) this.write('\n');
      if (m.fixed) this.fixed = true;
      if (m.boolalpha) this.boolalpha = true;
      if (m.setw !== undefined) this.width = m.setw;
      if (m.prec !== undefined) this.precision = m.prec;
      return;
    }
    this.write(this.fmtOut(rv));
  }

  skipWs() {
    while (this.inPos < this.input.length && /\s/.test(this.input[this.inPos])) this.inPos++;
  }

  echo(tok: string) {
    let j = this.inPos;
    while (j < this.input.length && (this.input[j] === ' ' || this.input[j] === '\t' || this.input[j] === '\r')) j++;
    const endOfLine = j >= this.input.length || this.input[j] === '\n';
    const s = '\u0001' + tok + '\u0002' + (endOfLine ? '\n' : ' ');
    this.out += s;
  }

  noInput(src: string): never {
    throw new StopSig(`Waiting for input (cin >> ${src}) — stdin is empty. Add values to stdin and run again.`, 'input');
  }

  inputTo(e: Expr) {
    const c0 = this.evalL(e);
    const c = c0.t.k === 'ref' ? c0.v : c0;
    if (this.cinFail) {
      if (this.inCond) return;
      this.noInput(e.s);
    }
    this.skipWs();
    if (this.inPos >= this.input.length) {
      if (this.inCond) { this.cinFail = true; return; }
      this.noInput(e.s);
    }
    const t = c.t;
    let tok = '';
    if (t.k === 'string') {
      const m = /^\S+/.exec(this.input.slice(this.inPos))!;
      tok = m[0];
      this.inPos += tok.length;
      this.store(c, { t: STR, v: tok });
    } else if (t.k === 'prim' && (t.name === 'char' || t.name === 'unsigned char')) {
      tok = this.input[this.inPos++];
      this.store(c, { t: CHAR, v: tok.charCodeAt(0) });
    } else if (t.k === 'prim') {
      const rest = this.input.slice(this.inPos);
      const m = isFloatName(t.name) ? /^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/.exec(rest) : t.name === 'bool' ? /^[01]/.exec(rest) : /^[+-]?\d+/.exec(rest);
      if (!m) {
        this.cinFail = true;
        this.store(c, { t: INT, v: 0 });
        this.event(`cin failed on '${rest.split(/\s/)[0]}'`);
        if (!this.inCond) this.err(`Input '${rest.split(/\s/)[0]}' is not a valid ${t.name} for ${e.s}`);
        return;
      }
      tok = m[0];
      this.inPos += tok.length;
      this.store(c, { t: isFloatName(t.name) ? DBL : LL, v: isFloatName(t.name) ? parseFloat(tok) : parseInt(tok, 10) });
    } else this.err(`Cannot read ${typeName(t)} with cin`);
    this.echo(tok);
    this.event(`cin: ${e.s} = ${this.dispCell(c)}`);
  }

  getline(sc: Cell, src: string) {
    if (this.inPos >= this.input.length) {
      if (this.inCond) { this.cinFail = true; return; }
      this.noInput(src);
    }
    let j = this.input.indexOf('\n', this.inPos);
    if (j < 0) j = this.input.length;
    const line = this.input.slice(this.inPos, j).replace(/\r$/, '');
    this.inPos = j + 1;
    this.store(sc, { t: STR, v: line });
    this.out += '\u0001' + line + '\u0002\n';
    this.event(`getline: ${JSON.stringify(line)}`);
  }

  // =================== calls ===================
  guessT(a: any): Type | null {
    if (!a) return null;
    if (a.pre) return a.pre.t;
    switch (a.t) {
      case 'num': return a.isFloat ? DBL : INT;
      case 'str': return STR;
      case 'char': return CHAR;
      case 'bool': return BOOL;
      case 'null': return NULLT;
      case 'id': {
        const c = this.lookup(a.name, a.scope);
        if (!c) return null;
        const t = c.t.k === 'ref' ? c.t.to : c.t;
        return t.k === 'array' ? { k: 'ptr', to: t.of } : t;
      }
      case 'un':
        if (a.op === '&') { const g = this.guessT(a.e); return { k: 'ptr', to: g ?? VOID }; }
        if (a.op === '-' || a.op === '+') return this.guessT(a.e);
        return null;
      case 'new': return { k: 'ptr', to: VOID };
      case 'construct': return this.tsType(a.ts);
    }
    return null;
  }

  scoreParam(pt: Type, at: Type | null): number {
    if (!at) return 0;
    if (pt.k === 'ref') pt = pt.to;
    if (at.k === 'ref') at = at.to;
    if (at.k === 'nullptr') return pt.k === 'ptr' ? 2 : -5;
    if (pt.k !== at.k) return -5;
    if (typeName(pt) === typeName(at)) return 3;
    if (pt.k === 'prim') {
      if (isFloatName(pt.name) === isFloatName(at.name)) return 2;
      return 1;
    }
    if (pt.k === 'ptr' && (typeName(at.to) === 'void' || typeName(pt.to) === 'void')) return 1;
    return -2;
  }

  pickOverload(cands: FuncDef[], args: any[], name: string): FuncDef {
    const n = args.length;
    const withBody = cands.filter((f) => f.body);
    if (!withBody.length) this.err(`Function ${name} is declared but not defined`);
    const ok = withBody.filter((f) => n <= f.params.length && n >= f.params.filter((p) => !p.def).length);
    if (!ok.length) {
      const counts = Array.from(new Set(withBody.map((f) => f.params.length))).join(' or ');
      this.err(`No overload of ${name} takes ${n} arguments (available: ${counts})`);
    }
    if (ok.length === 1) return ok[0];
    let best = ok[0];
    let bestScore = -Infinity;
    for (const f of ok) {
      let s = 0;
      for (let i = 0; i < n; i++) s += this.scoreParam(this.paramType(f.params[i]), this.guessT(args[i]));
      if (f.params.length === n) s += 0.5;
      if (s > bestScore) { bestScore = s; best = f; }
    }
    return best;
  }

  paramType(p: { ts: TypeSpec; dims: (Expr | null)[] }): Type {
    if (p.dims.length) {
      const inner = p.dims.slice(1).map((d) => (d == null ? 0 : this.toInt(this.ev(d))));
      const el = this.tsType({ ...p.ts, ref: false }, 0, inner);
      return { k: 'ptr', to: el };
    }
    return this.tsType(p.ts);
  }

  callFunction(fn: FuncDef, args: any[], thisCell: Cell | null): RV | undefined {
    if (!fn.body) this.err(`Function ${fn.name} has no body`);
    const vals: any[] = [];
    const ptypes: Type[] = fn.params.map((p) => this.paramType(p));
    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i];
      const pt = ptypes[i];
      const a = i < args.length ? args[i] : p.def;
      if (a === undefined) this.err(`Too few arguments to ${fn.name}`);
      if (pt.k === 'ref') {
        if (a.pre) vals.push(a.pre.cell ?? this.tempFrom(a.pre));
        else vals.push(this.evalLorTemp(a));
      } else {
        vals.push(a.pre ? a.pre : this.ev(a));
      }
    }
    if (args.length > fn.params.length) this.err(`Too many arguments to ${fn.name} (${args.length} given, ${fn.params.length} expected)`);
    if (this.frames.length >= 200) this.err('Stack overflow: recursion deeper than 200 calls');
    const name = fn.cls ? `${fn.cls}::${fn.isDtor ? '~' : ''}${fn.name}` : fn.name;
    const frame: Frame = { id: this.nextFrameId++, name, fn, scopes: [{ map: new Map(), sp: this.sp }], thisCell, line: fn.line, spSave: this.sp };
    this.frames.push(frame);
    const parts: string[] = [];
    fn.params.forEach((p, i) => {
      const pt = ptypes[i];
      const cell = this.allocStack(pt);
      cell.name = p.name || `arg${i}`;
      if (pt.k === 'ref') { cell.v = vals[i]; cell.init = true; }
      else this.store(cell, vals[i]);
      if (p.name) frame.scopes[0].map.set(p.name, cell);
      parts.push(`${cell.name} = ${this.dispCell(cell)}`);
    });
    const plist = parts.join(', ');
    let note: string;
    if (fn.isCtor) note = `${fn.cls}(${plist})`;
    else if (fn.isDtor) note = `${name}()`;
    else if (fn.name === 'main' && !fn.cls) note = 'main()';
    else note = `${name}(${plist})`;
    this.curLine = fn.line;
    this.snap('call', fn.line, note);
    let ret: RV | undefined;
    try {
      if (fn.isCtor) this.runCtorInits(fn, thisCell!);
      for (const s of fn.body.body) this.execStmt(s);
      frame.line = fn.endLine;
      this.curLine = fn.endLine;
      if (fn.name === 'main' && !fn.cls) ret = { t: INT, v: 0 };
      else this.snap('return', fn.endLine, fn.isCtor ? `end ${name}` : `end ${name}`);
    } catch (e) {
      if (e instanceof ReturnSig) ret = e.v;
      else throw e;
    }
    this.popFrame();
    const rt = this.tsType(fn.ret);
    if (rt.k === 'prim' && rt.name === 'void') return undefined;
    if (fn.isCtor || fn.isDtor) return undefined;
    if (!ret) {
      this.event(`${name}: missing return`);
      return { t: rt.k === 'ref' ? rt.to : rt, v: 0 };
    }
    if (rt.k === 'ref') return ret;
    if (rt.k === 'struct' || rt.k === 'vector') {
      if (ret.t.k === 'initlist') { const tmp = this.tempCell(rt); this.initFromList(tmp, ret.v); return this.read(tmp); }
      return ret;
    }
    return { t: rt, v: this.convert(ret, rt) };
  }

  runCtorInits(fn: FuncDef, cell: Cell) {
    const sd = this.sd(cell.t.name);
    const parts: string[] = [];
    for (const f of sd.fields) {
      if (f.isStatic) continue;
      const fc: Cell = cell.v[f.d.name];
      const il = fn.initList?.find((x) => x.name === f.d.name);
      if (il) {
        if (fc.t.k === 'ref') { fc.v = this.evalLorTemp(il.args[0]); fc.init = true; }
        else if (fc.t.k === 'struct' || fc.t.k === 'vector' || (fc.t.k === 'string' && il.args.length !== 1)) this.constructWith(fc, il.args, !!il.brace);
        else if (fc.t.k === 'array') this.initFromList(fc, il.args);
        else if (il.args.length) this.store(fc, this.ev(il.args[0]));
        else this.zeroFill(fc);
        parts.push(`${f.d.name} = ${this.dispCell(fc)}`);
      } else this.initField(fc, f, false);
    }
    if (fn.initList?.length) {
      for (const il of fn.initList) if (!sd.fields.some((f) => f.d.name === il.name)) this.err(`'${il.name}' is not a member of ${sd.name}`);
      this.event(`init: ${parts.join(', ')}`);
    }
  }

  initField(fc: Cell, f: { ts: TypeSpec; d: Declarator }, zero: boolean) {
    const d = f.d;
    if (fc.t.k === 'ref') return;
    if (d.braceInit) this.initFromList(fc, d.braceInit);
    else if (d.ctorArgs) this.constructWith(fc, d.ctorArgs, false);
    else if (d.init) {
      if (fc.t.k === 'struct') this.constructWith(fc, [d.init], false);
      else this.store(fc, this.ev(d.init));
    } else if (zero) this.zeroFill(fc);
    else this.defaultInit(fc, false);
  }

  defaultInit(c: Cell, zero: boolean) {
    if (c.t.k === 'struct') this.constructWith(c, null, false, zero);
    else if (c.t.k === 'array' && (c.t.of.k === 'struct' || c.t.of.k === 'array')) c.v.forEach((e: Cell) => this.defaultInit(e, zero));
    else if (zero) this.zeroFill(c);
  }

  defaultInitFields(c: Cell, zero: boolean) {
    const sd = this.sd(c.t.name);
    for (const f of sd.fields) {
      if (f.isStatic) continue;
      this.initField(c.v[f.d.name], f, zero);
    }
  }

  zeroFill(c: Cell) {
    switch (c.t.k) {
      case 'prim': c.v = 0; c.init = true; break;
      case 'ptr': c.v = null; c.init = true; break;
      case 'string': c.v = ''; c.init = true; break;
      case 'struct': {
        const sd = this.sd(c.t.name);
        if (sd.ctors.length) this.constructWith(c, null, false);
        else this.defaultInitFields(c, true);
        break;
      }
      case 'array': c.v.forEach((e: Cell) => this.zeroFill(e)); break;
    }
  }

  constructWith(c: Cell, args: any[] | null, brace: boolean, valueInit = false) {
    const t = c.t;
    if (t.k === 'struct') {
      const sd = this.sd(t.name);
      if (sd.ctors.length === 0 || !sd.ctors.some((x) => x.body)) {
        if (args && args.length) {
          if (args.length === 1) {
            const a = args[0];
            const rv: RV = a.pre ? a.pre : this.ev(a);
            if (rv.t.k === 'struct' && rv.t.name === t.name) { this.store(c, rv); return; }
            if (rv.t.k === 'initlist') { this.initFromList(c, rv.v); return; }
            const fs = this.layout(t.name).fields;
            this.initFromList(c, [{ pre: rv }, ...fs.slice(1).map(() => undefined)].slice(0, 1));
            return;
          }
          this.initFromList(c, args);
          return;
        }
        this.defaultInitFields(c, valueInit);
        return;
      }
      // copy construction from same type when no matching user ctor
      if (args && args.length === 1) {
        const g = this.guessT(args[0]);
        if (g && g.k === 'struct' && g.name === t.name) {
          const cands = sd.ctors.filter((f) => f.params.length === 1 && this.scoreParam(this.paramType(f.params[0]), g) > 0);
          if (!cands.length) {
            const rv: RV = args[0].pre ? args[0].pre : this.ev(args[0]);
            this.copyCell(c, rv.cell!);
            this.event(`copy ${t.name}`);
            return;
          }
        }
      }
      if (!args || !args.length) {
        if (!sd.ctors.some((f) => f.body && f.params.every((p) => p.def))) this.err(`${t.name} has no default constructor`);
      }
      const fn = this.pickOverload(sd.ctors, args ?? [], `${t.name}::${t.name}`);
      this.callFunction(fn, args ?? [], c);
      return;
    }
    if (t.k === 'vector') {
      if (brace) { this.initFromList(c, args ?? []); return; }
      if (!args || !args.length) return;
      const a0 = args[0].pre ? args[0].pre : this.ev(args[0]);
      if (a0.t.k === 'vector') { this.store(c, a0); return; }
      const n = this.toInt(a0, 'vector size');
      if (n < 0 || n > 20000) this.err('Invalid vector size');
      const val = args[1] ? (args[1].pre ? args[1].pre : this.ev(args[1])) : null;
      for (let i = 0; i < n; i++) {
        const e = this.vecElem(c, i);
        if (val) this.store(e, val); else this.zeroFill(e);
        c.v.push(e);
      }
      return;
    }
    if (t.k === 'string') {
      if (!args || !args.length) { c.v = ''; return; }
      if (args.length === 2) {
        const n = this.toInt(args[0].pre ?? this.ev(args[0]));
        const ch = this.ev(args[1]);
        c.v = String.fromCharCode(ch.v).repeat(Math.max(0, n));
        return;
      }
      this.store(c, args[0].pre ?? this.ev(args[0]));
      return;
    }
    if (t.k === 'array') { this.initFromList(c, args ?? []); return; }
    if (args && args.length) this.store(c, args[0].pre ?? this.ev(args[0]));
    else if (valueInit || brace) this.zeroFill(c);
  }

  initElem(c: Cell, item: any) {
    if (item === undefined) { this.zeroFill(c); return; }
    if (!item.pre && item.t === 'initlist') { this.initFromList(c, item.items); return; }
    const rv: RV = item.pre ? item.pre : this.ev(item);
    if (c.t.k === 'struct' && !(rv.t.k === 'struct' && rv.t.name === c.t.name)) {
      const sd = this.sd(c.t.name);
      if (sd.ctors.length) { this.constructWith(c, [{ pre: rv }], false); return; }
    }
    this.store(c, rv);
  }

  initFromList(c: Cell, items: any[]) {
    const t = c.t;
    switch (t.k) {
      case 'array': {
        if (items.length > t.n) this.err(`Too many initializers (${items.length}) for array of size ${t.n}`);
        if (t.of.k === 'prim' && t.of.name === 'char' && items.length === 1 && items[0].t === 'str') { this.store(c, this.ev(items[0])); return; }
        for (let i = 0; i < t.n; i++) this.initElem(c.v[i], items[i]);
        return;
      }
      case 'struct': {
        const sd = this.sd(t.name);
        if (sd.ctors.some((x) => x.body)) { this.constructWith(c, items, true); return; }
        const fs = this.layout(t.name).fields;
        const fdefs = sd.fields.filter((f) => !f.isStatic);
        if (items.length > fs.length) this.err(`Too many initializers (${items.length}) for ${t.name} (${fs.length} fields)`);
        fs.forEach((f, i) => {
          const fc = c.v[f.name];
          if (i < items.length) this.initElem(fc, items[i]);
          else this.initField(fc, fdefs[i], true);
        });
        return;
      }
      case 'vector': {
        c.v.forEach((e: Cell) => this.killCell(e));
        c.v = [];
        c.cap = 0;
        items.forEach((it, i) => {
          const e = this.vecElem(c, i);
          this.initElem(e, it);
          c.v.push(e);
        });
        return;
      }
      default:
        if (items.length > 1) this.err('Too many initializers in {}');
        if (items.length) this.initElem(c, items[0]);
        else this.zeroFill(c);
    }
  }

  constructTemp(e: Expr): RV {
    const t = this.tsType(e.ts);
    if (t.k === 'prim') {
      if (!e.args.length) return { t, v: 0 };
      return { t, v: this.convert(this.ev(e.args[0]), t, true) };
    }
    const c = this.tempCell(t);
    this.constructWith(c, e.args, e.brace, true);
    return this.read(c);
  }

  callExpr(e: Expr): RV | undefined {
    const f = e.f;
    if (f.t === 'member') {
      let obj: Cell;
      if (f.arrow) {
        const p = this.ev(f.e);
        if (p.t.k !== 'ptr' && p.t.k !== 'nullptr') this.err(`'${f.e.s}' is not a pointer — use '.' instead of '->'`);
        obj = this.deref(p, f.e.s);
      } else {
        obj = this.evalLorTemp(f.e);
        if (obj.t.k === 'ptr') this.err(`'${f.e.s}' is a pointer — use '->' instead of '.'`);
      }
      if (obj.t.k === 'ref') obj = obj.v;
      return this.callMethod(obj, f.name, e.args, e);
    }
    if (f.t === 'id') {
      const name = f.name;
      if (f.scope && f.scope !== 'std' && this.prog.structs.has(f.scope)) {
        const ms = this.sd(f.scope).methods.get(name);
        if (!ms) this.err(`${f.scope}::${name} does not exist`);
        return this.callFunction(this.pickOverload(ms, e.args, `${f.scope}::${name}`), e.args, this.frame?.thisCell ?? null);
      }
      const fr = this.frame;
      if (!f.scope && fr && fr.thisCell) {
        const sd = this.prog.structs.get(fr.thisCell.t.name);
        const ms = sd?.methods.get(name);
        if (ms) return this.callFunction(this.pickOverload(ms, e.args, `${sd!.name}::${name}`), e.args, fr.thisCell);
      }
      const local = !f.scope ? this.lookup(name) : null;
      if (local && local.t.k !== 'ostream') this.err(`'${name}' is a variable, not a function`);
      const fs = this.prog.funcs.get(name);
      if (fs && fs.some((x) => x.body)) return this.callFunction(this.pickOverload(fs, e.args, name), e.args, null);
      const b = this.builtin(name, e.args, e);
      if (b !== NOT_BUILTIN) return b as RV | undefined;
      if (fs) this.err(`Function ${name} is declared but not defined`);
      this.err(`'${name}' was not declared in this scope`);
    }
    this.err('Unsupported call');
  }

  callMethod(obj: Cell, name: string, args: Expr[], e: Expr): RV | undefined {
    switch (obj.t.k) {
      case 'string': return this.stringMethod(obj, name, args, e);
      case 'vector': return this.vectorMethod(obj, name, args, e);
      case 'istream':
        if (['ignore', 'clear', 'sync'].includes(name)) {
          if (name === 'clear') this.cinFail = false;
          if (name === 'ignore') {
            if (args.length) {
              const nl = this.input.indexOf('\n', this.inPos);
              this.inPos = nl < 0 ? this.input.length : nl + 1;
            } else if (this.inPos < this.input.length) this.inPos++;
          }
          return VOIDRV;
        }
        if (name === 'fail') return { t: BOOL, v: this.cinFail ? 1 : 0 };
        if (name === 'eof') return { t: BOOL, v: this.inPos >= this.input.length ? 1 : 0 };
        if (name === 'good') return { t: BOOL, v: this.cinFail ? 0 : 1 };
        if (name === 'get') {
          if (this.inPos >= this.input.length) this.noInput('cin.get()');
          const ch = this.input[this.inPos++];
          if (args.length) { const c = this.evalL(args[0]); this.store(c, { t: CHAR, v: ch.charCodeAt(0) }); return { t: ISTREAM, v: null }; }
          return { t: INT, v: ch.charCodeAt(0) };
        }
        break;
      case 'ostream':
        if (name === 'flush') return VOIDRV;
        if (name === 'precision') { if (args.length) this.precision = this.toInt(this.ev(args[0])); return { t: INT, v: this.precision }; }
        break;
      case 'struct': {
        this.checkAlive(obj);
        const sd = this.sd(obj.t.name);
        const ms = sd.methods.get(name);
        if (!ms) {
          if (Object.prototype.hasOwnProperty.call(obj.v, name)) this.err(`'${name}' is a field of ${sd.name}, not a method`);
          this.err(`${sd.name} has no method named '${name}'`);
        }
        return this.callFunction(this.pickOverload(ms, args, `${sd.name}::${name}`), args, obj);
      }
    }
    this.err(`Cannot call .${name}() on ${typeName(obj.t)}`);
  }

  stringMethod(s: Cell, name: string, args: Expr[], e: Expr): RV | undefined {
    this.checkAlive(s);
    const str: string = s.v;
    const arg = (i: number) => this.ev(args[i]);
    const argS = (i: number) => { const r = arg(i); return r.t.k === 'string' ? r.v : r.t.k === 'prim' && r.t.name === 'char' ? String.fromCharCode(r.v) : this.err('Argument must be a string'); };
    const set = (v: string, what: string) => { s.v = v; s.init = true; this.event(`${e.f.e.s}.${name}(): ${what} ← ${JSON.stringify(v)}`); };
    switch (name) {
      case 'size': case 'length': return { t: ULONG, v: str.length };
      case 'empty': return { t: BOOL, v: str.length === 0 ? 1 : 0 };
      case 'substr': {
        const pos = args.length ? this.toInt(arg(0)) : 0;
        if (pos > str.length) this.err(`substr: position ${pos} > length ${str.length} (out_of_range)`);
        const len = args.length > 1 ? this.toInt(arg(1)) : str.length;
        return { t: STR, v: str.substr(pos, len < 0 ? str.length : len) };
      }
      case 'find': {
        const x = argS(0);
        const from = args.length > 1 ? this.toInt(arg(1)) : 0;
        return { t: LL, v: str.indexOf(x, from) };
      }
      case 'at': case 'operator[]': {
        const i = this.toInt(arg(0));
        if (i < 0 || i >= str.length) this.err(`at(${i}) out of range (length ${str.length})`);
        const p = this.charProxy(s, i);
        return { t: CHAR, v: p.proxy!.get(), cell: p };
      }
      case 'back': if (!str.length) this.err('back() on empty string'); { const p = this.charProxy(s, str.length - 1); return { t: CHAR, v: p.proxy!.get(), cell: p }; }
      case 'front': if (!str.length) this.err('front() on empty string'); { const p = this.charProxy(s, 0); return { t: CHAR, v: p.proxy!.get(), cell: p }; }
      case 'push_back': set(str + argS(0), 'push_back'); return VOIDRV;
      case 'pop_back': if (!str.length) this.err('pop_back() on empty string'); set(str.slice(0, -1), 'pop_back'); return VOIDRV;
      case 'append': set(str + argS(0), 'append'); return { t: STR, v: s.v, cell: s };
      case 'clear': set('', 'clear'); return VOIDRV;
      case 'insert': { const pos = this.toInt(arg(0)); set(str.slice(0, pos) + argS(1) + str.slice(pos), 'insert'); return VOIDRV; }
      case 'erase': {
        const pos = args.length ? this.toInt(arg(0)) : 0;
        const len = args.length > 1 ? this.toInt(arg(1)) : str.length;
        set(str.slice(0, pos) + str.slice(pos + len), 'erase');
        return VOIDRV;
      }
      case 'c_str': case 'data': return { t: STR, v: str };
      case 'compare': { const o = argS(0); return { t: INT, v: str < o ? -1 : str > o ? 1 : 0 }; }
    }
    this.err(`string::${name}() is not supported`);
  }

  vectorMethod(vec: Cell, name: string, args: Expr[], e: Expr): RV | undefined {
    this.checkAlive(vec);
    const els: Cell[] = vec.v;
    const src = e.f.e.s;
    const elRV = (c: Cell): RV => ({ ...this.read(c), cell: c });
    switch (name) {
      case 'size': return { t: ULONG, v: els.length };
      case 'empty': return { t: BOOL, v: els.length === 0 ? 1 : 0 };
      case 'push_back': case 'emplace_back': {
        if (name === 'emplace_back' && args.length !== 1) {
          const c = this.vecElem(vec, els.length);
          this.constructWith(c, args, false);
          els.push(c);
        } else {
          const rv = this.ev(args[0]);
          const c = this.vecElem(vec, els.length);
          this.initElem(c, { pre: rv });
          els.push(c);
        }
        this.event(`${src}.${name}() size=${els.length}`);
        return VOIDRV;
      }
      case 'pop_back': {
        if (!els.length) this.err(`pop_back() on empty vector '${src}'`);
        this.killCell(els.pop()!);
        this.event(`${src}.pop_back() size=${els.length}`);
        return VOIDRV;
      }
      case 'clear':
        els.forEach((c) => this.killCell(c));
        vec.v = [];
        this.event(`${src}.clear()`);
        return VOIDRV;
      case 'back': if (!els.length) this.err(`back() on empty vector '${src}'`); return elRV(els[els.length - 1]);
      case 'front': if (!els.length) this.err(`front() on empty vector '${src}'`); return elRV(els[0]);
      case 'at': {
        const i = this.toInt(this.ev(args[0]));
        if (i < 0 || i >= els.length) this.err(`${src}.at(${i}) out of range (size ${els.length})`);
        return elRV(els[i]);
      }
      case 'resize': {
        const n = this.toInt(this.ev(args[0]));
        const val = args[1] ? this.ev(args[1]) : null;
        while (els.length > n) this.killCell(els.pop()!);
        while (els.length < n) { const c = this.vecElem(vec, els.length); if (val) this.store(c, val); else this.zeroFill(c); els.push(c); }
        this.event(`${src}.resize(${n})`);
        return VOIDRV;
      }
      case 'begin': case 'end': case 'insert': case 'erase': case 'rbegin': case 'rend':
        this.err(`${name}() needs iterators, which are not supported — use indexes`);
    }
    this.err(`vector::${name}() is not supported`);
  }

  builtin(name: string, args: Expr[], e: Expr): RV | undefined | typeof NOT_BUILTIN {
    const num = (i: number) => this.toNum(this.ev(args[i]));
    const d = (v: number): RV => ({ t: DBL, v });
    switch (name) {
      case 'swap': {
        const a = this.evalL(args[0]);
        const b = this.evalL(args[1]);
        const tmp = this.tempCell(a.t);
        this.copyCell(tmp, a);
        this.copyCell(a, b);
        this.copyCell(b, tmp);
        this.event(`swap(${args[0].s}, ${args[1].s})`);
        return VOIDRV;
      }
      case 'max': case 'min': {
        const a = this.ev(args[0]), b = this.ev(args[1]);
        const x = this.toNum(a), y = this.toNum(b);
        const pickA = name === 'max' ? x >= y : x <= y;
        return pickA ? { t: a.t, v: x } : { t: b.t, v: y };
      }
      case 'abs': case 'labs': case 'llabs': { const r = this.ev(args[0]); return { t: r.t, v: Math.abs(this.toNum(r)) }; }
      case 'fabs': return d(Math.abs(num(0)));
      case 'sqrt': { const x = num(0); if (x < 0) this.event('sqrt of negative = nan'); return d(Math.sqrt(x)); }
      case 'pow': return d(Math.pow(num(0), num(1)));
      case 'floor': return d(Math.floor(num(0)));
      case 'ceil': return d(Math.ceil(num(0)));
      case 'round': return d(Math.round(num(0)));
      case 'trunc': return d(Math.trunc(num(0)));
      case 'log': return d(Math.log(num(0)));
      case 'log10': return d(Math.log10(num(0)));
      case 'log2': return d(Math.log2(num(0)));
      case 'exp': return d(Math.exp(num(0)));
      case 'sin': return d(Math.sin(num(0)));
      case 'cos': return d(Math.cos(num(0)));
      case 'tan': return d(Math.tan(num(0)));
      case 'fmod': return d(num(0) % num(1));
      case 'rand': {
        this.randSeed = (Math.imul(this.randSeed, 1103515245) + 12345) & 0x7fffffff;
        return { t: INT, v: this.randSeed };
      }
      case 'srand': this.randSeed = num(0) | 0 || 1; return VOIDRV;
      case 'time': return { t: LL, v: 1700000000 };
      case 'getline': {
        const sc = this.evalL(args[1]);
        this.getline(sc.t.k === 'ref' ? sc.v : sc, args[1].s);
        return { t: ISTREAM, v: null };
      }
      case 'to_string': {
        const r = this.ev(args[0]);
        if (r.t.k !== 'prim') this.err('to_string needs a number');
        return { t: STR, v: isFloatName(r.t.name) ? r.v.toFixed(6) : String(r.v) };
      }
      case 'stoi': case 'stol': case 'stoll': case 'atoi': {
        const r = this.ev(args[0]);
        const m = /^\s*[+-]?\d+/.exec(r.v);
        if (!m) this.err(`${name}: ${JSON.stringify(r.v)} is not a number (invalid_argument)`);
        return { t: name === 'stoi' || name === 'atoi' ? INT : LL, v: parseInt(m[0], 10) };
      }
      case 'stod': case 'stof': case 'atof': {
        const r = this.ev(args[0]);
        const v = parseFloat(r.v);
        if (isNaN(v)) this.err(`${name}: ${JSON.stringify(r.v)} is not a number (invalid_argument)`);
        return d(v);
      }
      case 'exit': throw new ExitSig(args.length ? num(0) : 0);
      case 'setw': return { t: MANIP, v: { setw: num(0) } };
      case 'setprecision': return { t: MANIP, v: { prec: num(0) } };
      case 'system': return { t: INT, v: 0 };
      case 'isdigit': return { t: BOOL, v: /[0-9]/.test(String.fromCharCode(num(0))) ? 1 : 0 };
      case 'isalpha': return { t: BOOL, v: /[A-Za-z]/.test(String.fromCharCode(num(0))) ? 1 : 0 };
      case 'isalnum': return { t: BOOL, v: /[A-Za-z0-9]/.test(String.fromCharCode(num(0))) ? 1 : 0 };
      case 'isupper': return { t: BOOL, v: /[A-Z]/.test(String.fromCharCode(num(0))) ? 1 : 0 };
      case 'islower': return { t: BOOL, v: /[a-z]/.test(String.fromCharCode(num(0))) ? 1 : 0 };
      case 'isspace': return { t: BOOL, v: /\s/.test(String.fromCharCode(num(0))) ? 1 : 0 };
      case 'toupper': return { t: INT, v: String.fromCharCode(num(0)).toUpperCase().charCodeAt(0) };
      case 'tolower': return { t: INT, v: String.fromCharCode(num(0)).toLowerCase().charCodeAt(0) };
      case 'printf': {
        const fmt = this.ev(args[0]);
        let ai = 1;
        const s = String(fmt.v).replace(/%([-+0 #]*)(\d*)(?:\.(\d+))?(l{0,2}|h)?([dicsfeEgGxXup%])/g, (m, _fl, w, p, _len, conv) => {
          if (conv === '%') return '%';
          const r = this.ev(args[ai++]);
          let out = '';
          if (conv === 'd' || conv === 'i' || conv === 'u') out = String(Math.trunc(r.v));
          else if (conv === 'c') out = String.fromCharCode(r.v);
          else if (conv === 's') out = String(r.v);
          else if (conv === 'f') out = Number(r.v).toFixed(p ? +p : 6);
          else if (conv === 'x' || conv === 'X') out = Math.trunc(r.v).toString(16);
          else if (conv === 'p') out = hex(this.addrOf(r.v));
          else out = fmtG(r.v, p ? +p : 6);
          if (w && out.length < +w) out = ' '.repeat(+w - out.length) + out;
          return out;
        });
        this.write(s);
        return { t: INT, v: s.length };
      }
      case 'puts': { const r = this.ev(args[0]); this.write(r.v + '\n'); return { t: INT, v: 0 }; }
    }
    return NOT_BUILTIN;
  }

  newExpr(e: Expr): RV {
    const et = this.tsType(e.ts);
    if (e.arr !== undefined) {
      const n = this.toInt(this.ev(e.arr), 'array size');
      if (n < 0) this.err(`Negative size in new[] (${n})`);
      const at = { k: 'array', of: et, n };
      const c = this.allocHeap(at);
      this.event(`new ${typeName(et)}[${n}]`);
      if (e.brace) this.initFromList(c, e.brace);
      else if (e.valueInit) this.zeroFill(c);
      else c.v.forEach((x: Cell) => this.defaultInit(x, false));
      return { t: { k: 'ptr', to: et }, v: n ? { target: c.v[0], base: c, idx: 0 } : { target: null, base: c, idx: 0 } };
    }
    const c = this.allocHeap(et);
    this.event(`new ${typeName(et)}`);
    if (et.k === 'struct') this.constructWith(c, e.args ?? null, !!e.brace, e.args !== undefined);
    else if (e.args !== undefined) this.constructWith(c, e.args, !!e.brace, true);
    return { t: { k: 'ptr', to: et }, v: { target: c } };
  }

  deleteExpr(e: Expr) {
    const rv = this.ev(e.e);
    if (rv.t.k === 'nullptr' || rv.v === null) { this.event(`delete nullptr`); return; }
    if (rv.t.k !== 'ptr') this.err(`delete needs a pointer, '${e.e.s}' is ${typeName(rv.t)}`);
    const p = rv.v;
    if (p.garbage) this.err(`delete on uninitialized pointer '${e.e.s}'`);
    let obj: Cell;
    if (p.base && p.base.root === p.base && p.base.heap && p.idx === 0) {
      obj = p.base;
      if (!e.arr) this.event(`use delete[] ${e.e.s}`);
    } else {
      obj = p.target;
      if (!obj || obj.root !== obj) this.err(`delete '${e.e.s}': not a block allocated with new`);
      if (e.arr) this.event('use delete, not delete[]');
    }
    if (!obj.heap) this.err(`delete '${e.e.s}': memory was not allocated with new`);
    if (!obj.alive) this.err(`Double free through '${e.e.s}'`);
    const runDtor = (c: Cell) => {
      if (c.t.k === 'struct') {
        const sd = this.sd(c.t.name);
        if (sd.dtor && sd.dtor.body) this.callFunction(sd.dtor, [], c);
      } else if (c.t.k === 'array') c.v.forEach(runDtor);
    };
    runDtor(obj);
    this.killCell(obj);
    this.event(`delete ${e.e.s}`);
  }

  // =================== statements ===================
  declareVar(ts: TypeSpec, d: Declarator, region: 'stack' | 'global', scope: Map<string, Cell> | null, dispName?: string): Cell {
    const dims: (number | null)[] = d.dims.map((x) => (x == null ? null : this.toInt(this.ev(x), 'array size')));
    if (dims.length && dims[0] === null) {
      if (d.braceInit) dims[0] = d.braceInit.length;
      else if (d.init && d.init.t === 'str') dims[0] = d.init.v.length + 1;
      else this.err(`Size of array ${d.name} is unknown`);
    }
    for (const x of dims) if ((x as number) < 0) this.err(`Negative array size (${x})`);
    let t: Type;
    let pre: RV | undefined;
    let refTarget: Cell | undefined;
    if (ts.base === 'auto') {
      if (!d.init) this.err(`auto ${d.name} needs an initializer`);
      if (d.ref || ts.ref) {
        refTarget = this.evalLorTemp(d.init);
        t = { k: 'ref', to: refTarget.t };
      } else {
        pre = this.ev(d.init);
        t = pre.t.k === 'nullptr' ? { k: 'ptr', to: VOID } : pre.t;
        if (t.k === 'initlist') this.err('auto with {} is not supported');
        for (let i = 0; i < d.ptr; i++) if (t.k !== 'ptr') this.err('auto* needs a pointer');
      }
    } else t = this.tsType(ts, d.ptr, dims as number[], d.ref);
    if (t.k === 'prim' && t.name === 'void') this.err(`Variable ${d.name} declared void`);
    const cell = region === 'global' ? this.allocGlobal(t) : this.allocStack(t);
    cell.name = dispName ?? d.name;
    if (scope) {
      if (scope.has(d.name) && region === 'stack') this.err(`Redeclaration of '${d.name}'`);
      scope.set(d.name, cell);
    }
    if (refTarget) { cell.v = refTarget; cell.init = true; }
    else this.initVar(cell, d, pre, region === 'global');
    return cell;
  }

  initVar(c: Cell, d: Declarator, pre: RV | undefined, zero: boolean) {
    const t = c.t;
    if (t.k === 'ref') {
      if (!d.init) this.err(`Reference '${d.name}' must be initialized`);
      c.v = this.evalLorTemp(d.init);
      c.init = true;
      return;
    }
    if (pre) { this.store(c, pre); return; }
    if (d.braceInit) { this.initFromList(c, d.braceInit); return; }
    if (d.ctorArgs) { this.constructWith(c, d.ctorArgs, false); return; }
    if (d.init) {
      if (t.k === 'struct' && d.init.t === 'construct' && d.init.ts.base === t.name && !d.init.ts.ptr) {
        this.constructWith(c, d.init.args, d.init.brace);
        return;
      }
      if (t.k === 'struct') {
        const rv = this.ev(d.init);
        if (rv.t.k === 'struct' && rv.t.name === t.name) {
          // copy-init: run user copy ctor if exists, else member-wise copy
          this.constructWith(c, [{ pre: rv }], false);
          return;
        }
        this.constructWith(c, [{ pre: rv }], false);
        return;
      }
      this.store(c, this.ev(d.init));
      return;
    }
    this.defaultInit(c, zero);
  }

  declNote(c: Cell, d: Declarator): string {
    const tn = typeName(c.t);
    if (c.t.k === 'ref') return `${tn} ${d.name}`;
    if (c.t.k === 'ptr') {
      if (!c.init) return `${tn} ${d.name}`;
      if (c.v === null) return `${tn} ${d.name} = nullptr`;
      if (c.v.target) return `${tn} ${d.name} → ${this.label(c.v.target)}`;
    }
    if (c.t.k === 'struct') return `${tn} ${d.name}`;
    if (c.t.k === 'array') return `${tn} ${d.name}`;
    if (c.t.k === 'vector') return `${tn} ${d.name}`;
    if (!c.init) return `${tn} ${d.name}`;
    return `${tn} ${d.name} = ${this.dispCell(c)}`;
  }

  pushScope() {
    this.frame!.scopes.push({ map: new Map(), sp: this.sp });
  }

  popScope() {
    const f = this.frame!;
    const s = f.scopes.pop()!;
    this.destroyCells(Array.from(s.map.values()));
    this.sp = s.sp;
  }

  destroyCells(cells: Cell[]) {
    for (let i = cells.length - 1; i >= 0; i--) {
      const c = cells[i];
      if (c.t.k === 'struct' && c.alive) {
        const sd = this.sd(c.t.name);
        if (sd.dtor && sd.dtor.body) this.callFunction(sd.dtor, [], c);
      }
      this.killCell(c);
    }
  }

  popFrame() {
    const f = this.frame!;
    const all: Cell[] = [];
    for (const s of f.scopes) for (const c of s.map.values()) all.push(c);
    this.destroyCells(all);
    this.frames.pop();
    this.sp = f.spSave;
    const parent = this.frame;
    if (parent) this.curLine = parent.line;
  }

  execBlock(b: Stmt) {
    this.pushScope();
    try {
      for (const s of b.body) this.execStmt(s);
    } catch (e) {
      if (e instanceof BreakSig || e instanceof ContinueSig) this.popScope();
      throw e;
    }
    this.popScope();
  }

  setLine(line: number) {
    const f = this.frame;
    if (f) f.line = line;
    this.curLine = line;
  }

  execLoopBody(body: Stmt): 'break' | 'continue' | null {
    try {
      this.execStmt(body);
    } catch (e) {
      if (e instanceof BreakSig) return 'break';
      if (e instanceof ContinueSig) return 'continue';
      throw e;
    }
    return null;
  }

  execStmt(s: Stmt) {
    this.setLine(s.line);
    switch (s.t) {
      case 'empty': return;
      case 'block': this.execBlock(s); return;
      case 'decl': {
        const parts: string[] = [];
        for (const d of s.decls) {
          const c = this.declareVar(s.ts, d, 'stack', this.curScope());
          parts.push(this.declNote(c, d));
        }
        this.setLine(s.line);
        this.snap('step', s.line, parts.join('\n'));
        return;
      }
      case 'expr': {
        this.ev(s.e);
        this.setLine(s.line);
        this.snap('step', s.line, `line ${s.line}`);
        return;
      }
      case 'if': {
        const c = this.cond(s.c);
        this.setLine(s.line);
        this.snap('step', s.line, `if (${s.cs}) → ${c ? 'true' : 'false'}`);
        if (c) this.execStmt(s.then);
        else if (s.els) this.execStmt(s.els);
        return;
      }
      case 'while': {
        let iter = 0;
        while (true) {
          this.setLine(s.line);
          const c = this.cond(s.c);
          this.setLine(s.line);
          this.snap('step', s.line, `while (${s.cs}) → ${c ? 'true' : 'false'}`);
          if (!c) break;
          iter++;
          if (this.execLoopBody(s.body) === 'break') break;
        }
        return;
      }
      case 'dowhile': {
        while (true) {
          if (this.execLoopBody(s.body) === 'break') break;
          this.setLine(s.endLine);
          const c = this.cond(s.c);
          this.setLine(s.endLine);
          this.snap('step', s.endLine, `while (${s.cs}) → ${c ? 'true' : 'false'}`);
          if (!c) break;
        }
        return;
      }
      case 'for': {
        this.pushScope();
        try {
          if (s.init) this.execStmt(s.init);
          let first = true;
          while (true) {
            this.setLine(s.line);
            const c = s.c ? this.cond(s.c) : true;
            this.setLine(s.line);
            const stepTxt = !first && s.ss ? `${s.ss}; ` : '';
            this.snap('step', s.line, `${stepTxt}for (${s.cs || 'true'}) → ${c ? 'true' : 'false'}`);
            if (!c) break;
            first = false;
            if (this.execLoopBody(s.body) === 'break') break;
            if (s.step) { this.setLine(s.line); this.ev(s.step); }
          }
        } catch (e) {
          if (e instanceof BreakSig || e instanceof ContinueSig) this.popScope();
          throw e;
        }
        this.popScope();
        return;
      }
      case 'forrange': {
        const coll = this.evalLorTemp(s.e);
        const ck = coll.t.k;
        if (ck !== 'array' && ck !== 'vector' && ck !== 'string') this.err(`Cannot iterate over '${s.es}' (${typeName(coll.t)})`);
        const len = () => (ck === 'string' ? coll.v.length : coll.v.length);
        let i = 0;
        while (true) {
          this.setLine(s.line);
          if (i >= len()) { this.snap('step', s.line, `end for (${s.es})`); break; }
          const el: Cell = ck === 'string' ? this.charProxy(coll, i) : coll.v[i];
          this.pushScope();
          let et: Type = el.t;
          if (s.ts.base !== 'auto') et = this.tsType(s.ts, s.d.ptr);
          const isRef = s.d.ref || s.ts.ref;
          const cell = this.allocStack(isRef ? { k: 'ref', to: et } : et);
          cell.name = s.d.name;
          this.curScope().set(s.d.name, cell);
          if (isRef) { cell.v = el; cell.init = true; } else this.store(cell, this.read(el));
          this.snap('step', s.line, `${s.d.name} = ${this.dispCell(cell)}`);
          let r: string | null;
          try { r = this.execLoopBody(s.body); } catch (e) { throw e; }
          this.popScope();
          if (r === 'break') break;
          i++;
        }
        return;
      }
      case 'switch': {
        const v = this.ev(s.c);
        const key = v.t.k === 'prim' ? v.v : this.err('switch needs an integer or char');
        let start = -1;
        let lbl = '';
        for (const lb of s.labels) {
          if (lb.def) continue;
          const lv = this.ev(lb.value);
          if (lv.v === key) { start = lb.idx; lbl = `case ${lb.value.s ?? lv.v}`; break; }
        }
        if (start < 0) {
          const dl = s.labels.find((l: any) => l.def);
          if (dl) { start = dl.idx; lbl = 'default'; }
        }
        this.setLine(s.line);
        this.snap('step', s.line, `switch (${s.cs}) = ${this.fmtRV(v)} → ${start < 0 ? 'no match' : lbl}`);
        if (start >= 0) {
          this.pushScope();
          try {
            for (let i = start; i < s.items.length; i++) this.execStmt(s.items[i]);
          } catch (e) {
            if (!(e instanceof BreakSig)) {
              if (e instanceof ContinueSig) this.popScope();
              throw e;
            }
          }
          this.popScope();
        }
        return;
      }
      case 'break':
        this.snap('step', s.line, 'break');
        throw new BreakSig();
      case 'continue':
        this.snap('step', s.line, 'continue');
        throw new ContinueSig();
      case 'return': {
        const fr = this.frame!;
        let rv: RV | undefined;
        if (s.e) {
          if (fr.fn.ret.ref) {
            const c = this.evalL(s.e);
            rv = { ...this.read(c), cell: c };
          } else if (s.e.t === 'initlist') {
            rv = { t: { k: 'initlist' }, v: s.e.items };
          } else {
            rv = this.ev(s.e);
            if (rv.t.k === 'struct' || rv.t.k === 'vector') {
              const tmp = this.tempCell(rv.t);
              this.copyCell(tmp, rv.cell!);
              rv = this.read(tmp);
            }
          }
        }
        this.setLine(s.line);
        const isMain = fr.fn.name === 'main' && !fr.fn.cls;
        this.snap('return', s.line, s.e ? `↩ return ${s.es}${rv && rv.t.k !== 'initlist' ? ` → ${this.fmtRV(rv)}` : ''}${isMain ? '' : ''}` : 'return');
        throw new ReturnSig(rv);
      }
    }
    this.err('Unsupported statement: ' + s.t);
  }

  // =================== run ===================
  run() {
    try {
      for (const item of this.prog.items) {
        if (item.kind === 'enum') {
          let v = 0;
          for (const n of item.names) {
            if (n.value) v = this.toInt(this.ev(n.value));
            const c = this.newCell(INT, 0, true);
            c.v = v;
            c.temp = true;
            this.hidden.set(n.name, c);
            v++;
          }
          continue;
        }
        if (item.kind === 'static') {
          const d = item.field.d;
          this.curLine = d.line;
          const key = `${item.cls}::${d.name}`;
          const c = this.declareVar(item.field.ts, d, 'global', null, key);
          this.statics.set(key, c);
          this.globalOrder.push(c);
          continue;
        }
        const st = item.stmt;
        this.curLine = st.line;
        const parts: string[] = [];
        for (const d of st.decls) {
          if (this.globals.has(d.name)) this.err(`Redeclaration of global '${d.name}'`);
          const c = this.declareVar(st.ts, d, 'global', this.globals);
          this.globalOrder.push(c);
          parts.push(this.declNote(c, d) + (!d.init && !d.braceInit && !d.ctorArgs && c.t.k !== 'struct' ? '' : ''));
        }
        this.snap('step', st.line, '' + parts.join('\n'));
      }
      const mains = this.prog.funcs.get('main');
      const main = mains?.find((m) => m.body);
      if (!main) this.err('No main() function', 1);
      const r = this.callFunction(main, [], null);
      const leaks = this.heapList.filter((h) => h.alive);
      const code = r && r.t.k === 'prim' ? r.v : 0;
      let note = `exit ${code}`;
      if (leaks.length) note += `\n${leaks.length} leaked`;
      this.snap('end', main.endLine, note, true);
    } catch (e) {
      if (e instanceof ExitSig) {
        this.snap('end', this.curLine, `exit(${e.code})`, true);
      } else if (e instanceof StopSig) {
        const s = this.serialize(e.kind, this.curLine, e.msg, this.flushEvents());
        if (e.kind === 'error') s.error = e.msg;
        this.snaps.push(s);
      } else if (e instanceof CppError) {
        const s = this.serialize('error', e.line || this.curLine, 'runtime error', this.flushEvents());
        s.error = e.message;
        this.snaps.push(s);
      } else if (e instanceof RangeError) {
        const s = this.serialize('error', this.curLine, 'error', this.flushEvents());
        s.error = 'Stack overflow: recursion too deep';
        this.snaps.push(s);
      } else if (e instanceof BreakSig || e instanceof ContinueSig) {
        const s = this.serialize('error', this.curLine, 'error', []);
        s.error = 'break/continue outside of a loop or switch';
        this.snaps.push(s);
      } else {
        const s = this.serialize('error', this.curLine, 'internal error', []);
        s.error = 'Internal error: ' + (e as Error)?.message;
        this.snaps.push(s);
        // eslint-disable-next-line no-console
        console.error(e);
      }
    }
  }

  flushEvents(): string[] {
    const evs = this.events;
    this.events = [];
    if (this.printed) { evs.push(`output: «${this.printed.replace(/\u0001|\u0002/g, '').replace(/\n/g, '⏎')}»`); this.printed = ''; }
    return evs;
  }
}

export function runProgram(src: string, input: string, maxSteps = 3000): RunResult {
  let prog: Program;
  try {
    prog = parseProgram(src);
  } catch (e) {
    if (e instanceof CppError) return { snaps: [], parseError: { msg: e.message, line: e.line } };
    return { snaps: [], parseError: { msg: 'Internal parser error: ' + (e as Error).message, line: 0 } };
  }
  const it = new Interp(prog, input, maxSteps);
  it.run();
  return { snaps: it.snaps };
}
