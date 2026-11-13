// Arrange heap objects into rows: linked lists become horizontal chains,
// binary trees (left/right) get a level layout, leaked & freed objects get their own sections.
import type { Snapshot, SnapHeap, SnapVal, SnapVar } from './cpp/types';

export interface Placed { h: SnapHeap; row: number; col: number }
export interface HeapGroup { kind: 'live' | 'leak' | 'dead'; items: Placed[]; tree?: boolean }

function walkVal(v: SnapVal, fn: (sv: SnapVar) => void) {
  if (v.k === 'struct') v.fields.forEach((f) => { fn(f); walkVal(f.val, fn); });
  else if (v.k === 'array') v.elems.forEach((e) => { fn(e); walkVal(e.val, fn); });
}

function ptrTargets(v: SnapVal, out: number[]) {
  if (v.k === 'ptr' && v.target != null) out.push(v.target);
  else if (v.k === 'ref' && v.target != null) out.push(v.target);
  else if (v.k === 'struct') v.fields.forEach((f) => ptrTargets(f.val, out));
  else if (v.k === 'array') v.elems.forEach((e) => ptrTargets(e.val, out));
}

export function layoutHeap(s: Snapshot): HeapGroup[] {
  const byId = new Map<number, SnapHeap>();
  const owner = new Map<number, number>();
  for (const h of s.heap) {
    byId.set(h.id, h);
    owner.set(h.id, h.id);
    walkVal(h.val, (sv) => owner.set(sv.id, h.id));
  }
  const outgoing = (id: number): number[] => {
    const h = byId.get(id)!;
    const t: number[] = [];
    ptrTargets(h.val, t);
    const res: number[] = [];
    for (const x of t) {
      const o = owner.get(x);
      if (o != null && o !== id && !res.includes(o)) res.push(o);
    }
    return res;
  };
  const treeKids = (id: number): { left: number | null; right: number | null } | null => {
    const h = byId.get(id)!;
    if (h.val.k !== 'struct') return null;
    let left: number | null | undefined;
    let right: number | null | undefined;
    for (const f of h.val.fields) {
      if (f.val.k !== 'ptr') continue;
      const n = f.name.toLowerCase();
      const tgt = f.val.target != null ? owner.get(f.val.target) ?? null : null;
      if (left === undefined && /left|^l$|lchild/.test(n)) left = tgt;
      else if (right === undefined && /right|^r$|rchild/.test(n)) right = tgt;
    }
    if (left === undefined || right === undefined) return null;
    return { left, right };
  };

  // roots: pointers held by stack/global variables, in display order
  const roots: number[] = [];
  for (const f of s.frames) {
    for (const v of f.vars) {
      const t: number[] = [];
      ptrTargets(v.val, t);
      for (const x of t) {
        const o = owner.get(x);
        if (o != null && !roots.includes(o)) roots.push(o);
      }
    }
  }

  const visited = new Set<number>();
  const groups: HeapGroup[] = [];

  const runGroup = (kind: HeapGroup['kind'], starts: number[]) => {
    const items: Placed[] = [];
    let isTree = false;
    let row = 0;
    const pending: number[] = [];
    const chain = (start: number) => {
      let col = 0;
      let cur: number | null = start;
      const r = row++;
      while (cur != null && !visited.has(cur)) {
        visited.add(cur);
        items.push({ h: byId.get(cur)!, row: r, col: col++ });
        const outs = outgoing(cur).filter((x) => !visited.has(x));
        cur = outs.length ? outs[0] : null;
        pending.push(...outs.slice(1));
      }
    };
    const tree = (start: number) => {
      isTree = true;
      let counter = 0;
      let maxDepth = 0;
      const base = row;
      const rec = (id: number | null, depth: number) => {
        if (id == null || visited.has(id) || !byId.has(id)) return;
        const k = treeKids(id);
        visited.add(id);
        if (!k) { items.push({ h: byId.get(id)!, row: base + depth, col: counter++ }); return; }
        rec(k.left, depth + 1);
        items.push({ h: byId.get(id)!, row: base + depth, col: counter++ });
        maxDepth = Math.max(maxDepth, depth);
        rec(k.right, depth + 1);
      };
      rec(start, 0);
      row = base + maxDepth + 1;
    };
    const process = (id: number) => {
      if (visited.has(id)) return;
      if (treeKids(id)) tree(id); else chain(id);
      while (pending.length) {
        const p = pending.shift()!;
        if (!visited.has(p)) { if (treeKids(p)) tree(p); else chain(p); }
      }
    };
    for (const id of starts) process(id);
    if (items.length) {
      // normalise rows to be contiguous
      const rows = Array.from(new Set(items.map((i) => i.row))).sort((a, b) => a - b);
      const map = new Map(rows.map((r, i) => [r, i]));
      items.forEach((i) => (i.row = map.get(i.row)!));
      groups.push({ kind, items, tree: isTree });
    }
  };

  runGroup('live', roots.filter((r) => byId.get(r)?.alive && !byId.get(r)?.leaked));
  // live objects only reachable through non-root paths (e.g. referenced via this)
  runGroup('live', s.heap.filter((h) => h.alive && !h.leaked && !visited.has(h.id)).map((h) => h.id));
  // leaked: prefer starting from objects nobody points to
  const leaked = s.heap.filter((h) => h.alive && h.leaked && !visited.has(h.id));
  const pointedAt = new Set<number>();
  for (const h of leaked) for (const o of outgoing(h.id)) pointedAt.add(o);
  runGroup('leak', [...leaked.filter((h) => !pointedAt.has(h.id)), ...leaked].map((h) => h.id));
  runGroup('dead', s.heap.filter((h) => !h.alive && !visited.has(h.id)).map((h) => h.id));

  // merge consecutive live groups
  const merged: HeapGroup[] = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === g.kind) {
      const off = Math.max(...prev.items.map((i) => i.row)) + 1;
      g.items.forEach((i) => (i.row += off));
      prev.items.push(...g.items);
      prev.tree = prev.tree || g.tree;
    } else merged.push(g);
  }
  return merged;
}
