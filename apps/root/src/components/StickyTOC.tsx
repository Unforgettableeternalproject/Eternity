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

/** 導航欄高度（用於 scroll 偏移補正） */
const NAV_OFFSET = 80;

export default function StickyTOC() {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pastMain, setPastMain] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const tocRef = useRef<HTMLElement>(null);

  const scanHeadings = useCallback(() => {
    // 只在詳細頁面顯示 TOC（projects/[slug]、updates/[slug]）
    const path = window.location.pathname.replace(/\/$/, '');
    const isDetailPage =
      /^\/(zh-tw|en)?\/projects\/[^/]+$/.test(path) ||
      /^\/(zh-tw|en)?\/updates\/[^/]+$/.test(path);
    if (!isDetailPage) {
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

    // 為所有 heading 設定 scroll-margin-top，確保錨點跳轉也正確
    headings.forEach((h) => {
      (h as HTMLElement).style.scrollMarginTop = `${NAV_OFFSET + 16}px`;
    });

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
      { rootMargin: `${-NAV_OFFSET}px 0px -60% 0px` }
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

  // ── active 項目進入 TOC 可見範圍外時自動捲動 ──
  useEffect(() => {
    if (!activeId || !tocRef.current) return;
    const activeLink = tocRef.current.querySelector(
      `a[href="#${CSS.escape(activeId)}"]` // eslint-disable-line no-undef
    ) as HTMLElement | null;
    if (!activeLink) return;

    const containerRect = tocRef.current.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const padding = 30;

    if (linkRect.top < containerRect.top + padding) {
      // active 在可見範圍上方
      tocRef.current.scrollBy({
        top: linkRect.top - containerRect.top - padding,
        behavior: 'smooth',
      });
    } else if (linkRect.bottom > containerRect.bottom - padding) {
      // active 在可見範圍下方
      tocRef.current.scrollBy({
        top: linkRect.bottom - containerRect.bottom + padding,
        behavior: 'smooth',
      });
    }
  }, [activeId]);

  // ── footer 進入視窗時隱藏 TOC ──
  useEffect(() => {
    const footer = document.querySelector('footer');
    if (!footer) return;

    const io = new IntersectionObserver(
      ([entry]) => setPastMain(entry.isIntersecting),
      { threshold: 0 }
    );
    io.observe(footer);
    return () => io.disconnect();
  }, []);

  // 沒有標題時不渲染
  if (items.length === 0) return null;

  return (
    <nav
      ref={tocRef}
      className={`sticky-toc${pastMain ? ' sticky-toc--hidden' : ''}`}
      aria-label="Table of contents"
    >
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
                const target = document.getElementById(item.id);
                if (target) {
                  const y =
                    target.getBoundingClientRect().top +
                    window.scrollY -
                    NAV_OFFSET -
                    16;
                  window.scrollTo({ top: y, behavior: 'smooth' });
                }
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
