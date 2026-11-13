'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeArea from './CodeArea';
import MemoryView from './MemoryView';
import SimpleView from './SimpleView';
import { runProgram } from '@/lib/cpp/interpreter';
import type { RunResult, Snapshot } from '@/lib/cpp/types';
import { EXAMPLES } from '@/lib/examples';

const LS_CODE = 'cppviz.code';
const LS_INPUT = 'cppviz.input';
const LS_THEME = 'cppviz.theme';
const LS_ADDR = 'cppviz.addr';

const KIND_LABEL: Record<string, string> = {
  start: 'بداية', step: 'خطوة', call: 'استدعاء', return: 'عودة', end: 'النهاية', error: 'خطأ', input: 'ينتظر إدخال',
};

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}

function encodeShare(code: string, input: string): string {
  const json = JSON.stringify({ c: code, i: input });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeShare(s: string): { c: string; i: string } | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

// Wrap runs of Latin/code text in LTR isolates so they read correctly inside Arabic sentences
const LTR_RUN = /[A-Za-z0-9_'"(\[*&!~<>=+\-.:#@{]+(?:[\x20-\x7E]*[A-Za-z0-9_)\]'";*}&>+\-])?/g;
function Bidi({ text }: { text: string }) {
  const clean = text.replace(/[⁦-⁩]/g, '');
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LTR_RUN.lastIndex = 0;
  while ((m = LTR_RUN.exec(clean))) {
    if (m.index > last) out.push(clean.slice(last, m.index));
    out.push(<bdi dir="ltr" className="ltr-run" key={m.index}>{m[0]}</bdi>);
    last = m.index + m[0].length;
  }
  if (last < clean.length) out.push(clean.slice(last));
  return <>{out}</>;
}

function Console({ out }: { out: string }) {
  if (!out) return <div className="console"><span className="empty">لا يوجد إخراج بعد (cout)</span></div>;
  const parts = out.split(/(\u0001[^\u0002]*\u0002)/);
  return (
    <div className="console">
      {parts.map((p, i) => (p.startsWith('\u0001') ? <span key={i} className="inp" title="قيمة من خانة الإدخال">{p.slice(1, -1)}</span> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </div>
  );
}

export default function Visualizer() {
  const [code, setCode] = useState<string>(EXAMPLES[0].code);
  const [input, setInput] = useState<string>('');
  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const [result, setResult] = useState<RunResult | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(700);
  const [showAddr, setShowAddr] = useState(false);
  const [simple, setSimple] = useState(true);
  const [exampleId, setExampleId] = useState<string>('');
  const [toast, setToast] = useState<string>('');
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const loaded = useRef(false);

  // load saved state / shared link
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const m = /#code=([\w-]+)/.exec(hash);
    const shared = m ? decodeShare(m[1]) : null;
    if (shared) {
      setCode(shared.c);
      setInput(shared.i || '');
    } else {
      const c = lsGet(LS_CODE);
      if (c) setCode(c);
      const i = lsGet(LS_INPUT);
      if (i) setInput(i);
      if (!c) setExampleId(EXAMPLES[0].id);
    }
    const th = lsGet(LS_THEME) as any;
    if (th === 'light' || th === 'dark') setTheme(th);
    setShowAddr(lsGet(LS_ADDR) === '1');
    setSimple(lsGet('cppviz.view') !== 'detail');
    // ?ex=<example-id>&step=<n>  opens an example directly in visualization mode
    const q = new URLSearchParams(window.location.search);
    const ex = EXAMPLES.find((e) => e.id === q.get('ex'));
    const qt = q.get('theme');
    if (qt === 'light' || qt === 'dark') setTheme(qt);
    if (ex || (shared && q.has('step'))) {
      const c = ex ? ex.code : shared!.c;
      const inp = ex ? ex.input ?? '' : shared!.i || '';
      if (ex) { setExampleId(ex.id); setCode(c); setInput(inp); }
      const r = runProgram(c, inp, 3000);
      setResult(r);
      if (!r.parseError) {
        const st = Math.max(1, parseInt(q.get('step') || '1', 10) || 1);
        setIdx(Math.min(st - 1, r.snaps.length - 1));
        setMode('view');
      }
    }
    loaded.current = true;
  }, []);

  useEffect(() => { if (loaded.current) lsSet(LS_CODE, code); }, [code]);
  useEffect(() => { if (loaded.current) lsSet(LS_INPUT, input); }, [input]);
  useEffect(() => { if (loaded.current) lsSet(LS_ADDR, showAddr ? '1' : '0'); }, [showAddr]);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
    if (loaded.current) lsSet(LS_THEME, theme);
  }, [theme]);

  const flash = (s: string) => { setToast(s); setTimeout(() => setToast(''), 2200); };

  const snaps = result?.snaps ?? [];
  const snap: Snapshot | undefined = snaps[idx];
  const prev = idx > 0 ? snaps[idx - 1] : undefined;
  const next = snaps[idx + 1];
  const last = snaps.length - 1;

  const run = useCallback(() => {
    setPlaying(false);
    const r = runProgram(code, input, 3000);
    setResult(r);
    if (r.parseError) { setMode('edit'); return; }
    setIdx(0);
    setMode('view');
  }, [code, input]);

  const go = useCallback((i: number) => setIdx(Math.max(0, Math.min(i, snaps.length - 1))), [snaps.length]);

  // autoplay
  useEffect(() => {
    if (!playing) return;
    if (idx >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setIdx((i) => i + 1), speed);
    return () => clearTimeout(t);
  }, [playing, idx, last, speed]);

  // keyboard
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
      else if (e.key === 'Escape') setMode('edit');
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
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#code=${encodeShare(code, input)}`;
    try { await navigator.clipboard.writeText(url); flash('تم نسخ رابط المشاركة ✔'); } catch { window.prompt('انسخ الرابط:', url); }
  };

  const onLineClick = (line: number) => {
    let j = snaps.findIndex((s, i) => i > idx && s.line === line);
    if (j < 0) j = snaps.findIndex((s) => s.line === line);
    if (j >= 0) { setPlaying(false); setIdx(j); } else flash('هذا السطر لم يُنفَّذ');
  };

  const groups = useMemo(() => {
    const g: Record<string, typeof EXAMPLES> = {};
    EXAMPLES.forEach((e) => { (g[e.group] ||= []).push(e); });
    return g;
  }, []);

  const parseError = result?.parseError;
  const errLine = parseError ? parseError.line : snap?.kind === 'error' || snap?.kind === 'input' ? snap.line : undefined;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo">C++</div>
          <div>
            <h1>مُصوِّر C++</h1>
            <small>شاهد المؤشرات والذاكرة تتحرك سطراً بسطر</small>
          </div>
        </div>
        <select className="select" value={exampleId} onChange={(e) => loadExample(e.target.value)} aria-label="أمثلة جاهزة">
          <option value="">📚 اختر مثالاً جاهزاً…</option>
          {Object.entries(groups).map(([g, list]) => (
            <optgroup label={g} key={g}>
              {list.map((e) => <option value={e.id} key={e.id}>{e.title}</option>)}
            </optgroup>
          ))}
        </select>
        {mode === 'edit' ? (
          <button className="btn primary" onClick={run} title="Ctrl + Enter">▶ تشغيل وتصوير</button>
        ) : (
          <>
            <button className="btn" onClick={() => { setPlaying(false); setMode('edit'); }} title="Esc">✏ تعديل الكود</button>
            <button className="btn primary" onClick={run}>⟳ إعادة التشغيل</button>
          </>
        )}
        <button className="btn ghost icon" onClick={share} title="نسخ رابط يحتوي على الكود">🔗</button>
        <button className="btn ghost icon" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark')} title={`المظهر: ${theme === 'auto' ? 'تلقائي' : theme === 'dark' ? 'داكن' : 'فاتح'}`}>
          {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🌓'}
        </button>
      </header>

      <main className="layout">
        <div className="col">
          <section className="panel code-panel">
            <div className="panel-head">
              <span>📝 الكود</span>
              <span className="hint">{mode === 'edit' ? 'اكتب أو الصق أي كود C++ ثم اضغط «تشغيل وتصوير»' : 'وضع المشاهدة — اضغط رقم سطر للقفز إليه'}</span>
              <span className="spacer" />
              {mode === 'view' && <span className="hint"><span style={{ color: 'var(--ok)' }}>➜</span> نُفّذ الآن · <span style={{ color: 'var(--ptr-hot)' }}>→</span> التالي</span>}
            </div>
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

          {parseError && (
            <div className="panel">
              <div className="parse-error">❌ خطأ في الكود (سطر {parseError.line}):<br /><Bidi text={parseError.msg} /></div>
            </div>
          )}

          {mode === 'view' && snap && (
            <section className="panel">
              <div className="controls">
                <div className="controls-row" dir="ltr">
                  <button className="btn icon" onClick={() => { setPlaying(false); go(0); }} disabled={idx === 0} title="البداية (Home)">⏮</button>
                  <button className="btn" onClick={() => { setPlaying(false); go(idx - 1); }} disabled={idx === 0} title="السابق (←)">◀ السابق</button>
                  <span className="step-count">{idx + 1} / {snaps.length}</span>
                  <button className="btn primary" onClick={() => { setPlaying(false); go(idx + 1); }} disabled={idx >= last} title="التالي (→)">التالي ▶</button>
                  <button className="btn icon" onClick={() => { setPlaying(false); go(last); }} disabled={idx >= last} title="النهاية (End)">⏭</button>
                  <span className="grow" />
                  <button className="btn" onClick={() => { if (idx >= last) setIdx(0); setPlaying((p) => !p); }} title="مسافة (Space)">{playing ? '⏸ إيقاف' : '⏵ تشغيل تلقائي'}</button>
                  <select className="select" value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="السرعة">
                    <option value={1400}>بطيء</option>
                    <option value={700}>عادي</option>
                    <option value={300}>سريع</option>
                    <option value={80}>سريع جداً</option>
                  </select>
                </div>
                <input className="slider" type="range" min={0} max={last} value={idx} onChange={(e) => { setPlaying(false); setIdx(+e.target.value); }} aria-label="الخطوة" />
              </div>
              <div className="note" style={{ borderTop: '1px solid var(--border)' }}>
                <span className={`note-kind kind-${snap.kind}`}>{KIND_LABEL[snap.kind]}</span>
                <span className="note-text">{snap.note.split('\n').map((l, i) => <React.Fragment key={i}>{i > 0 && <br />}<Bidi text={l} /></React.Fragment>)}</span>
                {snap.events.length > 0 && (
                  <ul className="note-events">
                    {snap.events.map((e, i) => <li key={i}><Bidi text={e} /></li>)}
                  </ul>
                )}
                {snap.error && <div className="note-error">{snap.error.split('\n').map((l, i) => <div key={i}><Bidi text={l} /></div>)}</div>}
              </div>
            </section>
          )}

          {mode === 'edit' && (
            <section className="panel">
              <div className="panel-head">
                <span>⌨ الإدخال (stdin)</span>
                <span className="hint">القيم التي سيقرأها cin بالترتيب — قيمة في كل سطر</span>
              </div>
              <textarea className="stdin" value={input} onChange={(e) => setInput(e.target.value)} placeholder={'مثال:\n5\n10'} spellCheck={false} />
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><span>🖥 الإخراج (cout)</span></div>
            <Console out={mode === 'view' && snap ? snap.out : ''} />
          </section>
        </div>

        <div className="col">
          <section className="panel mem-panel">
            <div className="panel-head">
              <span>🧠 الذاكرة</span>
              <span className="hint">{mode === 'view' && snap ? `سطر ${snap.line}` : ''}</span>
              <span className="spacer" />
              <div className="seg" role="tablist">
                <button className={simple ? 'on' : ''} onClick={() => { setSimple(true); lsSet('cppviz.view', 'simple'); }}>عرض مبسّط</button>
                <button className={!simple ? 'on' : ''} onClick={() => { setSimple(false); lsSet('cppviz.view', 'detail'); }}>عرض مفصّل</button>
              </div>
              {!simple && (
                <label className="hint" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showAddr} onChange={(e) => setShowAddr(e.target.checked)} /> العناوين
                </label>
              )}
            </div>
            <div className="mem-scroll">
              {mode === 'view' && snap ? (
                simple ? <SimpleView snap={snap} prev={prev} idx={idx} /> : <MemoryView snap={snap} prev={prev} idx={idx} showAddr={showAddr} />
              ) : (
                <div className="welcome">
                  <h2>كيف تستخدم المُصوِّر؟</h2>
                  <ol>
                    <li>اكتب كود C++ في المحرر (أو اختر مثالاً جاهزاً من القائمة بالأعلى).</li>
                    <li>إذا كان البرنامج يستخدم <code>cin</code> اكتب القيم في خانة «الإدخال».</li>
                    <li>اضغط <b>▶ تشغيل وتصوير</b> ثم تنقّل بالخطوات بـ <span className="kbd">→</span> و <span className="kbd">←</span> أو بالتشغيل التلقائي.</li>
                  </ol>
                  <p>سترى على اليمين:</p>
                  <ul>
                    <li><b>Stack</b>: إطار لكل دالة قيد التنفيذ ومتغيراتها المحلية.</li>
                    <li><b>Heap</b>: كل كائن يُنشأ بـ <code>new</code> — مثل <code>new Node(5)</code> — يظهر كصندوق جديد.</li>
                    <li><b>الأسهم</b>: كل مؤشر يُرسم سهماً نحو المكان الذي يشير إليه. <code>nullptr</code> يظهر بخط مائل.</li>
                    <li>التحذيرات: المتغيرات غير المهيأة <code>?</code>، المؤشرات المعلّقة بعد <code>delete</code>، وتسرّب الذاكرة.</li>
                  </ul>
                  <p style={{ fontSize: 13 }}>المدعوم: struct/class، constructors، المؤشرات والمراجع، new/delete، المصفوفات، الدوال والتكرار، vector و string، cin/cout. غير المدعوم حالياً: templates، الوراثة، operator overloading، STL عدا vector/string.</p>
                </div>
              )}
            </div>
            {simple ? (
            <div className="legend">
              <span><span className="lg-sw" style={{ background: 'var(--sn-ptr)' }} /> مؤشر (مثل head)</span>
              <span><span className="lg-sw" style={{ background: 'var(--sn-data)' }} /> القيمة (Data)</span>
              <span><span className="lg-sw" style={{ background: 'var(--sn-next)' }} /> عنوان العقدة التالية (Next)</span>
              <span><span className="lg-box new" /> عقدة جديدة</span>
              <span><span className="lg-box chg" /> تغيّرت قيمته</span>
              <span>؟ = لم تُعطَ قيمة</span>
            </div>
            ) : (
            <div className="legend">
              <span><span className="lg-line" /> مؤشر</span>
              <span><span className="lg-line d" /> مؤشر معلّق (بعد delete)</span>
              <span><span className="lg-line t" /> this</span>
              <span><span className="lg-line r" /> مرجع &amp;</span>
              <span><span className="lg-box new" /> جديد في هذه الخطوة</span>
              <span><span className="lg-box chg" /> تغيّرت قيمته</span>
              <span><span className="lg-box leak" /> تسرّب ذاكرة</span>
            </div>
            )}
          </section>
        </div>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
