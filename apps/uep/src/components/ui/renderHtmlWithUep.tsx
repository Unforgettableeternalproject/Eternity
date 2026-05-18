/* eslint-disable no-undef */
import React from 'react';
import UepDialogue from './UepDialogue';

/**
 * 將 HTML 字串渲染為 React 節點，遇到 [data-role="uep"] 時
 * 自動替換成完整的 UepDialogue 元件（大頭貼 + 氣泡框），
 * 其餘部分仍用 dangerouslySetInnerHTML 輸出。
 */
export default function renderHtmlWithUep(
  html: string,
  keyPrefix: string | number = 0,
  proseClass = 'sto-prose'
): React.ReactNode[] {
  if (!html || !html.includes('data-role="uep"')) {
    return [
      <div
        key={keyPrefix}
        className={proseClass}
        dangerouslySetInnerHTML={{ __html: html }}
      />,
    ];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const nodes: React.ReactNode[] = [];
  let htmlBuf = '';
  let idx = 0;

  function flushBuf() {
    const trimmed = htmlBuf.trim();
    if (trimmed) {
      nodes.push(
        <div
          key={`${keyPrefix}-h${idx}`}
          className={proseClass}
          dangerouslySetInnerHTML={{ __html: trimmed }}
        />
      );
      idx++;
    }
    htmlBuf = '';
  }

  doc.body.childNodes.forEach((child) => {
    if (child.nodeType === 1) {
      const el = child as HTMLElement;
      if (el.getAttribute('data-role') === 'uep') {
        flushBuf();
        const side =
          (el.getAttribute('data-side') as 'left' | 'right') || 'left';
        const text = el.textContent || '';
        nodes.push(
          <div
            key={`${keyPrefix}-u${idx}`}
            style={{
              margin: '14px 0',
              textAlign: side === 'right' ? 'right' : 'left',
            }}
          >
            <UepDialogue side={side} text={text} />
          </div>
        );
        idx++;
        return;
      }
    }
    // 非 UEP 節點：累積到 htmlBuf
    if (child.nodeType === 1) {
      htmlBuf += (child as HTMLElement).outerHTML;
    } else if (child.nodeType === 3 && child.textContent?.trim()) {
      htmlBuf += child.textContent;
    }
  });

  flushBuf();
  return nodes;
}
