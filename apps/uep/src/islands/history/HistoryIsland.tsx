/**
 * History Island —「旅程之書」（Epic 2 S6 的第一座浮島）
 *
 * 功能定位（艾斯維爾 2026-07-05 定案）：輔助工具，快速回歸閱讀進度。
 * - 續讀：回到上次閱讀的頁面與位置（Reader 既有續讀機制接手滾動）
 * - 翻閱：當前卷的章節列表 + 進度比例 + 快速跳轉
 * - 統計：平均閱讀時間（樣本不足時不顯示）
 *
 * 視覺（S9-C.2，v2 設計稿提案 A「一頁書」）：整座島就是一張書頁——
 * 白框 header 消失，書名與雙線規印在紙上，緞帶書籤從頁緣垂下。
 * 章節進度條全部改成「引導點 + 虛線 leader + 篇數頁碼」，同樣的資訊
 * 只佔一行，垂直空間省下近一半。
 *
 * 資料自理：tree 從 content API 取（模組級快取），進度從 progressStore
 * 訂閱——island 不依賴 HistoryReader 的 React 樹，跨 zone 均可使用。
 */

import React, { useEffect, useMemo, useState } from 'react';

import { useProgress } from '../../progress';
import { useIslandChrome } from '../islandChrome';

import {
  averageReadingMinutes,
  buildTreeIndex,
  buildUnlockedChapterList,
  deriveLastRead,
  fetchHistoryTree,
  navigateToHistoryPage,
  parentOf,
} from './historyIslandData';
import type { ChapterEntry, HistoryTreeIndex } from './historyIslandData';

import './HistoryIsland.css';

const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * 版心頁碼用的中文數字（`— 三 —`）。
 * 超過兩位數就退回阿拉伯數字——那已經超出「頁碼」這個裝飾的表現範圍，
 * 硬轉只會變成一長串看不懂的字。
 */
function toChineseNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 10) return CN_DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens > 1 ? CN_DIGITS[tens] : ''}十${ones ? CN_DIGITS[ones] : ''}`;
}

/** 目錄條目的篇數頁碼；未解鎖顯示「封」而非 0/0 */
function tocCount(entry: {
  completed: number;
  total: number;
  locked?: boolean;
}): string {
  if (entry.locked) return '封';
  return `${entry.completed}/${entry.total}`;
}

export default function HistoryIsland() {
  const progress = useProgress();
  const chrome = useIslandChrome();
  const [index, setIndex] = useState<HistoryTreeIndex | null>(null);
  const [error, setError] = useState(false);
  /**
   * 目錄展開狀態（S6-2）：使用者手動開合的覆寫，未覆寫時
   * lastRead 鏈上的 chapter 預設展開。session 內有效，不進 localStorage。
   */
  const [expandOverride, setExpandOverride] = useState<Record<string, boolean>>(
    {}
  );

  /* tree 載入（模組級快取，重開視窗不重抓） */
  useEffect(() => {
    let cancelled = false;
    fetchHistoryTree()
      .then((roots) => {
        if (!cancelled) setIndex(buildTreeIndex(roots));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const lastRead = useMemo(
    () => (index ? deriveLastRead(progress, index) : null),
    [index, progress]
  );
  /** 續讀 kicker：直接上層（Section→arc、Arc→chapter、Chapter→null） */
  const resumeParent = useMemo(
    () => (index && lastRead ? parentOf(lastRead.id, index) : null),
    [index, lastRead]
  );
  const chapterItems = useMemo(
    () =>
      index
        ? buildUnlockedChapterList(index, progress, lastRead?.id ?? null)
        : [],
    [index, progress, lastRead]
  );
  const avgMinutes = averageReadingMinutes(progress);

  const lastMarker = lastRead ? progress.pageMarkers[lastRead.id] : undefined;
  const lastPct =
    lastMarker && lastMarker.totalMarkers > 0
      ? Math.min(
          100,
          Math.round((lastMarker.maxMarkerIdx / lastMarker.totalMarkers) * 100)
        )
      : null;

  /* ── 書頁內容：載入中 / 失敗 / 空白 / 正常 ── */
  function renderBody() {
    if (error) {
      return (
        <p className="uep-hisland__note">
          書頁暫時無法翻開——與檔案庫的連結中斷了。
        </p>
      );
    }
    if (!index) {
      return <p className="uep-hisland__note">翻開書頁中……</p>;
    }
    if (!lastRead) {
      return (
        <p className="uep-hisland__note">
          書頁還是空白的。
          <button
            type="button"
            className="uep-hisland__begin"
            onClick={() => navigateToHistoryPage('history')}
          >
            從 History 開始你的旅程 ›
          </button>
        </p>
      );
    }

    return (
      <>
        {/* 續讀：書籤停在哪一頁 */}
        {lastPct !== null && (
          <div className="uep-hisland__pct">讀到 {lastPct}%</div>
        )}
        <div className="uep-hisland__resume-kicker">書籤停在</div>
        <div className="uep-hisland__resume-title">{lastRead.title}</div>
        {resumeParent && (
          <div className="uep-hisland__resume-volume">{resumeParent.title}</div>
        )}
        <button
          type="button"
          className="uep-hisland__resume-btn"
          onClick={() => navigateToHistoryPage(lastRead.id)}
        >
          回到上次的位置 ›
        </button>

        {/* 典藏目錄（S6-2 兩層；S9-C.2 改引導點 + 頁碼） */}
        {chapterItems.length > 0 && (
          <div className="uep-hisland__chapters">
            <div className="uep-hisland__chapters-kicker">典藏目錄</div>
            {chapterItems.map((item) => {
              const expanded = expandOverride[item.node.id] ?? item.isCurrent;
              const hasArcs = item.arcs.length > 0;
              return (
                <div
                  key={item.node.id}
                  className="uep-hisland__chapter-group"
                  data-current={item.isCurrent ? '' : undefined}
                >
                  <div className="uep-hisland__toc-row">
                    {hasArcs ? (
                      <button
                        type="button"
                        className="uep-hisland__toc-bullet"
                        aria-expanded={expanded}
                        aria-label={
                          expanded
                            ? `收合「${item.node.title}」`
                            : `展開「${item.node.title}」`
                        }
                        onClick={() =>
                          setExpandOverride((prev) => ({
                            ...prev,
                            [item.node.id]: !expanded,
                          }))
                        }
                      >
                        {expanded ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span
                        className="uep-hisland__toc-bullet is-leaf"
                        aria-hidden
                      >
                        ·
                      </span>
                    )}
                    <button
                      type="button"
                      className={`uep-hisland__toc${item.isCurrent ? ' is-current' : ''}`}
                      onClick={() => navigateToHistoryPage(item.node.id)}
                      title={`前往「${item.node.title}」`}
                    >
                      <span className="uep-hisland__toc-title">
                        {item.node.title}
                      </span>
                      <span className="uep-hisland__toc-leader" aria-hidden />
                      {item.total > 0 && (
                        <span className="uep-hisland__toc-count">
                          {tocCount(item)}
                        </span>
                      )}
                    </button>
                  </div>
                  {expanded &&
                    hasArcs &&
                    item.arcs.map((entry: ChapterEntry) => (
                      <div
                        key={entry.node.id}
                        className="uep-hisland__toc-row is-sub"
                      >
                        <span
                          className="uep-hisland__toc-bullet is-leaf"
                          aria-hidden
                        >
                          ·
                        </span>
                        <button
                          type="button"
                          className={`uep-hisland__toc${entry.isCurrent ? ' is-current' : ''}${entry.locked ? ' is-locked' : ''}`}
                          disabled={entry.locked}
                          onClick={() => navigateToHistoryPage(entry.node.id)}
                          title={
                            entry.locked
                              ? '尚未解鎖的篇章'
                              : `前往「${entry.node.title}」`
                          }
                        >
                          <span className="uep-hisland__toc-title">
                            {entry.node.title}
                          </span>
                          <span
                            className="uep-hisland__toc-leader"
                            aria-hidden
                          />
                          {(entry.total > 0 || entry.locked) && (
                            <span className="uep-hisland__toc-count">
                              {tocCount(entry)}
                            </span>
                          )}
                        </button>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        )}

        {/* 版心頁腳：頁碼 + 統計 */}
        <div className="uep-hisland__footer">
          <em className="uep-hisland__folio">
            — {toChineseNumeral(progress.completedPageIds.length)} —
          </em>
          <span>走過的篇章 {progress.completedPageIds.length}</span>
          {avgMinutes !== null && (
            <span>
              · 平均閱讀 {avgMinutes < 1 ? '不到 1' : Math.round(avgMinutes)}{' '}
              分鐘
            </span>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="uep-hisland">
      {/* 從頁緣垂下的緞帶書籤（純裝飾） */}
      <span className="uep-hisland__ribbon" aria-hidden />

      {/* 書名列同時是拖曳把手——設計稿沒有 header，紙上的書名就是把手 */}
      <div className="uep-hisland__masthead" {...chrome.dragHandleProps}>
        <div className="uep-hisland__title">旅程之書</div>
        <div className="uep-hisland__rule" aria-hidden />
      </div>

      {chrome.bare && (
        <button
          type="button"
          className="uep-hisland__close"
          onClick={chrome.requestClose}
          aria-label="收合旅程之書"
          title="收合"
        >
          闔上
        </button>
      )}

      {renderBody()}
    </div>
  );
}
