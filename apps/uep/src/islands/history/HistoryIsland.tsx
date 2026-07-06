/**
 * History Island —「旅程之書」（Epic 2 S6 的第一座浮島）
 *
 * 功能定位（艾斯維爾 2026-07-05 定案）：輔助工具，快速回歸閱讀進度。
 * - 續讀：回到上次閱讀的頁面與位置（Reader 既有續讀機制接手滾動）
 * - 翻閱：當前卷的章節列表 + 進度比例 + 快速跳轉
 * - 統計：平均閱讀時間（樣本不足時不顯示）
 *
 * 設計語彙：history zone 的書卷/羊皮紙——設計稿無原型，諾薇亞自行設計。
 * S7/S8 預留：監聽 ISLAND_RELATED_EVENT 動態展示相關章節（合約已定，
 * 消費邏輯屆時實作）。
 *
 * 資料自理：tree 從 content API 取（模組級快取），進度從 progressStore
 * 訂閱——island 不依賴 HistoryReader 的 React 樹，跨 zone 均可使用。
 */

import React, { useEffect, useMemo, useState } from 'react';

import { useProgress } from '../../progress';

import {
  averageReadingMinutes,
  buildTreeIndex,
  buildUnlockedChapterList,
  deriveLastRead,
  displayProgressPct,
  fetchHistoryTree,
  navigateToHistoryPage,
  parentOf,
  progressRatio,
} from './historyIslandData';
import type { ChapterEntry, HistoryTreeIndex } from './historyIslandData';

import './HistoryIsland.css';

export default function HistoryIsland() {
  const progress = useProgress();
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

  /* ── 載入中 / 失敗 / 空白狀態 ── */
  if (error) {
    return (
      <div className="uep-hisland uep-hisland--empty">
        書頁暫時無法翻開——與檔案庫的連結中斷了。
      </div>
    );
  }
  if (!index) {
    return <div className="uep-hisland uep-hisland--empty">翻開書頁中……</div>;
  }
  if (!lastRead) {
    return (
      <div className="uep-hisland uep-hisland--empty">
        書頁還是空白的。
        <button
          type="button"
          className="uep-hisland__begin"
          onClick={() => navigateToHistoryPage('history')}
        >
          從 History 開始你的旅程 ›
        </button>
      </div>
    );
  }

  const lastMarker = progress.pageMarkers[lastRead.id];
  const lastPct =
    lastMarker && lastMarker.totalMarkers > 0
      ? Math.min(
          100,
          Math.round((lastMarker.maxMarkerIdx / lastMarker.totalMarkers) * 100)
        )
      : null;

  return (
    <div className="uep-hisland">
      {/* 續讀卡：夾在書裡的書籤 */}
      <div className="uep-hisland__resume">
        <div className="uep-hisland__resume-kicker">─ 書籤停在 ─</div>
        <div className="uep-hisland__resume-title">{lastRead.title}</div>
        {resumeParent && (
          <div className="uep-hisland__resume-volume">{resumeParent.title}</div>
        )}
        {lastPct !== null && (
          <div className="uep-hisland__resume-pct">讀到 {lastPct}%</div>
        )}
        <button
          type="button"
          className="uep-hisland__resume-btn"
          onClick={() => navigateToHistoryPage(lastRead.id)}
        >
          回到上次的位置 ›
        </button>
      </div>

      {/* 目錄（S6-2）：已解鎖 chapters，可展開為底下 arcs */}
      {chapterItems.length > 0 && (
        <div className="uep-hisland__chapters">
          <div className="uep-hisland__chapters-kicker">典藏目錄</div>
          {chapterItems.map((item) => {
            const expanded = expandOverride[item.node.id] ?? item.isCurrent;
            const hasArcs = item.arcs.length > 0;
            return (
              <div
                key={item.node.id}
                className={`uep-hisland__chapter-group${item.isCurrent ? ' is-current' : ''}`}
              >
                <div className="uep-hisland__chapter-row">
                  {hasArcs ? (
                    <button
                      type="button"
                      className="uep-hisland__chapter-caret"
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
                      className="uep-hisland__chapter-caret is-leaf"
                      aria-hidden
                    >
                      ·
                    </span>
                  )}
                  <button
                    type="button"
                    className={`uep-hisland__chapter${item.isCurrent ? ' is-current' : ''}`}
                    onClick={() => navigateToHistoryPage(item.node.id)}
                    title={`前往「${item.node.title}」`}
                  >
                    <span className="uep-hisland__chapter-title">
                      {item.node.title}
                    </span>
                    {item.total > 0 && (
                      <span className="uep-hisland__chapter-progress">
                        <span className="uep-hisland__chapter-bar" aria-hidden>
                          <span
                            className="uep-hisland__chapter-bar-fill"
                            style={{
                              // 1% 下限（S6-3）：已解鎖未讀完顯示 1% 而非 0%
                              width: `${displayProgressPct(item.completed, item.total)}%`,
                            }}
                          />
                        </span>
                        <span className="uep-hisland__chapter-count">
                          {item.completed}/{item.total}
                        </span>
                      </span>
                    )}
                  </button>
                </div>
                {expanded && hasArcs && (
                  <div className="uep-hisland__arcs">
                    {item.arcs.map((entry: ChapterEntry) => {
                      const ratio = progressRatio(entry);
                      return (
                        <button
                          key={entry.node.id}
                          type="button"
                          className={`uep-hisland__arc${entry.isCurrent ? ' is-current' : ''}${entry.locked ? ' is-locked' : ''}`}
                          disabled={entry.locked}
                          onClick={() => navigateToHistoryPage(entry.node.id)}
                          title={
                            entry.locked
                              ? '尚未解鎖的篇章'
                              : `前往「${entry.node.title}」`
                          }
                        >
                          <span className="uep-hisland__chapter-title">
                            {entry.locked ? '🔒 ' : ''}
                            {entry.node.title}
                          </span>
                          {ratio !== null && !entry.locked && (
                            <span className="uep-hisland__chapter-progress">
                              <span
                                className="uep-hisland__chapter-bar"
                                aria-hidden
                              >
                                <span
                                  className="uep-hisland__chapter-bar-fill"
                                  style={{
                                    // 1% 下限（S6-3）：同 chapter bar
                                    width: `${displayProgressPct(entry.completed, entry.total)}%`,
                                  }}
                                />
                              </span>
                              <span className="uep-hisland__chapter-count">
                                {entry.completed}/{entry.total}
                              </span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 統計 footer：樣本不足不顯示 */}
      <div className="uep-hisland__footer">
        <span>走過的篇章 {progress.completedPageIds.length}</span>
        {avgMinutes !== null && (
          <span>
            · 平均閱讀 {avgMinutes < 1 ? '不到 1' : Math.round(avgMinutes)} 分鐘
          </span>
        )}
      </div>
    </div>
  );
}
