'use client';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Snapshot, SnapVal, SnapVar, SnapHeap } from '@/lib/cpp/types';
import { layoutHeap } from '@/lib/heapLayout';

interface Props {
  snap: Snapshot;
  prev?: Snapshot;
  idx: number;
  showAddr: boolean;
}

interface Arrow { key: string; d: string; kind: string; fresh: boolean }

function valKey(v: SnapVal): string {
  switch (v.k) {
    case 'ptr': return `p:${v.target ?? ''}:${v.null ? 'n' : ''}${v.uninit ? 'u' : ''}${v.dangling ? 'd' : ''}`;
    case 'ref': return `r:${v.target}`;
    case 'prim': return v.text;
    default: return '';
  }
}

function collect(s: Snapshot | undefined): Map<number, string> {
  const m = new Map<number, string>();
  if (!s) return m;
  const walk = (sv: SnapVar) => {
    m.set(sv.id, valKey(sv.val));
    if (sv.val.k === 'struct') sv.val.fields.forEach(walk);
    else if (sv.val.k === 'array') sv.val.elems.forEach(walk);
  };
  s.frames.forEach((f) => f.vars.forEach(walk));
  s.heap.forEach((h) => {
    if (h.val.k === 'struct') h.val.fields.forEach(walk);
    else if (h.val.k === 'array') h.val.elems.forEach(walk);
    else m.set(h.id, valKey(h.val));
  });
  return m;
}

interface Ctx { prev: Map<number, string>; idx: number; hasPrev: boolean; showAddr: boolean }

function Slot({ sv, ctx, flat }: { sv: SnapVar; ctx: Ctx; flat?: boolean }) {
  const v = sv.val;
  const pk = ctx.prev.get(sv.id);
  const changed = ctx.hasPrev && pk !== undefined && pk !== valKey(v);
  const born = ctx.hasPrev && pk === undefined && sv.born === ctx.idx;
  const anim = changed ? ' changed' : born ? ' born-v' : '';
  const animKey = changed ? `${sv.id}-${ctx.idx}` : sv.id;

  if (v.k === 'struct') {
    return (
      <div className="nested" data-cell={sv.id}>
        {!flat && <div className="nested-head">{sv.type}{ctx.showAddr && sv.addr !== '0x0' ? ` · ${sv.addr}` : ''}</div>}
        {v.fields.map((f) => (
          <div className="hfield" key={f.id}>
            <span className="fname">{f.name}</span>
            <Slot sv={f} ctx={ctx} />
          </div>
        ))}
      </div>
    );
  }
  if (v.k === 'array') {
    if (!v.elems.length) return <span className="arr-empty" data-cell={sv.id}>{v.vector ? 'vector فارغ' : 'فارغة'}</span>;
    return (
      <div className="arr" data-cell={sv.id}>
        {v.elems.map((e) => (
          <div className="arr-cell" key={e.id}>
            <Slot sv={e} ctx={ctx} />
            <span className="arr-idx">{e.name}</span>
          </div>
        ))}
        {(v as any).more ? <span className="arr-more">… +{(v as any).more}</span> : null}
      </div>
    );
  }
  if (v.k === 'ref') {
    return (
      <span key={animKey} className={'slot ptr' + anim} data-cell={sv.id} title="مرجع (reference): اسم آخر لنفس المتغير">
        <span className="ptr-dot ref" data-src="1" data-to={v.target ?? ''} data-kind="ref" />
        <span className="ptr-text">&amp;</span>
      </span>
    );
  }
  if (v.k === 'ptr') {
    if (v.null) {
      return (
        <span key={animKey} className={'slot ptr null' + anim} data-cell={sv.id} title="nullptr: لا يشير إلى أي شيء">
          <span className="nullmark" />nullptr
        </span>
      );
    }
    if (v.uninit) {
      return (
        <span key={animKey} className={'slot uninit' + anim} data-cell={sv.id} title="مؤشر غير مُهيأ: يحمل عنواناً عشوائياً (garbage)">
          ? garbage
        </span>
      );
    }
    const isThis = sv.name === 'this' && sv.id < 0;
    const kind = isThis ? 'this' : v.dangling ? 'dangling' : changed || born ? 'hot' : 'ptr';
    return (
      <span key={animKey} className={'slot ptr' + (v.dangling || v.outOfScope ? ' dangling' : '') + anim} data-cell={sv.id} title={`العنوان المخزّن: ${v.text}`}>
        <span className={'ptr-dot ' + kind} data-src="1" data-to={v.target ?? ''} data-kind={kind} />
        {ctx.showAddr && <span className="ptr-text">{v.text}</span>}
        {v.dangling && <span className="ptr-warn">معلّق</span>}
        {v.outOfScope && <span className="ptr-warn">خارج النطاق</span>}
        {v.pastEnd && <span className="ptr-warn">بعد النهاية</span>}
        {v.target == null && !v.pastEnd && !v.outOfScope && <span className="ptr-text">مؤقت</span>}
      </span>
    );
  }
  return (
    <span key={animKey} className={'slot' + (v.uninit ? ' uninit' : '') + (v.str ? ' str' : '') + anim} data-cell={sv.id} title={v.uninit ? 'غير مُهيأ: قيمة عشوائية (garbage)' : `${sv.type}${sv.addr && sv.addr !== '0x0' ? ' @ ' + sv.addr : ''}`}>
      {v.text}
    </span>
  );
}

function HeapObj({ h, ctx, kind }: { h: SnapHeap; ctx: Ctx; kind: string }) {
  const born = ctx.hasPrev && h.alive && h.born === ctx.idx;
  const cls = 'hobj' + (born ? ' born' : '') + (kind === 'leak' ? ' leaked' : '') + (!h.alive ? ' dead' : '');
  const fake: SnapVar = { id: h.id, name: '', type: h.type, addr: h.addr, val: h.val, born: h.born };
  return (
    <div className={cls} data-cell={h.id}>
      <div className="hobj-head">
        <span className="ty">{h.type}</span>
        {born && <span className="tag new">جديد</span>}
        {kind === 'leak' && <span className="tag leak" title="لا يوجد مؤشر يصل إليه — لا يمكن تحريره بعد الآن">تسرّب</span>}
        {!h.alive && <span className="tag dead">محرّر</span>}
        <span className="ad">{h.addr}</span>
      </div>
      {h.val.k === 'struct' ? (
        <div className="hfields">
          {h.val.fields.map((f) => (
            <div className="hfield" key={f.id}>
              <span className="fname">{f.name}</span>
              <Slot sv={f} ctx={ctx} />
            </div>
          ))}
        </div>
      ) : h.val.k === 'array' ? (
        <Slot sv={fake} ctx={ctx} />
      ) : (
        <Slot sv={fake} ctx={ctx} />
      )}
    </div>
  );
}

export default function MemoryView({ snap, prev, idx, showAddr }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const lastKeys = useRef<Set<string>>(new Set());
  const prevMap = useMemo(() => collect(prev), [prev]);
  const groups = useMemo(() => layoutHeap(snap), [snap]);
  const ctx: Ctx = { prev: prevMap, idx, hasPrev: !!prev, showAddr };

  const compute = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const out: Arrow[] = [];
    const keys = new Set<string>();
    wrap.querySelectorAll<HTMLElement>('[data-src]').forEach((el, i) => {
      const to = el.dataset.to;
      if (!to) return;
      const target = wrap.querySelector<HTMLElement>(`[data-cell="${to}"]`);
      if (!target) return;
      const kind = el.dataset.kind || 'ptr';
      const a = el.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - wr.left;
      const y1 = a.top + a.height / 2 - wr.top;
      const bl = b.left - wr.left;
      const br = b.right - wr.left;
      const y2 = b.top - wr.top + Math.min(b.height / 2, 15);
      let d: string;
      if (bl > x1 + 24) {
        const dx = Math.max(28, (bl - x1) * 0.45);
        d = `M${x1},${y1} C${x1 + dx},${y1} ${bl - dx},${y2} ${bl - 3},${y2}`;
      } else if (br < x1 - 24) {
        // target to the left: loop below and enter from its right side
        const drop = Math.max(36, Math.abs(y2 - y1) * 0.3 + 30);
        d = `M${x1},${y1} C${x1 + 30},${y1 + drop} ${br + 40},${y2 + drop} ${br + 3},${y2}`;
      } else {
        // overlapping columns (e.g. stack -> stack): bow out to the right
        const xo = Math.max(x1, br) + 46 + Math.min(60, Math.abs(y2 - y1) * 0.15);
        d = `M${x1},${y1} C${xo},${y1} ${xo},${y2} ${br + 3},${y2}`;
      }
      const src = el.closest('[data-cell]')?.getAttribute('data-cell') ?? String(i);
      const key = `${src}->${to}`;
      keys.add(key);
      out.push({ key, d, kind, fresh: !lastKeys.current.has(key) && (kind === 'ptr' || kind === 'hot' || kind === 'ref') });
    });
    lastKeys.current = keys;
    setArrows(out);
  }, []);

  useLayoutEffect(() => {
    compute();
  }, [snap, showAddr, compute]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => compute());
    ro.observe(wrap);
    window.addEventListener('resize', compute);
    // re-measure after entrance animations settle
    const t = setTimeout(compute, 520);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); clearTimeout(t); };
  }, [compute, snap]);

  const prevFrameIds = useMemo(() => new Set(prev?.frames.map((f) => f.id) ?? []), [prev]);
  const frames = snap.frames.filter((f) => !f.global || f.vars.length > 0);
  const lastFrameId = snap.frames[snap.frames.length - 1]?.id;

  return (
    <div className="mem-wrap" ref={wrapRef}>
      <div className="mem-col stack-col">
        <div className="mem-title">📚 <b>Stack</b> المكدس (المتغيرات المحلية)</div>
        {frames.length === 0 && <div className="mem-empty">لا توجد إطارات حالياً.</div>}
        {frames.map((f) => (
          <div
            key={f.id}
            className={'frame' + (f.global ? ' global' : '') + (f.id === lastFrameId && !f.global ? ' current' : !f.global ? ' inactive' : '') + (prev && !prevFrameIds.has(f.id) ? ' born' : '')}
          >
            <div className="frame-head">
              <span>{f.global ? '🌐 المتغيرات العامة (Global)' : `${f.name}()`}</span>
              {!f.global && <span className="fline">سطر {f.line}</span>}
            </div>
            <div className="vars">
              {f.vars.length === 0 && <div className="no-vars">لا توجد متغيرات بعد</div>}
              {f.vars.map((v) => (
                <div className="var-row" key={v.id}>
                  <span className="var-type">{v.type}</span>
                  <span className="var-name">{v.name}</span>
                  <Slot sv={v} ctx={ctx} />
                  {showAddr && v.addr && v.val.k !== 'ref' && <span className="var-addr">{v.addr}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mem-col heap-col">
        <div className="mem-title">🧱 <b>Heap</b> الكومة (ما يُنشأ بـ new)</div>
        {groups.length === 0 && (
          <div className="mem-empty">الـ Heap فارغ. كل كائن تُنشئه بـ <span className="ltr-code">new</span> سيظهر هنا، وتشير إليه الأسهم من المؤشرات.</div>
        )}
        {groups.map((g, gi) => (
          <div className="heap-section" key={g.kind + gi}>
            {g.kind === 'leak' && <div className="heap-label leak">⚠ تسرّب ذاكرة (memory leak): كائنات لا يصل إليها أي مؤشر — لم يعد بالإمكان تحريرها</div>}
            {g.kind === 'dead' && <div className="heap-label dead">🗑 ذاكرة محرّرة بـ delete (ما زال هناك مؤشر يشير إليها!)</div>}
            <div className={'heap-grid' + (g.tree ? ' tree' : '')}>
              {g.items.map((p) => (
                <div key={p.h.id} style={{ gridRow: p.row + 1, gridColumn: p.col + 1 }}>
                  <HeapObj h={p.h} ctx={ctx} kind={g.kind} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <svg className="arrows" width="100%" height="100%">
        <defs>
          {['ptr', 'hot', 'dangling', 'this', 'ref'].map((k) => (
            <marker key={k} id={`mk-${k}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`mk-${k}`} />
            </marker>
          ))}
        </defs>
        {arrows.map((a) => (
          <path key={a.key + (a.fresh ? '-f' + idx : '')} d={a.d} className={`k-${a.kind}${a.fresh ? ' draw' : ''}`} markerEnd={`url(#mk-${a.kind})`} pathLength={a.fresh ? 1 : undefined} />
        ))}
      </svg>
    </div>
  );
}
