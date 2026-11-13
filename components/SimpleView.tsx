'use client';
// Minimal textbook-style drawing:  [head] -> [ 10 | • ] -> [ 20 | • ] -> [NULL]
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Snapshot, SnapVal, SnapVar } from '@/lib/cpp/types';
import { layoutHeap } from '@/lib/heapLayout';

interface Props { snap: Snapshot; prev?: Snapshot; idx: number }
type PtrVal = Extract<SnapVal, { k: 'ptr' }>;
interface PtrVar { id: number; name: string; fn: string; v: PtrVal }
interface Arrow { key: string; d: string; bad: boolean }

function valKey(v: SnapVal): string {
  if (v.k === 'ptr') return `p:${v.target ?? ''}:${v.null ? 'n' : ''}${v.uninit ? 'u' : ''}`;
  if (v.k === 'prim') return v.text;
  if (v.k === 'ref') return `r:${v.target}`;
  return '';
}
function collect(s?: Snapshot): Map<number, string> {
  const m = new Map<number, string>();
  if (!s) return m;
  const walk = (sv: SnapVar) => {
    m.set(sv.id, valKey(sv.val));
    if (sv.val.k === 'struct') sv.val.fields.forEach(walk);
    else if (sv.val.k === 'array') sv.val.elems.forEach(walk);
  };
  s.frames.forEach((f) => f.vars.forEach(walk));
  s.heap.forEach((h) => walk({ id: h.id, name: '', type: h.type, addr: '', val: h.val, born: h.born }));
  return m;
}
function walkVal(v: SnapVal, fn: (sv: SnapVar) => void) {
  if (v.k === 'struct') v.fields.forEach((f) => { fn(f); walkVal(f.val, fn); });
  else if (v.k === 'array') v.elems.forEach((e) => { fn(e); walkVal(e.val, fn); });
}
const txt = (v: SnapVal) => (v.k === 'prim' ? (v.uninit ? '?' : v.text.replace(/^'(.*)'$/, '$1')) : '');

interface Ctx { prev: Map<number, string>; hasPrev: boolean; nullFor: Map<number, string>; idx: number }
const changed = (sv: SnapVar, ctx: Ctx) => {
  const pk = ctx.prev.get(sv.id);
  return ctx.hasPrev && pk !== undefined && pk !== valKey(sv.val);
};

function PtrDot({ sv, ctx }: { sv: SnapVar; ctx: Ctx }) {
  const v = sv.val as PtrVal;
  const nk = ctx.nullFor.get(sv.id);
  if (v.null && nk) return <span className="dot" data-src="1" data-to={nk} />;
  if (v.null) return <span className="nul">/</span>;
  if (v.uninit || v.target == null) return <span>?</span>;
  return <span className={'dot' + (v.dangling ? ' bad' : '')} data-src="1" data-to={v.target} data-bad={v.dangling ? '1' : ''} />;
}

function Cell({ f, ctx }: { f: SnapVar; ctx: Ctx }) {
  const v = f.val;
  const ch = changed(f, ctx);
  const cls = 'c ' + (v.k === 'ptr' ? 'nx' : 'dt') + (ch ? ' chg' : '');
  return (
    <div key={ch ? `${f.id}-${ctx.idx}` : f.id} className={cls} data-cell={f.id} title={f.name}>
      {v.k === 'ptr' ? <PtrDot sv={f} ctx={ctx} /> : v.k === 'array' ? <Arr sv={f} ctx={ctx} /> : v.k === 'prim' ? txt(v) : '…'}
    </div>
  );
}

function Arr({ sv, ctx }: { sv: SnapVar; ctx: Ctx }) {
  const v = sv.val as Extract<SnapVal, { k: 'array' }>;
  return (
    <div className="arr" data-cell={sv.id}>
      {v.elems.slice(0, 40).map((e) => (
        <div key={changed(e, ctx) ? `${e.id}-${ctx.idx}` : e.id} className={'ac' + (changed(e, ctx) ? ' chg' : '')} data-cell={e.id}>
          {e.val.k === 'ptr' ? <PtrDot sv={e} ctx={ctx} /> : txt(e.val) || '…'}
        </div>
      ))}
    </div>
  );
}

function Obj({ id, type, val, ctx, cls = '' }: { id: number; type: string; val: SnapVal; ctx: Ctx; cls?: string }) {
  return (
    <div className={'obj' + cls} data-cell={id}>
      <div className="cells">
        {val.k === 'struct' ? val.fields.map((f) => <Cell key={f.id} f={f} ctx={ctx} />)
          : val.k === 'array' ? <Arr sv={{ id: -id, name: '', type, addr: '', val, born: 0 }} ctx={ctx} />
          : <div className="c dt">{txt(val)}</div>}
      </div>
      <div className="lbl">{type}</div>
    </div>
  );
}

function PtrBox({ p, label, anchor }: { p: PtrVar; label: string; anchor: boolean }) {
  const to = p.v.target != null && !p.v.null ? p.v.target : undefined;
  return (
    <div className={'ptr' + (p.v.dangling ? ' bad' : '')}>
      {label}
      {anchor && to !== undefined ? <span className="anc" data-src="1" data-to={to} data-bad={p.v.dangling ? '1' : ''} /> : null}
    </div>
  );
}

export default function SimpleView({ snap, prev, idx }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const prevMap = useMemo(() => collect(prev), [prev]);
  const groups = useMemo(() => layoutHeap(snap), [snap]);

  const model = useMemo(() => {
    const owner = new Map<number, number>();
    for (const h of snap.heap) { owner.set(h.id, h.id); walkVal(h.val, (sv) => owner.set(sv.id, h.id)); }
    const names = new Map<number, string>();
    const nameWalk = (sv: SnapVar, path: string) => {
      names.set(sv.id, path);
      if (sv.val.k === 'struct') sv.val.fields.forEach((f) => nameWalk(f, `${path}.${f.name}`));
      else if (sv.val.k === 'array') sv.val.elems.forEach((e) => nameWalk(e, `${path}[${e.name}]`));
    };
    snap.frames.forEach((f) => f.vars.forEach((v) => { if (v.id >= 0) nameWalk(v, v.name); }));
    // every pointer held outside the heap (variables, fields of stack objects, array slots)
    const ptrs: PtrVar[] = [];
    const vars: SnapVar[] = [];
    const ptrWalk = (sv: SnapVar, path: string, fn: string) => {
      if (sv.val.k === 'ptr') ptrs.push({ id: sv.id, name: path, fn, v: sv.val });
      else if (sv.val.k === 'struct') sv.val.fields.forEach((f) => ptrWalk(f, `${path}.${f.name}`, fn));
      else if (sv.val.k === 'array') sv.val.elems.forEach((e) => ptrWalk(e, `${path}[${e.name}]`, fn));
    };
    for (const f of snap.frames) {
      for (const v of f.vars) {
        if (v.name === 'this' && v.id < 0) continue;
        ptrWalk(v, v.name, f.global ? '' : f.name);
      }
    }
    const count = new Map<string, number>();
    ptrs.forEach((p) => count.set(p.name, (count.get(p.name) || 0) + 1));
    const label = (p: PtrVar) => ((count.get(p.name) || 0) > 1 && p.fn ? `${p.name}·${p.fn}` : p.name);
    const above = new Map<number, PtrVar[]>();
    const loose: PtrVar[] = [];
    for (const p of ptrs) {
      const h = p.v.target != null ? owner.get(p.v.target) : undefined;
      if (h !== undefined) above.set(h, [...(above.get(h) || []), p]); else loose.push(p);
    }
    const nullFor = new Map<number, string>();
    const nullBoxes: { g: number; row: number; col: number; key: string }[] = [];
    groups.forEach((g, gi) => {
      if (g.tree) return;
      const ends = new Map<number, (typeof g.items)[0]>();
      g.items.forEach((it) => { const c = ends.get(it.row); if (!c || it.col > c.col) ends.set(it.row, it); });
      ends.forEach((it) => {
        if (it.h.val.k !== 'struct') return;
        const pf = it.h.val.fields.find((f) => f.val.k === 'ptr');
        if (pf && pf.val.k === 'ptr' && pf.val.null) {
          const key = `null-${gi}-${it.row}`;
          nullFor.set(pf.id, key);
          nullBoxes.push({ g: gi, row: it.row, col: it.col + 1, key });
        }
      });
    });
    return { above, loose, vars, label, nullFor, nullBoxes, names };
  }, [snap, groups]);

  const ctx: Ctx = { prev: prevMap, hasPrev: !!prev, nullFor: model.nullFor, idx };

  const compute = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const out: Arrow[] = [];
    wrap.querySelectorAll<HTMLElement>('[data-src]').forEach((el, i) => {
      const t = el.dataset.to ? wrap.querySelector<HTMLElement>(`[data-cell="${el.dataset.to}"]`) : null;
      if (!t) return;
      const a = el.getBoundingClientRect();
      const b = t.getBoundingClientRect();
      const ax = a.left + a.width / 2 - wr.left, ay = a.top + a.height / 2 - wr.top;
      const bT = b.top - wr.top, bB = b.bottom - wr.top, bL = b.left - wr.left, bR = b.right - wr.left, bY = (bT + bB) / 2;
      let d: string;
      if (el.classList.contains('anc') && bT > ay) {
        const tx = Math.min(Math.max(ax, bL + 16), bR - 16);
        d = `M${ax},${ay} L${tx},${bT - 2}`;
      } else if (bL > ax + 16) {
        const dx = Math.max(16, (bL - ax) * 0.5);
        d = Math.abs(bY - ay) < 4 ? `M${ax},${ay} L${bL - 2},${bY}` : `M${ax},${ay} C${ax + dx},${ay} ${bL - dx},${bY} ${bL - 2},${bY}`;
      } else if (bT > ay + 16) {
        const tx = (bL + bR) / 2;
        d = `M${ax},${ay} C${ax},${ay + 40} ${tx},${bT - 40} ${tx},${bT - 2}`;
      } else {
        const drop = 44 + Math.abs(bY - ay) * 0.2;
        d = `M${ax},${ay} C${ax + 24},${ay + drop} ${bR + 30},${bB + drop} ${(bL + bR) / 2},${bB + 2}`;
      }
      out.push({ key: `${i}-${el.dataset.to}`, d, bad: el.dataset.bad === '1' });
    });
    setArrows(out);
  }, []);

  useLayoutEffect(() => { compute(); }, [snap, compute]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => compute());
    ro.observe(wrap);
    const t = setTimeout(compute, 400);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [compute, snap]);

  return (
    <div className="sv" ref={wrapRef}>
      {groups.length === 0 && <div className="empty">No nodes yet</div>}

      {groups.map((g, gi) => (
        <div className={'grid ' + g.kind + (g.tree ? ' tree' : '')} key={gi}>
          {g.items.map((it) => (
            <React.Fragment key={it.h.id}>
              <div className="above" style={{ gridRow: it.row * 2 + 1, gridColumn: it.col + 1 }}>
                {(model.above.get(it.h.id) || []).map((p) => <PtrBox key={p.id} p={p} label={model.label(p)} anchor />)}
              </div>
              <div style={{ gridRow: it.row * 2 + 2, gridColumn: it.col + 1 }}>
                <Obj id={it.h.id} type={it.h.type} val={it.h.val} ctx={ctx}
                  cls={(prev && it.h.born === idx ? ' new' : '') + (g.kind === 'leak' ? ' lost' : '') + (!it.h.alive ? ' gone' : '')} />
              </div>
            </React.Fragment>
          ))}
          {model.nullBoxes.filter((n) => n.g === gi).map((n) => (
            <div key={n.key} style={{ gridRow: n.row * 2 + 2, gridColumn: n.col + 1 }}>
              <div className="nullb" data-cell={n.key}>NULL</div>
            </div>
          ))}
        </div>
      ))}

      <svg className="arrows" width="100%" height="100%">
        <defs>
          <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="ahp" /></marker>
          <marker id="ahb" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="ahp bad" /></marker>
        </defs>
        {arrows.map((a) => <path key={a.key} d={a.d} className={'ar' + (a.bad ? ' bad' : '')} markerEnd={a.bad ? 'url(#ahb)' : 'url(#ah)'} />)}
      </svg>
    </div>
  );
}
