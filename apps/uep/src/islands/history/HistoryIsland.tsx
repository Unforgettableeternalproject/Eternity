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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useProgress } from '../../progress';
import { useIslandChrome } from '../islandChrome';
import { subscribeRelated } from '../relatedBridge';
import type { IslandRelatedDetail } from '../types';

import {
  averageReadingMinutes,
  buildTreeIndex,
  buildUnlockedChapterList,
  collectTocCounts,
  deriveLastRead,
  diffTocCounts,
  fetchHistoryTree,
  fogAppliesTo,
  navigateToHistoryPage,
  parentOf,
  tocCount,
} from './historyIslandData';
import type { ChapterEntry, HistoryTreeIndex } from './historyIslandData';
import { getSeenTocCounts, setSeenTocCounts } from './tocSeen';

import islandCss from './HistoryIsland.css?inline';
import { useDeferredStyle } from '../useDeferredStyle';

const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 目錄頁碼變動高亮時長（ms）——與 HistoryIsland.css 的 uep-hisland-count-flash 對齊 */
const COUNT_FLASH_MS = 1600;

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

/** 跑馬燈的捲動速度（px/s）與最短時長——距離越長滑越久，讀得完 */
const MARQUEE_PX_PER_SEC = 40;
const MARQUEE_MIN_MS = 800;

/**
 * 截斷標題（2026-07-29）：超寬時以 … 收尾，hover 該列時跑馬燈滑到結尾。
 *
 * 超寬距離在指標進入時量測（寫成 CSS 變數 + is-overflowing class），
 * 滑動本身交給 CSS 的 :hover 規則——mount 時也量一次，避免指標從
 * 頁碼那側進入列時（沒碰到本元件）class 還沒就位。
 * reduced-motion 由 CSS 端整組停用，維持靜態省略號。
 */
function ScrollTitle({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const outerRef = useRef<HTMLSpanElement | null>(null);
  const measure = useCallback(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const overflow = outer.scrollWidth - outer.clientWidth;
    if (overflow > 1) {
      outer.style.setProperty('--marquee-shift', `-${overflow}px`);
      outer.style.setProperty(
        '--marquee-ms',
        `${Math.max(
          MARQUEE_MIN_MS,
          Math.round((overflow / MARQUEE_PX_PER_SEC) * 1000)
        )}ms`
      );
      outer.classList.add('is-overflowing');
    } else {
      outer.classList.remove('is-overflowing');
    }
  }, []);
  // 字型晚到會讓寬度變化，mount 量測可能過期——mouseenter 再量一次兜底
  useEffect(() => {
    measure();
  }, [measure, text]);
  return (
    <span
      ref={outerRef}
      className={`uep-hisland__marquee${className ? ` ${className}` : ''}`}
      onMouseEnter={measure}
    >
      <span className="uep-hisland__marquee-inner">{text}</span>
    </span>
  );
}

export default function HistoryIsland() {
  useDeferredStyle('history-island', islandCss);
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
  /**
   * 跨區互聯線索：讀者在別的 zone 停在某個 entity／劇情點時，這裡浮出
   * 「那個東西在哪些段落出現過」。
   *
   * 一次只留一則——新的進來直接取代舊的，不排隊。使用者點掉、換頁或
   * 重整就消失，不持久化。
   *
   * 走 relatedBridge 而非直接訂閱事件：島收合時這個元件根本沒有 mount，
   * 事件會整個漏掉。監聽常駐在 IslandHost，這裡只負責取件（含收合期間
   * 累積的那一則）。
   */
  const [related, setRelated] = useState<IslandRelatedDetail | null>(null);

  useEffect(() => subscribeRelated('history', setRelated), []);

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
  /**
   * 剛變動的目錄頁碼（S9-D.6）：讀完一篇進度文章後，對應章節的
   * 「7/19」會安靜地變成「8/19」。比對前後快照，讓變動的那幾條閃一下。
   * 首次算出的快照不算變動（那是「第一次看到」，不是「剛剛變了」）。
   *
   * 快照存 tocSeen bridge 而非元件 ref（2026-07-29）：島收合會 unmount，
   * ref 快照跟著蒸發——使用者被 chip 閃爍引來點開時，數字早已換好、
   * 什麼也不閃。「上次看到」跨收合保留後，重新展開會補播那次變動。
   */
  const [changedCounts, setChangedCounts] = useState<string[]>([]);
  useEffect(() => {
    // tree 還沒載入時 chapterItems 是空的——那不是「數字歸零」，
    // 不能拿去覆寫（或比對）真正看過的快照
    if (!index) return;
    const next = collectTocCounts(chapterItems);
    const prev = getSeenTocCounts();
    setSeenTocCounts(next);
    if (!prev) return;
    const changed = diffTocCounts(prev, next);
    if (changed.length === 0) return;
    setChangedCounts(changed);
    const timer = window.setTimeout(() => setChangedCounts([]), COUNT_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [index, chapterItems]);

  const avgMinutes = averageReadingMinutes(progress);

  /**
   * 閱讀進度改讀 fogRatio（S10-2）。舊算式的分母 `totalMarkers` 同時
   * 包含 hr 與 echo spot／visual clue 錨點——編輯內容就會讓讀者的
   * 百分比整個位移。ratio 是連續量，沒有這個問題。
   */
  const lastPct = (() => {
    if (!lastRead || !index) return null;
    if (progress.completedPageIds.includes(lastRead.id)) return 100;
    const ratio = progress.fogRatio[lastRead.id];
    if (ratio != null) return Math.min(100, Math.round(ratio * 100));
    // 尚無紀錄：首拍不再寫入 store（0.9.15.39）後，迷霧頁在掃描線
    // 移動前就是 0%；非迷霧頁本來就不追蹤，維持不顯示
    return fogAppliesTo(lastRead.id, index) ? 0 : null;
  })();

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
        {/* 跨區互聯線索：覆蓋在續讀區塊上方，一次一則 */}
        {related && related.items.length > 0 && (
          <div className="uep-hisland__related">
            <button
              type="button"
              className="uep-hisland__related-close"
              onClick={() => setRelated(null)}
              aria-label="關閉線索"
            >
              ×
            </button>
            <div className="uep-hisland__related-kicker">
              《{related.label ?? '這個'}》相關的段落
            </div>
            {/* 劇情點名稱與說明。名稱屬於劇情點不屬於任何一頁，所以放在
                清單上方一次，底下才是各錨點所在的段落。未命名時整段不畫
                ——空標題比沒有標題更難讀。 */}
            {related.keyTitle && (
              <div className="uep-hisland__related-title">
                {related.keyTitle}
              </div>
            )}
            {related.keyDescription && (
              <div className="uep-hisland__related-desc">
                {related.keyDescription}
              </div>
            )}
            <div className="uep-hisland__related-list">
              {related.items.map((item) => (
                <button
                  key={item.pageId}
                  type="button"
                  className="uep-hisland__related-item"
                  onClick={() => {
                    setRelated(null);
                    navigateToHistoryPage(item.pageId);
                  }}
                >
                  {/* 標題以自己的目錄樹為準，好與下方「典藏目錄」一致；
                      樹裡查不到才退回 payload 自帶的頁面標題 */}
                  {index?.nodesById.get(item.pageId)?.title ?? item.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 續讀：書籤停在哪一頁 */}
        {lastPct !== null && (
          <div className="uep-hisland__pct">讀到 {lastPct}%</div>
        )}
        <div className="uep-hisland__resume-kicker">書籤停在</div>
        <div className="uep-hisland__resume-title" title={lastRead.title}>
          <ScrollTitle
            className="uep-hisland__resume-title-text"
            text={lastRead.title}
          />
          <span
            className={`uep-hisland__resume-state${
              progress.completedPageIds.includes(lastRead.id) ? ' is-done' : ''
            }`}
          >
            {progress.completedPageIds.includes(lastRead.id)
              ? '已閱畢'
              : '閱讀中'}
          </span>
        </div>
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
                      <ScrollTitle
                        className="uep-hisland__toc-title"
                        text={item.node.title}
                      />
                      <span className="uep-hisland__toc-leader" aria-hidden />
                      {item.total > 0 && (
                        <span
                          className={`uep-hisland__toc-count${changedCounts.includes(item.node.id) ? ' is-changed' : ''}`}
                        >
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
                          <ScrollTitle
                            className="uep-hisland__toc-title"
                            text={entry.node.title}
                          />
                          <span
                            className="uep-hisland__toc-leader"
                            aria-hidden
                          />
                          {(entry.total > 0 || entry.locked) && (
                            <span
                              className={`uep-hisland__toc-count${changedCounts.includes(entry.node.id) ? ' is-changed' : ''}`}
                            >
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
        <div className="uep-island-title uep-hisland__title">旅程之書</div>
        <div className="uep-hisland__rule" aria-hidden />
      </div>

      {chrome.bare && (
        <button
          type="button"
          className="uep-island-close uep-hisland__close"
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
