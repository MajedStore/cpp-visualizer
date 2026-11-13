'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import CodeArea from './CodeArea';
import SimpleView from './SimpleView';
import { runProgram } from '@/lib/cpp/interpreter';
import type { RunResult, Snapshot } from '@/lib/cpp/types';
import { EXAMPLES } from '@/lib/examples';

const LS = { code: 'cppviz.code', input: 'cppviz.input', theme: 'cppviz.theme', interval: 'cppviz.interval', auto: 'cppviz.autostart' };

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}

function encodeShare(code: string, input: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ c: code, i: input }));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeShare(s: string): { c: string; i: string } | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  } catch { return null; }
}

// keep code fragments left-to-right inside Arabic error messages
const LTR_RUN = /[A-Za-z0-9_'"(\[*&!~<>=+\-.:#@{]+(?:[\x20-\x7E]*[A-Za-z0-9_)\]'";*}&>+\-])?/g;
function Bidi({ text }: { text: string }) {
  const clean = text.replace(/[⁦-⁩]/g, '');
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LTR_RUN.lastIndex = 0;
  while ((m = LTR_RUN.exec(clean))) {
    if (m.index > last) out.push(clean.slice(last, m.index));
    out.push(<bdi dir="ltr" key={m.index}>{m[0]}</bdi>);
    last = m.index + m[0].length;
  }
  if (last < clean.length) out.push(clean.slice(last));
  return <>{out}</>;
}

function Console({ out }: { out: string }) {
  const parts = out.split(/(\u0001[^\u0002]*\u0002)/);
  return (
    <pre className="console">
      {parts.map((p, i) => (p.startsWith('\u0001') ? <span key={i} className="inp">{p.slice(1, -1)}</span> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </pre>
  );
}

export default function Visualizer() {
  const [code, setCode] = useState<string>(EXAMPLES[0].code);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const [result, setResult] = useState<RunResult | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [interval, setIntervalSec] = useState(1);
  const [autoStart, setAutoStart] = useState(false);
  const [exampleId, setExampleId] = useState('');
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const [toast, setToast] = useState('');
  const loaded = useRef(false);

  useEffect(() => {
    const m = /#code=([\w-]+)/.exec(window.location.hash);
    const shared = m ? decodeShare(m[1]) : null;
    if (shared) { setCode(shared.c); setInput(shared.i || ''); }
    else {
      const c = lsGet(LS.code);
      if (c) setCode(c); else setExampleId(EXAMPLES[0].id);
      const i = lsGet(LS.input);
      if (i) setInput(i);
    }
    const th = lsGet(LS.theme);
    if (th === 'light' || th === 'dark') setTheme(th);
    const iv = parseFloat(lsGet(LS.interval) || '');
    if (iv > 0) setIntervalSec(iv);
    setAutoStart(lsGet(LS.auto) === '1');
    const q = new URLSearchParams(window.location.search);
    const qt = q.get('theme');
    if (qt === 'light' || qt === 'dark') setTheme(qt);
    const ex = EXAMPLES.find((e) => e.id === q.get('ex'));
    if (ex || (shared && q.has('step'))) {
      const c = ex ? ex.code : shared!.c;
      const inp = ex ? ex.input ?? '' : shared!.i || '';
      if (ex) { setExampleId(ex.id); setCode(c); setInput(inp); }
      const r = runProgram(c, inp, 3000);
      setResult(r);
      if (!r.parseError) {
        setIdx(Math.min(Math.max(1, parseInt(q.get('step') || '1', 10) || 1) - 1, r.snaps.length - 1));
        setMode('view');
      }
    }
    loaded.current = true;
  }, []);

  useEffect(() => { if (loaded.current) lsSet(LS.code, code); }, [code]);
  useEffect(() => { if (loaded.current) lsSet(LS.input, input); }, [input]);
  useEffect(() => { if (loaded.current) lsSet(LS.interval, String(interval)); }, [interval]);
  useEffect(() => { if (loaded.current) lsSet(LS.auto, autoStart ? '1' : '0'); }, [autoStart]);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
    if (loaded.current) lsSet(LS.theme, theme);
  }, [theme]);

  const snaps = result?.snaps ?? [];
  const snap: Snapshot | undefined = snaps[idx];
  const prev = idx > 0 ? snaps[idx - 1] : undefined;
  const next = snaps[idx + 1];
  const last = snaps.length - 1;

  const run = useCallback(() => {
    const r = runProgram(code, input, 3000);
    setResult(r);
    setIdx(0);
    if (r.parseError) { setMode('edit'); setPlaying(false); return; }
    setMode('view');
    setPlaying(autoStart);
  }, [code, input, autoStart]);

  const go = useCallback((i: number) => setIdx(Math.max(0, Math.min(i, snaps.length - 1))), [snaps.length]);

  useEffect(() => {
    if (!playing) return;
    if (idx >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setIdx((i) => i + 1), Math.max(50, interval * 1000));
    return () => clearTimeout(t);
  }, [playing, idx, last, interval]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (mode !== 'view') {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setPlaying(false); go(idx + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setPlaying(false); go(idx - 1); }
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(last);
      else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 'Escape') { setPlaying(false); setMode('edit'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [mode, idx, last, go, run]);

  const loadExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setExampleId(id);
    setCode(ex.code);
    setInput(ex.input ?? '');
    setResult(null);
    setMode('edit');
    setPlaying(false);
    if (window.location.hash || window.location.search) history.replaceState(null, '', window.location.pathname);
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#code=${encodeShare(code, input)}`;
    try { await navigator.clipboard.writeText(url); setToast('✔'); setTimeout(() => setToast(''), 1500); } catch { window.prompt('', url); }
  };

  const onLineClick = (line: number) => {
    let j = snaps.findIndex((s, i) => i > idx && s.line === line);
    if (j < 0) j = snaps.findIndex((s) => s.line === line);
    if (j >= 0) { setPlaying(false); setIdx(j); }
  };

  const parseError = result?.parseError;
  const runError = snap && (snap.error || (snap.kind === 'input' ? snap.note : ''));
  const errLine = parseError ? parseError.line : runError ? snap!.line : undefined;
  const errMsg = parseError ? parseError.msg : runError;

  return (
    <>
      <header className="bar">
        <span className="logo">C++</span>
        <select className="sel" value={exampleId} onChange={(e) => loadExample(e.target.value)} aria-label="examples">
          <option value="">أمثلة</option>
          {EXAMPLES.map((e) => <option value={e.id} key={e.id}>{e.title}</option>)}
        </select>
        <span className="grow" />
        <label className="timer" title="الوقت بين كل خطوة (ثانية)">
          <input type="number" min={0.1} max={10} step={0.1} value={interval} onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) setIntervalSec(v); }} />
          <span>ث</span>
        </label>
        <label className="chk" title="يبدأ التشغيل التلقائي فور الضغط على تشغيل">
          <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
          <span>بدء تلقائي</span>
        </label>
        {mode === 'edit' ? (
          <button className="btn primary" onClick={run} title="Ctrl+Enter">▶ تشغيل</button>
        ) : (
          <>
            <button className="btn" onClick={() => { setPlaying(false); setMode('edit'); }} title="Esc">✎ تعديل</button>
            <button className="btn primary" onClick={run}>⟳</button>
          </>
        )}
        <button className="btn icon" onClick={share} title="share">🔗</button>
        <button className="btn icon" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark')} title="theme">
          {theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}
        </button>
      </header>

      <main className="layout">
        <div className="col">
          <section className="box code-box">
            <CodeArea
              code={code}
              onChange={(s) => { setCode(s); if (result?.parseError) setResult(null); }}
              readOnly={mode === 'view'}
              curLine={mode === 'view' ? snap?.line : undefined}
              nextLine={mode === 'view' && next && next.line !== snap?.line ? next.line : undefined}
              errLine={errLine}
              onLineClick={mode === 'view' ? onLineClick : undefined}
            />
          </section>

          {errMsg && <div className="errbar">{errMsg.split('\n').map((l, i) => <div key={i}><Bidi text={l} /></div>)}</div>}

          {mode === 'view' && snap ? (
            <section className="box ctrl">
              <div className="row" dir="ltr">
                <button className="btn icon" onClick={() => { setPlaying(false); go(0); }} disabled={idx === 0}>⏮</button>
                <button className="btn icon" onClick={() => { setPlaying(false); go(idx - 1); }} disabled={idx === 0}>◀</button>
                <span className="count">{idx + 1}/{snaps.length}</span>
                <button className="btn icon" onClick={() => { setPlaying(false); go(idx + 1); }} disabled={idx >= last}>▶</button>
                <button className="btn icon" onClick={() => { setPlaying(false); go(last); }} disabled={idx >= last}>⏭</button>
                <span className="grow" />
                <button className={'btn play' + (playing ? ' on' : '')} onClick={() => { if (idx >= last) setIdx(0); setPlaying((p) => !p); }}>{playing ? '⏸' : '⏵'}</button>
              </div>
              <input className="slider" type="range" min={0} max={last} value={idx} onChange={(e) => { setPlaying(false); setIdx(+e.target.value); }} />
            </section>
          ) : (
            <section className="box">
              <textarea className="stdin" value={input} onChange={(e) => setInput(e.target.value)} placeholder="cin" spellCheck={false} dir="ltr" />
            </section>
          )}

          <section className="box">
            <Console out={mode === 'view' && snap ? snap.out : ''} />
          </section>
        </div>

        <section className="box canvas">
          {mode === 'view' && snap ? <SimpleView snap={snap} prev={prev} idx={idx} /> : null}
        </section>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
