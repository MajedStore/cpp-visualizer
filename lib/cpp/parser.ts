// Recursive-descent parser for a teaching subset of C++
import { Token, lex, CppError } from './lexer';

export interface TypeSpec {
  base: string;
  args?: TypeSpec[];
  ptr: number;
  ref: boolean;
  isConst?: boolean;
}

export type Expr = any;
export type Stmt = any;

export interface Declarator {
  name: string;
  ptr: number;
  ref: boolean;
  dims: (Expr | null)[];
  init?: Expr;
  ctorArgs?: Expr[];
  braceInit?: Expr[];
  line: number;
}

export interface Param {
  ts: TypeSpec;
  name: string;
  dims: (Expr | null)[];
  def?: Expr;
}

export interface FuncDef {
  name: string;
  cls?: string;
  ret: TypeSpec;
  params: Param[];
  body?: Stmt;
  line: number;
  endLine: number;
  isCtor?: boolean;
  isDtor?: boolean;
  isStatic?: boolean;
  initList?: { name: string; args: Expr[]; brace?: boolean }[];
}

export interface FieldDef {
  ts: TypeSpec;
  d: Declarator;
  isStatic: boolean;
}

export interface StructDef {
  name: string;
  fields: FieldDef[];
  ctors: FuncDef[];
  dtor?: FuncDef;
  methods: Map<string, FuncDef[]>;
  line: number;
  isClass: boolean;
}

export type TopItem =
  | { kind: 'decl'; stmt: Stmt }
  | { kind: 'static'; cls: string; field: FieldDef }
  | { kind: 'enum'; names: { name: string; value: Expr | null }[]; line: number };

export interface Program {
  structs: Map<string, StructDef>;
  funcs: Map<string, FuncDef[]>;
  items: TopItem[];
}

export const PRIM_WORDS = new Set(['int', 'double', 'float', 'char', 'bool', 'void', 'long', 'short', 'unsigned', 'signed', 'size_t', 'auto', 'wchar_t']);
const QUALS = new Set(['const', 'static', 'inline', 'constexpr', 'mutable', 'volatile', 'register', 'extern', 'virtual', 'explicit', 'typename']);
const STD_TYPES = new Set(['string', 'vector']);
const BIN_PREC: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=']);

function normPrim(words: string[]): string {
  const w = words.filter((x) => x !== 'signed');
  const uns = w.includes('unsigned');
  if (w.includes('size_t')) return 'unsigned long';
  if (w.includes('auto')) return 'auto';
  if (w.includes('void')) return 'void';
  if (w.includes('bool')) return 'bool';
  if (w.includes('double')) return 'double';
  if (w.includes('float')) return 'float';
  if (w.includes('char') || w.includes('wchar_t')) return uns ? 'unsigned char' : 'char';
  const longs = w.filter((x) => x === 'long').length;
  let base = 'int';
  if (longs >= 2) base = 'long long';
  else if (longs === 1) base = 'long';
  else if (w.includes('short')) base = 'short';
  return uns ? (base === 'int' ? 'unsigned int' : 'unsigned ' + base) : base;
}

function mergeDefaults(fn: FuncDef, proto: FuncDef) {
  fn.params.forEach((p, i) => { if (p.def === undefined && proto.params[i]?.def !== undefined) p.def = proto.params[i].def; });
}

export class Parser {
  toks: Token[];
  p = 0;
  src: string;
  structNames = new Set<string>();
  typedefs = new Map<string, TypeSpec>();
  enumTypes = new Set<string>();
  prog: Program = { structs: new Map(), funcs: new Map(), items: [] };

  constructor(src: string) {
    this.src = src;
    this.toks = lex(src);
  }

  get t(): Token { return this.toks[this.p]; }
  eof(): boolean { return this.toks[this.p].k === 'eof'; }
  at(off: number): Token { return this.toks[Math.min(this.p + off, this.toks.length - 1)]; }
  isv(v: string, off = 0): boolean {
    const t = this.at(off);
    return (t.k === 'op' || t.k === 'id') && t.v === v;
  }
  accept(v: string): boolean {
    if (this.isv(v)) { this.p++; return true; }
    return false;
  }
  expect(v: string) {
    if (!this.accept(v)) {
      const got = this.eof() ? 'نهاية الملف' : this.t.v;
      const prevLine = this.p > 0 ? this.toks[this.p - 1].line : this.t.line;
      const line = v === ';' ? prevLine : this.t.line;
      this.err(`توقعت '${v}' لكن وجدت '${got}'` + (v === ';' ? ' — هل نسيت الفاصلة المنقوطة ; ؟' : ''), line);
    }
  }
  err(msg: string, line = this.t.line): never { throw new CppError(msg, line); }
  ident(): string {
    if (this.t.k !== 'id') this.err(`توقعت اسماً (identifier) لكن وجدت '${this.t.v || 'نهاية الملف'}'`);
    return this.toks[this.p++].v;
  }
  srcFrom(startTok: number): string {
    const a = this.toks[startTok];
    const b = this.toks[Math.max(startTok, this.p - 1)];
    return this.src.slice(a.pos, b.end).replace(/\s+/g, ' ').trim();
  }

  isTypeName(v: string) {
    return PRIM_WORDS.has(v) || STD_TYPES.has(v) || this.structNames.has(v) || this.typedefs.has(v) || this.enumTypes.has(v);
  }

  isTypeStart(off = 0): boolean {
    const t = this.at(off);
    if (t.k !== 'id') return false;
    let v = t.v;
    if (QUALS.has(v)) return true;
    if (v === 'struct' || v === 'class' || v === 'enum') return this.at(off + 1).k === 'id';
    if (v === 'std' && this.isv('::', off + 1)) {
      v = this.at(off + 2).v;
      return STD_TYPES.has(v);
    }
    if (PRIM_WORDS.has(v) || STD_TYPES.has(v)) {
      // functional cast like int(x) is an expression
      if ((v !== 'unsigned' && v !== 'long' && v !== 'signed' && v !== 'short') && (this.isv('(', off + 1))) return false;
      return true;
    }
    if (this.structNames.has(v) || this.typedefs.has(v) || this.enumTypes.has(v)) {
      const nx = this.at(off + 1);
      if (nx.v === '::' || nx.v === '(' || nx.v === '{' || nx.v === '.' ) return false;
      return true;
    }
    return false;
  }

  // ---------- types ----------
  parseBaseType(): TypeSpec {
    let isConst = false;
    while (this.t.k === 'id' && QUALS.has(this.t.v)) {
      if (this.t.v === 'const' || this.t.v === 'constexpr') isConst = true;
      this.p++;
    }
    if (this.isv('struct') || this.isv('class')) { this.p++; if (this.t.k === 'id' && !PRIM_WORDS.has(this.t.v)) this.structNames.add(this.t.v); }
    else if (this.isv('enum')) this.p++;
    if (this.isv('std') && this.isv('::', 1)) this.p += 2;
    let ts: TypeSpec;
    if (this.t.k === 'id' && PRIM_WORDS.has(this.t.v)) {
      const words: string[] = [];
      while (this.t.k === 'id' && PRIM_WORDS.has(this.t.v)) {
        words.push(this.t.v);
        this.p++;
        if (words.includes('auto')) break;
      }
      ts = { base: normPrim(words), ptr: 0, ref: false };
    } else {
      const line = this.t.line;
      const name = this.ident();
      if (name === 'vector') {
        this.expect('<');
        const arg = this.parseType();
        this.expectCloseAngle();
        ts = { base: 'vector', args: [arg], ptr: 0, ref: false };
      } else if (this.typedefs.has(name)) {
        const td = this.typedefs.get(name)!;
        ts = { ...td };
      } else if (this.enumTypes.has(name)) {
        ts = { base: 'int', ptr: 0, ref: false };
      } else if (this.structNames.has(name) || name === 'string') {
        ts = { base: name, ptr: 0, ref: false };
      } else if (['stack', 'queue', 'map', 'set', 'list', 'deque', 'pair', 'unordered_map', 'array'].includes(name)) {
        this.err(`النوع std::${name} غير مدعوم حالياً في المُصوِّر (المدعوم: vector و string والـ struct/class الخاصة بك)`, line);
      } else {
        this.err(`نوع غير معروف '${name}'`, line);
      }
    }
    while (this.accept('const')) isConst = true;
    ts.isConst = isConst || ts.isConst;
    return ts;
  }

  parseType(): TypeSpec {
    const b = this.parseBaseType();
    while (this.accept('*')) { b.ptr++; this.accept('const'); }
    if (this.accept('&') || this.accept('&&')) b.ref = true;
    return b;
  }

  expectCloseAngle() {
    if (this.isv('>>')) {
      this.toks[this.p] = { ...this.t, v: '>', pos: this.t.pos + 1 };
      return;
    }
    this.expect('>');
  }

  parseDeclarator(allowNoName = false): Declarator {
    const line = this.t.line;
    let ptr = 0;
    let ref = false;
    while (this.accept('*')) { ptr++; this.accept('const'); }
    if (this.accept('&') || this.accept('&&')) ref = true;
    let name = '';
    if (this.t.k === 'id' && !(allowNoName && (this.isv(',') || this.isv(')')))) name = this.ident();
    else if (!allowNoName) this.err(`توقعت اسم متغير لكن وجدت '${this.t.v}'`);
    const dims: (Expr | null)[] = [];
    while (this.accept('[')) {
      if (this.accept(']')) dims.push(null);
      else { dims.push(this.parseExpr()); this.expect(']'); }
    }
    return { name, ptr, ref, dims, line };
  }

  parseInit(d: Declarator) {
    if (this.accept('=')) {
      if (this.isv('{')) d.braceInit = this.parseBraceList();
      else d.init = this.parseAssign();
    } else if (this.isv('(')) {
      this.p++;
      d.ctorArgs = this.parseArgs();
    } else if (this.isv('{')) {
      d.braceInit = this.parseBraceList();
    }
  }

  parseBraceList(): Expr[] {
    this.expect('{');
    const items: Expr[] = [];
    while (!this.isv('}')) {
      if (this.isv('{')) items.push({ t: 'initlist', items: this.parseBraceList(), line: this.t.line });
      else items.push(this.parseAssign());
      if (!this.accept(',')) break;
    }
    this.expect('}');
    return items;
  }

  parseArgs(): Expr[] {
    // after '('
    const args: Expr[] = [];
    if (this.accept(')')) return args;
    do {
      if (this.isv('{')) args.push({ t: 'initlist', items: this.parseBraceList(), line: this.t.line });
      else args.push(this.parseAssign());
    } while (this.accept(','));
    this.expect(')');
    return args;
  }

  // ---------- program ----------
  parseProgram(): Program {
    while (!this.eof()) {
      if (this.accept(';')) continue;
      if (this.isv('using')) { while (!this.isv(';') && !this.eof()) this.p++; this.expect(';'); continue; }
      if (this.isv('template')) this.err('القوالب (template) غير مدعومة حالياً');
      if (this.isv('namespace')) this.err('تعريف namespace غير مدعوم حالياً');
      if (this.isv('typedef')) { this.parseTypedef(); continue; }
      if (this.isv('enum')) { this.parseEnum(); continue; }
      if ((this.isv('struct') || this.isv('class')) && this.at(1).k === 'id' && (this.isv('{', 2) || this.isv(';', 2) || this.isv(':', 2))) {
        this.parseStruct();
        continue;
      }
      // out-of-class constructor / destructor:  Node::Node(...)  Node::~Node()
      if (this.t.k === 'id' && this.structNames.has(this.t.v) && this.isv('::', 1)) {
        const line = this.t.line;
        const cls = this.ident();
        this.expect('::');
        const isDtor = this.accept('~');
        const name = this.ident();
        if (name !== cls) this.err(`تعريف غير متوقع ${cls}::${name}`);
        const fn = this.parseFunctionRest({ base: 'void', ptr: 0, ref: false }, name, cls, line, !isDtor, isDtor);
        this.attachMethod(cls, fn, line);
        continue;
      }
      this.parseTopDeclOrFunc();
    }
    return this.prog;
  }

  attachMethod(cls: string, fn: FuncDef, line: number) {
    const sd = this.prog.structs.get(cls);
    if (!sd) this.err(`الكلاس ${cls} غير معرف`, line);
    if (fn.isCtor) {
      const idx = sd.ctors.findIndex((c) => !c.body && c.params.length === fn.params.length);
      if (idx >= 0) { mergeDefaults(fn, sd.ctors[idx]); sd.ctors[idx] = fn; } else sd.ctors.push(fn);
    } else if (fn.isDtor) sd.dtor = fn;
    else {
      const list = sd.methods.get(fn.name) || [];
      const idx = list.findIndex((c) => !c.body && c.params.length === fn.params.length);
      if (idx >= 0) { fn.isStatic = list[idx].isStatic; mergeDefaults(fn, list[idx]); list[idx] = fn; } else list.push(fn);
      sd.methods.set(fn.name, list);
    }
  }

  parseTypedef() {
    this.expect('typedef');
    if ((this.isv('struct') || this.isv('class')) && (this.isv('{', 1) || this.isv('{', 2))) {
      this.err('صيغة typedef struct {...} غير مدعومة — استخدم struct Name {...};');
    }
    const ts = this.parseType();
    const name = this.ident();
    this.expect(';');
    this.typedefs.set(name, ts);
  }

  parseEnum() {
    const line = this.t.line;
    this.expect('enum');
    this.accept('class');
    if (this.t.k === 'id' && !this.isv('{')) this.enumTypes.add(this.ident());
    this.expect('{');
    const names: { name: string; value: Expr | null }[] = [];
    while (!this.isv('}')) {
      const name = this.ident();
      let value: Expr | null = null;
      if (this.accept('=')) value = this.parseTernary();
      names.push({ name, value });
      if (!this.accept(',')) break;
    }
    this.expect('}');
    this.expect(';');
    this.prog.items.push({ kind: 'enum', names, line });
  }

  parseStruct() {
    const line = this.t.line;
    const isClass = this.t.v === 'class';
    this.p++;
    const name = this.ident();
    this.structNames.add(name);
    if (this.accept(';')) return; // forward declaration
    if (this.isv(':')) this.err('الوراثة (inheritance) غير مدعومة حالياً في المُصوِّر');
    this.expect('{');
    const sd: StructDef = this.prog.structs.get(name) || { name, fields: [], ctors: [], methods: new Map(), line, isClass };
    sd.line = line;
    this.prog.structs.set(name, sd);
    while (!this.isv('}')) {
      if (this.eof()) this.err(`لم يتم إغلاق ${isClass ? 'class' : 'struct'} ${name} بـ }`, line);
      if (this.accept(';')) continue;
      if ((this.isv('public') || this.isv('private') || this.isv('protected')) && this.isv(':', 1)) { this.p += 2; continue; }
      if (this.isv('friend')) { while (!this.isv(';')) this.p++; this.p++; continue; }
      if (this.isv('struct') || this.isv('class')) this.err('تعريف struct داخل struct غير مدعوم');
      const mline = this.t.line;
      // constructor
      let k = 0;
      while (this.isv('explicit', k) || this.isv('inline', k)) k++;
      if (this.isv(name, k) && this.isv('(', k + 1)) {
        this.p += k + 1;
        const fn = this.parseFunctionRest({ base: 'void', ptr: 0, ref: false }, name, name, mline, true, false);
        this.attachMethod(name, fn, mline);
        continue;
      }
      if (this.isv('~', k) || (this.isv('virtual') && this.isv('~', 1))) {
        if (this.isv('virtual')) this.p++;
        this.p += k + 1;
        const dn = this.ident();
        const fn = this.parseFunctionRest({ base: 'void', ptr: 0, ref: false }, dn, name, mline, false, true);
        this.attachMethod(name, fn, mline);
        continue;
      }
      const isStatic = this.isv('static') || (this.isv('static', 1));
      const base = this.parseBaseType();
      if (this.isv('operator') || this.isv('operator', 1)) this.err('التحميل الزائد للمعاملات (operator overloading) غير مدعوم حالياً');
      let first = true;
      do {
        const d = this.parseDeclarator();
        if (first && this.isv('(')) {
          const ret = { ...base, ptr: base.ptr + d.ptr, ref: d.ref };
          const fn = this.parseFunctionRest(ret, d.name, name, mline, false, false);
          fn.isStatic = isStatic;
          this.attachMethod(name, fn, mline);
          break;
        }
        first = false;
        this.parseInit(d);
        sd.fields.push({ ts: base, d, isStatic });
        if (isStatic) this.prog.items.push({ kind: 'static', cls: name, field: { ts: base, d, isStatic } });
        if (!this.accept(',')) { this.expect(';'); break; }
      } while (true);
    }
    this.expect('}');
    // struct Node {...} a, b;
    if (this.t.k === 'id') {
      const decls: Declarator[] = [];
      do { const d = this.parseDeclarator(); this.parseInit(d); decls.push(d); } while (this.accept(','));
      this.prog.items.push({ kind: 'decl', stmt: { t: 'decl', ts: { base: name, ptr: 0, ref: false }, decls, line } });
    }
    this.expect(';');
  }

  parseTopDeclOrFunc() {
    const line = this.t.line;
    if (!this.isTypeStart()) {
      this.err(`لم أفهم هذا السطر: '${this.t.v}' — توقعت تعريف دالة أو متغير أو struct`);
    }
    const base = this.parseBaseType();
    const decls: Declarator[] = [];
    let first = true;
    do {
      const d = this.parseDeclarator();
      if (first && this.isv('::')) {
        // out-of-class method:  int Cls::name(...)
        const cls = d.name;
        this.p++;
        const mname = this.ident();
        if (!this.isv('(')) {
          // static member definition:  int Cls::count = 0;
          const sd = this.prog.structs.get(cls);
          const f = sd?.fields.find((x) => x.isStatic && x.d.name === mname);
          if (!f) this.err(`'${cls}::${mname}' ليس عضواً static في ${cls}`);
          const tmp: Declarator = { name: mname, ptr: 0, ref: false, dims: [], line };
          while (this.accept('[')) { if (!this.accept(']')) { tmp.dims.push(this.parseExpr()); this.expect(']'); } }
          this.parseInit(tmp);
          this.expect(';');
          if (tmp.init) f.d.init = tmp.init;
          if (tmp.braceInit) f.d.braceInit = tmp.braceInit;
          if (tmp.ctorArgs) f.d.ctorArgs = tmp.ctorArgs;
          if (tmp.dims.length && f.d.dims.every((x) => x === null)) f.d.dims = tmp.dims;
          return;
        }
        const ret = { ...base, ptr: base.ptr + d.ptr, ref: d.ref };
        const fn = this.parseFunctionRest(ret, mname, cls, line, false, false);
        this.attachMethod(cls, fn, line);
        return;
      }
      if (first && this.isv('(') && (this.isv(')', 1) || this.isTypeStart(1))) {
        const ret = { ...base, ptr: base.ptr + d.ptr, ref: d.ref };
        const fn = this.parseFunctionRest(ret, d.name, undefined, line, false, false);
        const list = this.prog.funcs.get(fn.name) || [];
        const idx = list.findIndex((f) => !f.body && f.params.length === fn.params.length);
        if (idx >= 0) { mergeDefaults(fn, list[idx]); list[idx] = fn; }
        else if (fn.body || !list.some((f) => f.params.length === fn.params.length)) list.push(fn);
        this.prog.funcs.set(fn.name, list);
        return;
      }
      first = false;
      this.parseInit(d);
      decls.push(d);
    } while (this.accept(','));
    this.expect(';');
    this.prog.items.push({ kind: 'decl', stmt: { t: 'decl', ts: base, decls, line } });
  }

  parseParams(): Param[] {
    this.expect('(');
    const ps: Param[] = [];
    if (this.isv('void') && this.isv(')', 1)) this.p++;
    if (this.accept(')')) return ps;
    do {
      const b = this.parseBaseType();
      const d = this.parseDeclarator(true);
      let def: Expr | undefined;
      if (this.accept('=')) def = this.parseAssign();
      ps.push({ ts: { ...b, ptr: b.ptr + d.ptr, ref: d.ref }, name: d.name, dims: d.dims, def });
    } while (this.accept(','));
    this.expect(')');
    return ps;
  }

  parseFunctionRest(ret: TypeSpec, name: string, cls: string | undefined, line: number, isCtor: boolean, isDtor: boolean): FuncDef {
    const params = this.parseParams();
    while (this.isv('const') || this.isv('override') || this.isv('noexcept') || this.isv('final')) this.p++;
    const fn: FuncDef = { name, cls, ret, params, line, endLine: line, isCtor, isDtor };
    if (this.accept('=')) { this.p++; this.expect(';'); return fn; } // = default / = 0
    if (isCtor && this.accept(':')) {
      fn.initList = [];
      do {
        const n = this.ident();
        if (this.isv('{')) fn.initList.push({ name: n, args: this.parseBraceList(), brace: true });
        else { this.expect('('); fn.initList.push({ name: n, args: this.parseArgs() }); }
      } while (this.accept(','));
    }
    if (this.accept(';')) return fn;
    fn.body = this.parseBlock();
    fn.endLine = fn.body.endLine;
    return fn;
  }

  // ---------- statements ----------
  parseBlock(): Stmt {
    const line = this.t.line;
    this.expect('{');
    const body: Stmt[] = [];
    while (!this.isv('}')) {
      if (this.eof()) this.err('لم يتم إغلاق القوس { — ينقص }', line);
      body.push(this.parseStatement());
    }
    const endLine = this.t.line;
    this.p++;
    return { t: 'block', body, line, endLine };
  }

  parseDeclStmt(): Stmt {
    const line = this.t.line;
    const isStatic = this.isv('static');
    const ts = this.parseBaseType();
    const decls: Declarator[] = [];
    do { const d = this.parseDeclarator(); this.parseInit(d); decls.push(d); } while (this.accept(','));
    this.expect(';');
    return { t: 'decl', ts, decls, line, isStatic };
  }

  parseCond(): { c: Expr; cs: string } {
    this.expect('(');
    const st = this.p;
    const c = this.parseExpr();
    const cs = this.srcFrom(st);
    this.expect(')');
    return { c, cs };
  }

  parseStatement(): Stmt {
    const t = this.t;
    const line = t.line;
    if (t.k === 'op' && t.v === '{') return this.parseBlock();
    if (t.k === 'op' && t.v === ';') { this.p++; return { t: 'empty', line }; }
    if (t.k === 'id') {
      switch (t.v) {
        case 'if': {
          this.p++;
          const { c, cs } = this.parseCond();
          const then = this.parseStatement();
          let els: Stmt | null = null;
          let elseLine = 0;
          if (this.isv('else')) { elseLine = this.t.line; this.p++; els = this.parseStatement(); }
          return { t: 'if', c, cs, then, els, line, elseLine };
        }
        case 'while': {
          this.p++;
          const { c, cs } = this.parseCond();
          const body = this.parseStatement();
          return { t: 'while', c, cs, body, line };
        }
        case 'do': {
          this.p++;
          const body = this.parseStatement();
          const endLine = this.t.line;
          this.expect('while');
          const { c, cs } = this.parseCond();
          this.expect(';');
          return { t: 'dowhile', c, cs, body, line, endLine };
        }
        case 'for': {
          this.p++;
          this.expect('(');
          let init: Stmt | null = null;
          if (this.isTypeStart()) {
            const save = this.p;
            const ts = this.parseBaseType();
            const d = this.parseDeclarator();
            if (this.accept(':')) {
              const st = this.p;
              const e = this.parseExpr();
              const es = this.srcFrom(st);
              this.expect(')');
              const body = this.parseStatement();
              return { t: 'forrange', ts, d, e, es, body, line };
            }
            this.p = save;
            init = this.parseDeclStmt();
          } else if (this.accept(';')) init = null;
          else { init = { t: 'expr', e: this.parseExpr(), line }; this.expect(';'); }
          let c: Expr | null = null;
          let cs = '';
          if (!this.isv(';')) { const st = this.p; c = this.parseExpr(); cs = this.srcFrom(st); }
          this.expect(';');
          let step: Expr | null = null;
          let ss = '';
          if (!this.isv(')')) { const st = this.p; step = this.parseExpr(); ss = this.srcFrom(st); }
          this.expect(')');
          const body = this.parseStatement();
          return { t: 'for', init, c, cs, step, ss, body, line };
        }
        case 'switch': {
          this.p++;
          const { c, cs } = this.parseCond();
          this.expect('{');
          const items: Stmt[] = [];
          const labels: { value?: Expr; def?: boolean; idx: number; line: number }[] = [];
          while (!this.isv('}')) {
            if (this.eof()) this.err('لم يتم إغلاق switch', line);
            if (this.isv('case')) {
              const l = this.t.line;
              this.p++;
              const v = this.parseTernary();
              this.expect(':');
              labels.push({ value: v, idx: items.length, line: l });
              continue;
            }
            if (this.isv('default') && this.isv(':', 1)) {
              const l = this.t.line;
              this.p += 2;
              labels.push({ def: true, idx: items.length, line: l });
              continue;
            }
            items.push(this.parseStatement());
          }
          const endLine = this.t.line;
          this.p++;
          return { t: 'switch', c, cs, items, labels, line, endLine };
        }
        case 'break': this.p++; this.expect(';'); return { t: 'break', line };
        case 'continue': this.p++; this.expect(';'); return { t: 'continue', line };
        case 'return': {
          this.p++;
          let e: Expr | null = null;
          let es = '';
          if (!this.isv(';')) {
            const st = this.p;
            if (this.isv('{')) e = { t: 'initlist', items: this.parseBraceList(), line };
            else e = this.parseExpr();
            es = this.srcFrom(st);
          }
          this.expect(';');
          return { t: 'return', e, es, line };
        }
        case 'goto': this.err('goto غير مدعوم');
        case 'try': case 'throw': this.err('الاستثناءات (try/throw) غير مدعومة حالياً');
        case 'struct': case 'class':
          if (!this.isTypeStart()) this.err('تعريف struct/class داخل دالة غير مدعوم — عرّفه خارج الدوال');
      }
      if (this.isTypeStart()) return this.parseDeclStmt();
    }
    const st = this.p;
    const e = this.parseExpr();
    const es = this.srcFrom(st);
    this.expect(';');
    return { t: 'expr', e, es, line };
  }

  // ---------- expressions ----------
  parseExpr(): Expr {
    let e = this.parseAssign();
    while (this.isv(',')) {
      const line = this.t.line;
      this.p++;
      const r = this.parseAssign();
      e = { t: 'comma', l: e, r, line };
    }
    return e;
  }

  parseAssign(): Expr {
    const st = this.p;
    const l = this.parseTernary();
    if (this.t.k === 'op' && ASSIGN_OPS.has(this.t.v)) {
      const op = this.t.v;
      const line = this.t.line;
      this.p++;
      let r: Expr;
      if (this.isv('{')) r = { t: 'initlist', items: this.parseBraceList(), line };
      else r = this.parseAssign();
      return { t: 'assign', op, l, r, line, s: this.srcFrom(st) };
    }
    return l;
  }

  parseTernary(): Expr {
    const st = this.p;
    const c = this.parseBinary(1);
    if (this.isv('?')) {
      const line = this.t.line;
      this.p++;
      const a = this.parseExpr();
      this.expect(':');
      const b = this.parseAssign();
      return { t: 'tern', c, a, b, line, s: this.srcFrom(st) };
    }
    return c;
  }

  parseBinary(minPrec: number): Expr {
    const st = this.p;
    let l = this.parseUnary();
    while (true) {
      const t = this.t;
      if (t.k !== 'op') break;
      const prec = BIN_PREC[t.v];
      if (prec === undefined || prec < minPrec) break;
      this.p++;
      const r = this.parseBinary(prec + 1);
      l = { t: 'bin', op: t.v, l, r, line: t.line, s: this.srcFrom(st) };
    }
    return l;
  }

  parseUnary(): Expr {
    const st = this.p;
    const t = this.t;
    const line = t.line;
    if (t.k === 'op') {
      if (t.v === '++' || t.v === '--') { this.p++; const e = this.parseUnary(); return { t: 'pre', op: t.v, e, line, s: this.srcFrom(st) }; }
      if (['-', '+', '!', '~', '*', '&'].includes(t.v)) {
        this.p++;
        const e = this.parseUnary();
        return { t: 'un', op: t.v, e, line, s: this.srcFrom(st) };
      }
      if (t.v === '(' && this.isTypeStart(1)) {
        // C-style cast  (int)x  (Node*)p
        const save = this.p;
        this.p++;
        const ts = this.parseType();
        if (this.accept(')')) {
          const e = this.parseUnary();
          return { t: 'cast', ts, e, line, s: this.srcFrom(st) };
        }
        this.p = save;
      }
    }
    if (t.k === 'id') {
      if (t.v === 'new') {
        this.p++;
        const ts = this.parseBaseType();
        while (this.accept('*')) ts.ptr++;
        const node: any = { t: 'new', ts, line };
        if (this.accept('[')) { node.arr = this.parseExpr(); this.expect(']'); if (this.isv('{')) node.brace = this.parseBraceList(); else if (this.isv('(') && this.isv(')', 1)) { this.p += 2; node.valueInit = true; } }
        else if (this.accept('(')) node.args = this.parseArgs();
        else if (this.isv('{')) { node.args = this.parseBraceList(); node.brace = true; }
        node.s = this.srcFrom(st);
        return node;
      }
      if (t.v === 'delete') {
        this.p++;
        let arr = false;
        if (this.isv('[') && this.isv(']', 1)) { this.p += 2; arr = true; }
        const e = this.parseUnary();
        return { t: 'delete', e, arr, line, s: this.srcFrom(st) };
      }
      if (t.v === 'sizeof') {
        this.p++;
        if (this.isv('(') && this.isTypeStart(1)) {
          this.p++;
          const ts = this.parseType();
          const dims: Expr[] = [];
          while (this.accept('[')) { dims.push(this.parseExpr()); this.expect(']'); }
          this.expect(')');
          return { t: 'sizeof', ts, dims, line, s: this.srcFrom(st) };
        }
        const e = this.parseUnary();
        return { t: 'sizeof', e, line, s: this.srcFrom(st) };
      }
    }
    return this.parsePostfix();
  }

  parsePostfix(): Expr {
    const st = this.p;
    let e = this.parsePrimary();
    while (true) {
      const t = this.t;
      if (t.k !== 'op') break;
      if (t.v === '[') { this.p++; const i = this.parseExpr(); this.expect(']'); e = { t: 'index', a: e, i, line: t.line, s: this.srcFrom(st) }; continue; }
      if (t.v === '(') { this.p++; const args = this.parseArgs(); e = { t: 'call', f: e, args, line: t.line, s: this.srcFrom(st) }; continue; }
      if (t.v === '.' || t.v === '->') {
        this.p++;
        if (this.isv('~')) this.err('استدعاء الـ destructor يدوياً غير مدعوم');
        const name = this.ident();
        e = { t: 'member', e, name, arrow: t.v === '->', line: t.line, s: this.srcFrom(st) };
        continue;
      }
      if (t.v === '++' || t.v === '--') { this.p++; e = { t: 'post', op: t.v, e, line: t.line, s: this.srcFrom(st) }; continue; }
      break;
    }
    return e;
  }

  parsePrimary(): Expr {
    const t = this.t;
    const line = t.line;
    const st = this.p;
    if (t.k === 'num') { this.p++; return { t: 'num', v: t.num, isFloat: t.isFloat, line, s: t.v }; }
    if (t.k === 'char') { this.p++; return { t: 'char', v: t.num, line, s: this.srcFrom(st) }; }
    if (t.k === 'str') {
      let s = '';
      while (this.t.k === 'str') { s += this.t.v; this.p++; }
      return { t: 'str', v: s, line, s: this.srcFrom(st) };
    }
    if (t.k === 'op') {
      if (t.v === '(') {
        this.p++;
        const e = this.parseExpr();
        this.expect(')');
        return { ...e, paren: true, s: this.srcFrom(st) };
      }
      if (t.v === '{') {
        return { t: 'initlist', items: this.parseBraceList(), line, s: this.srcFrom(st) };
      }
      if (t.v === '::') { this.p++; return this.parsePrimary(); }
      if (t.v === '[') this.err('دوال lambda غير مدعومة');
      this.err(`لم أتوقع '${t.v}' هنا`);
    }
    if (t.k === 'id') {
      const v = t.v;
      if (v === 'true' || v === 'false') { this.p++; return { t: 'bool', v: v === 'true' ? 1 : 0, line, s: v }; }
      if (v === 'nullptr' || v === 'NULL') { this.p++; return { t: 'null', line, s: v }; }
      if (v === 'this') { this.p++; return { t: 'this', line, s: 'this' }; }
      if (v === 'static_cast' || v === 'reinterpret_cast' || v === 'const_cast' || v === 'dynamic_cast') {
        this.p++;
        this.expect('<');
        const ts = this.parseType();
        this.expectCloseAngle();
        this.expect('(');
        const e = this.parseExpr();
        this.expect(')');
        return { t: 'cast', ts, e, line, s: this.srcFrom(st) };
      }
      if (v === 'std' && this.isv('::', 1)) { this.p += 2; return this.parsePrimary(); }
      // functional cast / temporary:  int(x)  string("a")  Node(5)  vector<int>(3)
      if ((PRIM_WORDS.has(v) || v === 'string' || v === 'vector' || this.structNames.has(v)) && (this.isv('(', 1) || this.isv('{', 1) || this.isv('<', 1))) {
        if (!(v === 'vector') || this.isv('<', 1)) {
          const ts = this.parseBaseType();
          let args: Expr[] = [];
          let brace = false;
          if (this.accept('(')) args = this.parseArgs();
          else if (this.isv('{')) { args = this.parseBraceList(); brace = true; }
          return { t: 'construct', ts, args, brace, line, s: this.srcFrom(st) };
        }
      }
      if (QUALS.has(v) || PRIM_WORDS.has(v)) this.err(`لم أتوقع '${v}' هنا`);
      if (['if', 'else', 'while', 'for', 'do', 'return', 'switch', 'case', 'break', 'continue'].includes(v)) this.err(`لم أتوقع الكلمة '${v}' هنا`);
      this.p++;
      if (this.isv('::')) {
        this.p++;
        const n2 = this.ident();
        return { t: 'id', name: n2, scope: v, line, s: this.srcFrom(st) };
      }
      return { t: 'id', name: v, line, s: v };
    }
    if (t.k === 'eof') this.err('نهاية الملف بشكل غير متوقع');
    this.err(`رمز غير متوقع '${t.v}'`);
  }
}

export function parseProgram(src: string): Program {
  return new Parser(src).parseProgram();
}
