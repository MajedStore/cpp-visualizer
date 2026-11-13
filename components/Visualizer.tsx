'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeArea from './CodeArea';
import SimpleView from './SimpleView';
import { runProgram } from '@/lib/cpp/interpreter';
import type { RunResult, Snapshot } from '@/lib/cpp/types';
import { EXAMPLES } from '@/lib/examples';
import { highlight } from '@/lib/highlight';

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

const Icon = {
  play: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>,
  pause: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>,
  prev: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  next: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  first: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 5l-7 7 7 7M7 5v14" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  last: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 5l7 7-7 7M17 5v14" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  edit: <svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 20h4L19 9l-4-4L4 16v4z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" /></svg>,
  reload: <svg viewBox="0 0 24 24" width="15" height="15"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  link: <svg viewBox="0 0 24 24" width="15" height="15"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>,
  sun: <svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="4" fill="currentColor" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
  moon: <svg viewBox="0 0 24 24" width="15" height="15"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="currentColor" /></svg>,
  clock: <svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>,
};

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
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [toast, setToast] = useState('');
  const loaded = useRef(false);

  useEffect(() => {
    const m = /#code=([\w-]+)/.exec(window.location.hash);
    const shared = m ? decodeShare(m[1]) : null;
    if (shared) { setCode(shared.c); setInput(shared.i || ''); }
    else {
      const c = lsGet(LS.code);
      if (c && !/[؀-ۿ]/.test(c)) setCode(c); else setExampleId(EXAMPLES[0].id);
      const i = lsGet(LS.input);
      if (i) setInput(i);
    }
    const th = lsGet(LS.theme);
    if (th === 'light' || th === 'dark') setTheme(th);
    else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) setTheme('dark');
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
    document.documentElement.setAttribute('data-theme', theme);
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
    try { await navigator.clipboard.writeText(url); setToast('Link copied'); setTimeout(() => setToast(''), 1600); } catch { window.prompt('', url); }
  };

  const onLineClick = (line: number) => {
    let j = snaps.findIndex((s, i) => i > idx && s.line === line);
    if (j < 0) j = snaps.findIndex((s) => s.line === line);
    if (j >= 0) { setPlaying(false); setIdx(j); }
  };

  const codeLines = useMemo(() => code.split('\n'), [code]);
  const stepLine = snap ? (codeLines[snap.line - 1] ?? '').trim() : '';
  const stepSegs = useMemo(() => highlight(stepLine)[0] ?? [], [stepLine]);

  const parseError = result?.parseError;
  const runError = snap && (snap.error || (snap.kind === 'input' ? snap.note : ''));
  const errLine = parseError ? parseError.line : runError ? snap!.line : undefined;
  const errMsg = parseError ? `Line ${parseError.line}: ${parseError.msg}` : runError;

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><span className="mark">C++</span><span className="name">Visualizer</span></div>
        <select className="select" value={exampleId} onChange={(e) => loadExample(e.target.value)} aria-label="Examples">
          <option value="">Examples</option>
          {EXAMPLES.map((e) => <option value={e.id} key={e.id}>{e.title}</option>)}
        </select>
        <div className="spacer" />
        <label className="field" title="Seconds per step">
          {Icon.clock}
          <input type="number" min={0.1} max={10} step={0.1} value={interval} onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) setIntervalSec(v); }} />
          <span className="unit">s</span>
        </label>
        <label className="switch" title="Start playing when you press Run">
          <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
          <span className="track"><span className="thumb" /></span>
          <span>Autoplay</span>
        </label>
        <div className="sep" />
        <button className="btn ghost sq" onClick={share} title="Copy share link">{Icon.link}</button>
        <button className="btn ghost sq" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Theme">{theme === 'dark' ? Icon.sun : Icon.moon}</button>
        {mode === 'edit' ? (
          <button className="btn primary" onClick={run} title="Ctrl+Enter">{Icon.play}<span>Run</span></button>
        ) : (
          <>
            <button className="btn" onClick={() => { setPlaying(false); setMode('edit'); }} title="Esc">{Icon.edit}<span>Edit</span></button>
            <button className="btn primary" onClick={run}>{Icon.reload}<span>Rerun</span></button>
          </>
        )}
      </header>

      <main className="main">
        <div className="left">
          <section className="card editor">
            <div className="card-h"><span className="file">main.cpp</span></div>
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
          {mode === 'edit' && (
            <section className="card io">
              <div className="card-h"><span className="file">stdin</span></div>
              <textarea className="stdin" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
            </section>
          )}
          <section className="card io">
            <div className="card-h"><span className="file">output</span></div>
            <Console out={mode === 'view' && snap ? snap.out : ''} />
          </section>
        </div>

        <section className="card stage">
          {mode === 'view' && snap && (
            <div className="stepbar">
              <span className="lnum">{snap.line}</span>
              <code className="lcode">{stepSegs.length ? stepSegs.map((s, i) => <span key={i} className={s.c}>{s.t}</span>) : '…'}</code>
            </div>
          )}
          {errMsg && <div className="error">{errMsg}</div>}
          <div className="canvas">
            {mode === 'view' && snap ? <SimpleView snap={snap} prev={prev} idx={idx} /> : null}
          </div>
          {mode === 'view' && snap && (
            <div className="player">
              <div className="buttons">
                <button className="btn ghost sq" onClick={() => { setPlaying(false); go(0); }} disabled={idx === 0} title="First">{Icon.first}</button>
                <button className="btn ghost sq" onClick={() => { setPlaying(false); go(idx - 1); }} disabled={idx === 0} title="Back">{Icon.prev}</button>
                <button className="btn primary round" onClick={() => { if (idx >= last) setIdx(0); setPlaying((p) => !p); }} title="Play / Pause">{playing ? Icon.pause : Icon.play}</button>
                <button className="btn ghost sq" onClick={() => { setPlaying(false); go(idx + 1); }} disabled={idx >= last} title="Next">{Icon.next}</button>
                <button className="btn ghost sq" onClick={() => { setPlaying(false); go(last); }} disabled={idx >= last} title="Last">{Icon.last}</button>
              </div>
              <input className="slider" type="range" min={0} max={last} value={idx} onChange={(e) => { setPlaying(false); setIdx(+e.target.value); }} style={{ ['--p' as any]: `${last ? (idx / last) * 100 : 0}%` }} />
              <span className="counter">{idx + 1} / {snaps.length}</span>
            </div>
          )}
        </section>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
