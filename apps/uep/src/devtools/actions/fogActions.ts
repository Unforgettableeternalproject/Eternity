/**
 * 進度迷霧 DevTools actions（S10-2 遮蔽機制的測試工具，2026-07-29）
 *
 * 迷霧的狀態散在三處：store 的 `fogRatio`（持久化的迷霧線）、Reader
 * 記憶體裡的積分基準（首拍後不寫 store，見 HistoryReader.sampleFog）、
 * 以及捲動容器的即時幾何。手動測試遮蔽事件時肉眼對不出這三者的關係，
 * 這裡把它們攤開，並提供「散盡／推進／重罩」三個撥桿。
 *
 * pageId 一律以 `lastVisitedPageId` 為預設值彈輸入框——迷霧只存在於
 * History 文章頁，該欄位在進頁當下就會更新。
 */

import {
  FOG_JUMP_THRESHOLD_VH,
  computeContentRatio,
  isNonScrollable,
} from '../../progress';
import { getRegistry } from '../actionRegistry';

const GROUP = '進度迷霧';

/** History 文章的捲動容器（迷霧座標系的參考框） */
function historyScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.history-content');
}

/** 彈輸入框選 pageId，預設帶最後造訪頁 */
function promptPageId(): string | null {
  const fallback = window.__uepProgress?.getState().lastVisitedPageId ?? '';
  const raw = window.prompt('輸入 pageId（預設＝最後造訪頁）', fallback);
  if (raw === null) return null;
  const pageId = raw.trim();
  return pageId || null;
}

export function registerFogActions(): void {
  const registry = getRegistry();
  registry.register([
    {
      group: GROUP,
      id: 'fog:status',
      label: '傾印本頁迷霧狀態到 console',
      description:
        '迷霧線 store 值、首屏線下限、跳躍可及上限、讀者位置、完成/短文豁免',
      execute: async () => {
        const state = window.__uepProgress?.getState();
        const pageId = state?.lastVisitedPageId ?? null;
        const scroller = historyScroller();
        const stored = pageId ? (state?.fogRatio[pageId] ?? null) : null;
        const geometry = scroller
          ? {
              scrollTop: scroller.scrollTop,
              clientHeight: scroller.clientHeight,
              scrollHeight: scroller.scrollHeight,
              nonScrollable: isNonScrollable(
                scroller.scrollHeight,
                scroller.clientHeight
              ),
              /** 首屏線下限（首拍不寫 store 後，渲染端的最低顯影位置） */
              firstScreenFloor: computeContentRatio(
                0,
                scroller.clientHeight,
                scroller.scrollHeight
              ),
              /** 讀者目前位置換算的 ratio（掃描線 80% 線） */
              readerRatio: computeContentRatio(
                scroller.scrollTop,
                scroller.clientHeight,
                scroller.scrollHeight
              ),
              /** 跳躍門檻的可及上限：標記 ratio 超過此值會被閘門吃掉 */
              fogReachLimit:
                (stored ?? 0) +
                (FOG_JUMP_THRESHOLD_VH * scroller.clientHeight) /
                  scroller.scrollHeight,
            }
          : null;
        const dump = {
          pageId,
          storedFogRatio: stored,
          completed: pageId
            ? (state?.completedPageIds.includes(pageId) ?? false)
            : false,
          geometry,
        };
        // eslint-disable-next-line no-console
        console.log('[UEP Fog State]', dump);
        try {
          await navigator.clipboard.writeText(JSON.stringify(dump, null, 2));
        } catch {
          /* 剪貼簿權限沒了就算了，console 看得到就夠 */
        }
      },
    },
    {
      group: GROUP,
      id: 'fog:reveal',
      label: '散盡本頁迷霧（fogRatio → 1）',
      description: '事件遮蔽立即全解；配合捲到底可觸發完成判定',
      execute: () => {
        const pageId = promptPageId();
        if (!pageId) return;
        window.__uepProgress?.advanceFog(pageId, 1);
      },
    },
    {
      group: GROUP,
      id: 'fog:catch-up',
      label: '迷霧推進到讀者目前位置',
      description: '跳過速率上限與跳躍門檻，模擬「迷霧追上了」的狀態',
      execute: () => {
        const scroller = historyScroller();
        if (!scroller) {
          window.alert('找不到 .history-content——請在 History 文章頁使用');
          return;
        }
        const pageId = promptPageId();
        if (!pageId) return;
        window.__uepProgress?.advanceFog(
          pageId,
          computeContentRatio(
            scroller.scrollTop,
            scroller.clientHeight,
            scroller.scrollHeight
          )
        );
      },
    },
    {
      group: GROUP,
      id: 'fog:reset-page',
      label: '重罩本頁（清足跡重測）',
      description:
        '清除本頁 completed／完成旗標／fogRatio／pageMarkers 後重載——遮蔽事件可重測',
      destructive: true,
      requiresConfirm: true,
      confirmMessage: '確認抹除這一頁的閱讀足跡並重載？（收藏旗標不受影響）',
      execute: () => {
        const pageId = promptPageId();
        if (!pageId) return;
        window.__uepProgress?.resetPageProgress(pageId);
        window.location.reload();
      },
    },
  ]);
}
