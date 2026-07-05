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
  buildChapterEntries,
  buildTreeIndex,
  deriveLastRead,
  fetchHistoryTree,
  navigateToHistoryPage,
  progressRatio,
  volumeOf,
} from './historyIslandData';
import type { HistoryTreeIndex } from './historyIslandData';

import './HistoryIsland.css';

export default function HistoryIsland() {
  const progress = useProgress();
  const [index, setIndex] = useState<HistoryTreeIndex | null>(null);
  const [error, setError] = useState(false);

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
  const volume = useMemo(
    () => (index && lastRead ? volumeOf(lastRead.id, index) : null),
    [index, lastRead]
  );
  const chapters = useMemo(
    () =>
      index && volume
        ? buildChapterEntries(volume, progress, index, lastRead?.id ?? null)
        : [],
    [index, volume, progress, lastRead]
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
        {volume && volume.id !== lastRead.id && (
          <div className="uep-hisland__resume-volume">{volume.title}</div>
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

      {/* 章節列表：當前卷的目錄頁 */}
      {volume && chapters.length > 0 && (
        <div className="uep-hisland__chapters">
          <div className="uep-hisland__chapters-kicker">
            {volume.title} · 目錄
          </div>
          {chapters.map((entry) => {
            const ratio = progressRatio(entry);
            return (
              <button
                key={entry.node.id}
                type="button"
                className={`uep-hisland__chapter${entry.isCurrent ? ' is-current' : ''}${entry.locked ? ' is-locked' : ''}`}
                disabled={entry.locked}
                onClick={() => navigateToHistoryPage(entry.node.id)}
                title={
                  entry.locked
                    ? '尚未解鎖的章節'
                    : `前往「${entry.node.title}」`
                }
              >
                <span className="uep-hisland__chapter-title">
                  {entry.locked ? '🔒 ' : ''}
                  {entry.node.title}
                </span>
                {ratio !== null && !entry.locked && (
                  <span className="uep-hisland__chapter-progress">
                    <span className="uep-hisland__chapter-bar" aria-hidden>
                      <span
                        className="uep-hisland__chapter-bar-fill"
                        style={{ width: `${Math.round(ratio * 100)}%` }}
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
