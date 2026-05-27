/**
 * StickyTOC — Quartz 風格的右側 sticky 目錄
 * 獨立於 widget 系統，只在有 h2/h3 的頁面顯示
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export default function StickyTOC() {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const scanHeadings = useCallback(() => {
    // 首頁不顯示 TOC（每個區塊都是 section，列出來沒意義）
    const path = window.location.pathname;
    const isHome =
      path === '/' ||
      path === '/zh-tw' ||
      path === '/zh-tw/' ||
      path === '/en' ||
      path === '/en/';
    if (isHome) {
      setItems([]);
      return;
    }

    const main = document.querySelector('main');
    if (!main) return;

    const headings = Array.from(main.querySelectorAll('h2, h3')).filter(
      (el) => {
        // 排除卡片、隱藏元素內的標題
        if (
          el.closest(
            '.card, .flip-card, [data-card-id], .project-card, [data-widget]'
          )
        )
          return false;
        const htmlEl = el as HTMLElement;
        if (
          htmlEl.offsetParent === null ||
          htmlEl.classList.contains('hidden') ||
          el.closest('.hidden')
        )
          return false;
        return true;
      }
    );

    if (headings.length === 0) {
      setItems([]);
      return;
    }

    const tocItems: TocItem[] = headings.map((h, i) => {
      if (!h.id) h.id = `toc-heading-${i}`;
      return {
        id: h.id,
        text: h.textContent?.trim() || '',
        level: h.tagName === 'H2' ? 2 : 3,
      };
    });

    setItems(tocItems);

    // 重建 IntersectionObserver
    if (observerRef.current) observerRef.current.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        // 找到最上方可見的 heading
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px' }
    );

    headings.forEach((h) => observer.observe(h));
    observerRef.current = observer;
  }, []);

  useEffect(() => {
    // 初始掃描
    scanHeadings();

    // View Transitions 後重新掃描
    const handlePageLoad = () => {
      // 延遲一小段，等 DOM 完全就位
      setTimeout(scanHeadings, 100);
    };
    document.addEventListener('astro:page-load', handlePageLoad);

    return () => {
      document.removeEventListener('astro:page-load', handlePageLoad);
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [scanHeadings]);

  // 沒有標題時不渲染
  if (items.length === 0) return null;

  return (
    <nav className="sticky-toc" aria-label="Table of contents">
      <div className="sticky-toc__label">on this page</div>
      <ul className="sticky-toc__list">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={[
                'sticky-toc__link',
                item.level === 3 ? 'sticky-toc__link--h3' : '',
                activeId === item.id ? 'sticky-toc__link--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(item.id)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
