'use client';
import React, { useEffect, useMemo, useRef } from 'react';
import { highlight } from '@/lib/highlight';

interface Props {
  code: string;
  onChange?: (s: string) => void;
  readOnly: boolean;
  curLine?: number;
  nextLine?: number;
  errLine?: number;
  onLineClick?: (line: number) => void;
}

export default function CodeArea({ code, onChange, readOnly, curLine, nextLine, errLine, onLineClick }: Props) {
  const lines = useMemo(() => highlight(code), [code]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // keep current line visible
  useEffect(() => {
    const line = errLine || curLine;
    if (!line || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (!el) return;
    const sc = scrollRef.current;
    const top = el.offsetTop;
    if (top < sc.scrollTop + 30 || top > sc.scrollTop + sc.clientHeight - 60) {
      sc.scrollTo({ top: Math.max(0, top - sc.clientHeight / 3), behavior: 'smooth' });
    }
  }, [curLine, errLine]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: en, value } = ta;
    const apply = (nv: string, caret: number) => {
      onChange?.(nv);
      requestAnimationFrame(() => {
        if (taRef.current) { taRef.current.selectionStart = taRef.current.selectionEnd = caret; }
      });
    };
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        const ls = value.lastIndexOf('\n', s - 1) + 1;
        const m = /^ {1,4}/.exec(value.slice(ls));
        if (m) apply(value.slice(0, ls) + value.slice(ls + m[0].length), Math.max(ls, s - m[0].length));
        return;
      }
      apply(value.slice(0, s) + '    ' + value.slice(en), s + 4);
    } else if (e.key === 'Enter') {
      const ls = value.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(value.slice(ls))![0];
      const before = value.slice(0, s).trimEnd();
      const extra = before.endsWith('{') ? '    ' : '';
      e.preventDefault();
      const after = value.slice(en);
      if (extra && after.trimStart().startsWith('}') && /^[ \t]*}/.test(after)) {
        const ins = '\n' + indent + extra + '\n' + indent;
        apply(value.slice(0, s) + ins + after.replace(/^[ \t]*/, ''), s + 1 + indent.length + extra.length);
      } else {
        const ins = '\n' + indent + extra;
        apply(value.slice(0, s) + ins + after, s + ins.length);
      }
    } else if (e.key === '}' ) {
      const ls = value.lastIndexOf('\n', s - 1) + 1;
      const lineBefore = value.slice(ls, s);
      if (/^[ \t]+$/.test(lineBefore) && lineBefore.length >= 4) {
        e.preventDefault();
        const nb = lineBefore.slice(0, lineBefore.length - 4);
        apply(value.slice(0, ls) + nb + '}' + value.slice(en), ls + nb.length + 1);
      }
    }
  };

  return (
    <div className="code-scroll" ref={scrollRef}>
      <div className="code-inner">
        <div className={'gutter' + (onLineClick ? ' clickable' : '')}>
          {lines.map((_, i) => {
            const n = i + 1;
            const mark = n === errLine ? '✖' : n === curLine ? '➜' : n === nextLine ? '→' : '';
            const mc = n === errLine ? 'err' : n === curLine ? 'cur' : n === nextLine ? 'next' : '';
            return (
              <div className="ln" key={n} onClick={onLineClick ? () => onLineClick(n) : undefined} title={onLineClick ? 'Jump to this line' : undefined}>
                <span className={'mark ' + mc}>{mark}</span>
                <span className="num">{n}</span>
              </div>
            );
          })}
        </div>
        <div className="code-lines">
          <pre aria-hidden={!readOnly}>
            {lines.map((segs, i) => {
              const n = i + 1;
              const cls = n === errLine ? ' err' : n === curLine ? ' cur' : n === nextLine ? ' next' : '';
              return (
                <div className={'cline' + cls} key={i} data-line={n}>
                  {segs.length ? segs.map((s, j) => (s.c ? <span key={j} className={s.c}>{s.t}</span> : <React.Fragment key={j}>{s.t}</React.Fragment>)) : ' '}
                </div>
              );
            })}
          </pre>
          {!readOnly && (
            <textarea
              ref={taRef}
              className="code-ta"
              value={code}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              wrap="off"
              dir="ltr"
              onChange={(e) => onChange?.(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="C++ editor"
            />
          )}
        </div>
      </div>
    </div>
  );
}
