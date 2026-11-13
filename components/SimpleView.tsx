'use client';
// Simplified, textbook-style drawing:  [head] -> [ value | Next ] -> [ value | Next ] -> [NULL]
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Snapshot, SnapVal, SnapVar, SnapHeap } from '@/lib/cpp/types';
import { layoutHeap } from '@/lib/heapLayout';

interface Props { snap: Snapshot; prev?: Snapshot; idx: number }
interface PtrVar { id: number; name: string; fn: string; v: Extract<SnapVal, { k: 'ptr' }> }
interface Arrow { key: string; d: string; kind: string }

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
const plainText = (t: string) => t.replace(/^'(.*)'$/, '$1');

interface Ctx { prev: Map<number, string>; hasPrev: boolean; nullFor: Map<number, string> }

function cellCls(sv: SnapVar, ctx: Ctx) {
  const pk = ctx.prev.get(sv.id);
  return ctx.hasPrev && pk !== undefined && pk !== valKey(sv.val) ? ' changed' : '';
}

function PtrDot({ sv, ctx }: { sv: SnapVar; ctx: Ctx }) {
  const v = sv.val as Extract<SnapVal, { k: 'ptr' }>;
  const nullKey = ctx.nullFor.get(sv.id);
  if (v.null && nullKey) return <span className="sn-dot" data-src="1" data-to={nullKey} data-kind="ptr" />;
  if (v.null) return <span className="sn-null-text">NULL</span>;
  if (v.uninit) return <span className="sn-q" title="غير مُهيأ: عنوان عشوائي">؟</span>;
  if (v.target == null) return <span className="sn-q">•</span>;
  return <span className={'sn-dot' + (v.dangling ? ' bad' : '')} data-src="1" data-to={v.target} data-kind={v.dangling ? 'bad' : 'ptr'} />;
}

function Field({ f, ctx }: { f: SnapVar; ctx: Ctx }) {
  const v = f.val;
  const isPtr = v.k === 'ptr';
  let content: React.ReactNode;
  if (isPtr) content = <PtrDot sv={f} ctx={ctx} />;
  else if (v.k === 'prim') content = v.uninit ? <span className="sn-q" title="لم تُعطَ قيمة بعد">؟</span> : plainText(v.text);
  else if (v.k === 'array') content = <MiniArray sv={f} ctx={ctx} />;
  else content = '…';
  return (
    <div className="sn-field">
      <div className="sn-fname">{f.name}</div>
      <div key={cellCls(f, ctx) ? f.id + Math.random() : f.id} className={'sn-cell ' + (isPtr ? 'next' : 'data') + (v.k === 'array' ? ' arr' : '') + cellCls(f, ctx)} data-cell={f.id}>
        {content}
      </div>
    </div>
  );
}

function MiniArray({ sv, ctx }: { sv: SnapVar; ctx: Ctx }) {
  const v = sv.val as Extract<SnapVal, { k: 'array' }>;
  if (!v.elems.length) return <span className="sn-q">فارغ</span>;
  return (
    <div className="sn-arr">
      {v.elems.slice(0, 30).map((e) => (
        <div className="sn-arr-item" key={e.id}>
          <div className={'sn-arr-cell' + cellCls(e, ctx)} data-cell={e.id}>
            {e.val.k === 'ptr' ? <PtrDot sv={e} ctx={ctx} /> : e.val.k === 'prim' ? (e.val.uninit ? '؟' : plainText(e.val.text)) : '…'}
          </div>
          <div className="sn-arr-idx">{e.name}</div>
        </div>
      ))}
      {v.elems.length > 30 && <span className="sn-more">…</span>}
    </div>
  );
}

function ObjBox({ id, type, val, ctx, cls = '', tag }: { id: number; type: string; val: SnapVal; ctx: Ctx; cls?: string; tag?: string }) {
  return (
    <div className={'sn-node' + cls} data-cell={id}>
      <div className="sn-cells">
        {val.k === 'struct' ? val.fields.map((f) => <Field key={f.id} f={f} ctx={ctx} />)
          : val.k === 'array' ? <MiniArray sv={{ id, name: '', type, addr: '', val, born: 0 }} ctx={ctx} />
          : <div className="sn-field"><div className="sn-cell data">{val.k === 'prim' ? (val.uninit ? '؟' : plainText(val.text)) : '…'}</div></div>}
      </div>
      <div className="sn-label">{type}{tag ? <span className="sn-tag">{tag}</span> : null}</div>
    </div>
  );
}

function PtrBox({ p, showFn, noAnchor }: { p: PtrVar; showFn: boolean; noAnchor?: boolean }) {
  const v = p.v;
  const to = v.target != null && !v.null ? v.target : undefined;
  return (
    <div className={'sn-ptr' + (v.dangling ? ' bad' : '')} title={showFn ? `داخل ${p.fn}` : undefined}>
      <span>{p.name}</span>
      {showFn && <small>{p.fn}</small>}
      {to !== undefined && !noAnchor ? <span className="sn-anchor" data-src="1" data-to={to} data-kind={v.dangling ? 'bad' : 'ptr'} /> : null}
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
    const ptrs: PtrVar[] = [];
    const varGroups: { fn: string; vars: SnapVar[] }[] = [];
    for (const f of snap.frames) {
      const others: SnapVar[] = [];
      for (const v of f.vars) {
        if (v.name === 'this' && v.id < 0) continue;
        if (v.val.k === 'ptr') ptrs.push({ id: v.id, name: v.name, fn: f.global ? '' : f.name, v: v.val });
        else others.push(v);
      }
      if (others.length) varGroups.push({ fn: f.global ? 'عام' : f.name, vars: others });
    }
    const above = new Map<number, PtrVar[]>();
    const loose: PtrVar[] = [];
    for (const p of ptrs) {
      const h = p.v.target != null ? owner.get(p.v.target) : undefined;
      if (h !== undefined) { const l = above.get(h) || []; l.push(p); above.set(h, l); } else loose.push(p);
    }
    const nameCount = new Map<string, number>();
    ptrs.forEach((p) => nameCount.set(p.name, (nameCount.get(p.name) || 0) + 1));
    // chain ends -> NULL box
    const nullFor = new Map<number, string>();
    const nullBoxes: { g: number; row: number; col: number; key: string }[] = [];
    groups.forEach((g, gi) => {
      if (g.tree) return;
      const rows = new Map<number, typeof g.items[0]>();
      g.items.forEach((it) => { const cur = rows.get(it.row); if (!cur || it.col > cur.col) rows.set(it.row, it); });
      rows.forEach((it) => {
        if (it.h.val.k !== 'struct') return;
        const pf = it.h.val.fields.find((f) => f.val.k === 'ptr');
        if (pf && pf.val.k === 'ptr' && pf.val.null) {
          const key = `null-${gi}-${it.row}`;
          nullFor.set(pf.id, key);
          nullBoxes.push({ g: gi, row: it.row, col: it.col + 1, key });
        }
      });
    });
    return { above, loose, varGroups, nameCount, nullFor, nullBoxes, names };
  }, [snap, groups]);

  const ctx: Ctx = { prev: prevMap, hasPrev: !!prev, nullFor: model.nullFor };

  const compute = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const out: Arrow[] = [];
    wrap.querySelectorAll<HTMLElement>('[data-src]').forEach((el, i) => {
      const to = el.dataset.to;
      if (!to) return;
      const t = wrap.querySelector<HTMLElement>(`[data-cell="${to}"]`);
      if (!t) return;
      const a = el.getBoundingClientRect();
      const b = t.getBoundingClientRect();
      const ax = a.left + a.width / 2 - wr.left, ay = a.top + a.height / 2 - wr.top;
      const bTop = b.top - wr.top, bBot = b.bottom - wr.top, bL = b.left - wr.left, bR = b.right - wr.left, bCy = (bTop + bBot) / 2;
      let d: string;
      if (el.classList.contains('sn-anchor') && bTop > ay) {
        // pointer box above the node: straight down
        const tx = Math.min(Math.max(ax, bL + 18), bR - 18);
        const sy = a.bottom - wr.top;
        d = `M${ax},${sy} C${ax},${sy + (bTop - sy) / 2} ${tx},${bTop - (bTop - sy) / 2} ${tx},${bTop - 2}`;
      } else if (bL > ax + 20) {
        const dx = Math.max(20, (bL - ax) * 0.5);
        d = `M${ax},${ay} C${ax + dx},${ay} ${bL - dx},${bCy} ${bL - 2},${bCy}`;
      } else if (bTop > ay + 20) {
        const tx = (bL + bR) / 2;
        d = `M${ax},${ay} C${ax},${ay + 50} ${tx},${bTop - 50} ${tx},${bTop - 2}`;
      } else {
        const drop = 50 + Math.abs(bCy - ay) * 0.2;
        d = `M${ax},${ay} C${ax + 30},${ay + drop} ${bR + 40},${bBot + drop} ${(bL + bR) / 2},${bBot + 2}`;
      }
      out.push({ key: `${i}-${to}`, d, kind: el.dataset.kind || 'ptr' });
    });
    setArrows(out);
  }, []);

  useLayoutEffect(() => { compute(); }, [snap, compute]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => compute());
    ro.observe(wrap);
    const t = setTimeout(compute, 480);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [compute, snap]);

  const showFn = (p: PtrVar) => !!p.fn && (model.nameCount.get(p.name) || 0) > 1;
  const callPath = snap.frames.filter((f) => !f.global).map((f) => f.name);
  const nothing = !groups.length && !model.varGroups.length && !model.loose.length && !model.above.size;

  return (
    <div className="sn-wrap" ref={wrapRef}>
      {callPath.length > 0 && (
        <div className="sn-calls">
          <span className="sn-calls-t">الدوال الشغّالة الآن:</span>
          {callPath.map((n, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="sn-calls-sep">←</span>}
              <span className={'sn-call' + (i === callPath.length - 1 ? ' cur' : '')}>{n}()</span>
            </React.Fragment>
          ))}
        </div>
      )}

      {model.varGroups.length > 0 && (
        <div className="sn-vars">
          {model.varGroups.map((g, gi) => (
            <div className="sn-vgroup" key={gi}>
              <span className="sn-vfn">{g.fn}</span>
              {g.vars.map((v) =>
                v.val.k === 'struct' || v.val.k === 'array' ? (
                  <div className="sn-vobj" key={v.id}>
                    <span className="sn-vname">{v.name}</span>
                    {v.val.k === 'struct' ? <ObjBox id={v.id} type={v.type} val={v.val} ctx={ctx} /> : <div data-cell={v.id}><MiniArray sv={v} ctx={ctx} /></div>}
                  </div>
                ) : v.val.k === 'ref' ? (
                  <span className="sn-chip" key={v.id} data-cell={v.id}>{v.name} <small>(اسم آخر لمتغير)</small></span>
                ) : (
                  <span key={cellCls(v, ctx) ? v.id + '-' + idx : v.id} className={'sn-chip' + cellCls(v, ctx)} data-cell={v.id}>
                    {v.name} = <b>{v.val.k === 'prim' ? (v.val.uninit ? '؟' : v.val.text) : '…'}</b>
                  </span>
                ),
              )}
            </div>
          ))}
        </div>
      )}

      {model.loose.length > 0 && (
        <div className="sn-loose">
          {model.loose.map((p) => (
            <div className="sn-loose-item" key={p.id} data-cell={p.id}>
              <PtrBox p={p} showFn={showFn(p)} noAnchor />
              <span className="sn-loose-arrow">→</span>
              {p.v.null ? <div className="sn-nullbox small">NULL</div>
                : p.v.uninit ? <span className="sn-q big" title="مؤشر غير مُهيأ يحمل عنواناً عشوائياً">؟ لا يشير لشيء معروف</span>
                : p.v.target != null && model.names.has(p.v.target) ? <span className="sn-target-name" title="يشير إلى هذا المتغير">{model.names.get(p.v.target)}</span>
                : p.v.outOfScope ? <span className="sn-q big">متغير انتهى عمره ⚠</span>
                : p.v.target != null ? <span className="sn-anchor-inline" data-src="1" data-to={p.v.target} data-kind="ptr" />
                : <span className="sn-q big">عنوان غير صالح</span>}
            </div>
          ))}
        </div>
      )}

      {groups.map((g, gi) => (
        <div className="sn-group" key={gi}>
          {g.kind === 'leak' && <div className="sn-glabel leak">⚠ عُقد ضاعت: لا يوجد أي مؤشر يصل إليها (تسرّب ذاكرة)</div>}
          {g.kind === 'dead' && <div className="sn-glabel dead">🗑 عُقد محذوفة بـ delete</div>}
          <div className={'sn-grid' + (g.tree ? ' tree' : '')}>
            {g.items.map((it) => {
              const ptrsAbove = model.above.get(it.h.id) || [];
              return (
                <React.Fragment key={it.h.id}>
                  <div className="sn-above" style={{ gridRow: it.row * 2 + 1, gridColumn: it.col + 1 }}>
                    {ptrsAbove.map((p) => <PtrBox key={p.id} p={p} showFn={showFn(p)} />)}
                  </div>
                  <div style={{ gridRow: it.row * 2 + 2, gridColumn: it.col + 1 }}>
                    <ObjBox
                      id={it.h.id}
                      type={it.h.type}
                      val={it.h.val}
                      ctx={ctx}
                      cls={(it.h.born === idx && prev ? ' born' : '') + (g.kind === 'leak' ? ' leak' : '') + (!it.h.alive ? ' dead' : '')}
                      tag={it.h.born === idx && prev ? 'جديدة' : !it.h.alive ? 'محذوفة' : undefined}
                    />
                  </div>
                </React.Fragment>
              );
            })}
            {model.nullBoxes.filter((n) => n.g === gi).map((n) => (
              <div key={n.key} style={{ gridRow: n.row * 2 + 2, gridColumn: n.col + 1, alignSelf: 'center' }}>
                <div className="sn-nullbox" data-cell={n.key}>NULL</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {nothing && <div className="sn-empty">لا يوجد شيء في الذاكرة بعد. ستظهر هنا المتغيرات، وكل <b dir="ltr">new Node</b> كصندوق.</div>}

      <svg className="sn-arrows" width="100%" height="100%">
        <defs>
          <marker id="sn-mk" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="sn-mk" /></marker>
          <marker id="sn-mk-bad" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="sn-mk bad" /></marker>
        </defs>
        {arrows.map((a) => <path key={a.key} d={a.d} className={'sn-path ' + a.kind} markerEnd={a.kind === 'bad' ? 'url(#sn-mk-bad)' : 'url(#sn-mk)'} />)}
      </svg>
    </div>
  );
}
