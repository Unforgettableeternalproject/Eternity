/**
 * Storage 解鎖通知 dev 測試 bridge
 *
 * 手動驗收這條鏈的痛點與浮島解鎖同源：通知的觸發條件是「gate 剛剛從擋住
 * 變成通過」，一旦旗標拿到了就再也復現不了那一瞬間——而且它還要求島已解鎖、
 * 條目真的帶 gate、進度變更的 source 不是 hydrate。要靠真實操作湊齊這些
 * 條件才看得到一次卡片，太貴。
 *
 * `status()` 是這裡最有用的東西：通知沒出現時，它直接指出是哪一環沒到位
 * （索引是空的？沒有任何條目被擋？還是 pending 卡在收合狀態）。
 *
 * 掛載點在 IslandHost——偵測用的索引與基準集合都在那裡，其他地方拿不到。
 */

import { isTestMode } from '../../lib/apiBase';
import { isGateBlocked } from '../../components/storage/storageVisibility';

import {
  clearUnlockNotice,
  hasPendingUnlockNotice,
  pushUnlockNotice,
} from './unlockNotice';

import type { ProgressState } from '../../progress';
import type { StorageDialogueEntry } from './storageDialogueIndex';

interface StorageNoticeStatus {
  /** 索引到的「帶 gate 的 storage 條目」數量；0 代表索引還沒到手或站上沒有 gated 對話 */
  indexed: number;
  /** 目前被擋住（讀者看不到）的 slug */
  blocked: string[];
  /** 目前通過的 slug */
  visible: string[];
  /** 是否有尚未送達的通知（島收合中） */
  pending: boolean;
}

interface StorageNoticeTestBridge {
  /**
   * 強制推一則通知，不必真的解鎖。
   * 未指定 slug 時優先挑目前被擋住的條目——那才是真實情境下會被通知的對象。
   */
  force(slug?: string): void;
  /** 清掉目前顯示中與 pending 的通知 */
  clear(): void;
  /** 傾印索引與目前的 gate 求值結果 */
  status(): StorageNoticeStatus;
}

declare global {
  interface Window {
    __uepStorageNoticeTest?: StorageNoticeTestBridge;
  }
}

interface BridgeDeps {
  /** 目前的對話索引（尚未載入時回 null） */
  getIndex: () => StorageDialogueEntry[] | null;
  getProgress: () => ProgressState;
}

/**
 * 掛上 bridge，回傳 cleanup。掛載條件與 `mountIslandsTestBridge` 一致：
 * 本地開發或 test worker 才掛，production + prod worker 下整段被 tree-shake。
 */
export function mountUnlockNoticeTestBridge(deps: BridgeDeps): () => void {
  if (!import.meta.env.DEV && !isTestMode()) return () => {};

  function partition(): { blocked: string[]; visible: string[] } {
    const entries = deps.getIndex() ?? [];
    const progress = deps.getProgress();
    const blocked: string[] = [];
    const visible: string[] = [];
    for (const entry of entries) {
      if (isGateBlocked({ metadata: entry.metadata }, progress)) {
        blocked.push(entry.slug);
      } else {
        visible.push(entry.slug);
      }
    }
    return { blocked, visible };
  }

  const bridge: StorageNoticeTestBridge = {
    force(slug) {
      const entries = deps.getIndex();
      if (!entries || entries.length === 0) {
        console.warn(
          '[__uepStorageNoticeTest] 對話索引尚未載入或站上沒有帶 gate 的 storage 條目——' +
            '先確認 storage tree 抓得到，或用 pnpm test:fixtures 灌驗收素材'
        );
        return;
      }
      const target = slug
        ? entries.find((e) => e.slug === slug)
        : // 沒指定就挑被擋住的那一個，貼近真實情境；全通過時退回第一筆
          (entries.find((e) =>
            isGateBlocked({ metadata: e.metadata }, deps.getProgress())
          ) ?? entries[0]);
      if (!target) {
        console.warn(
          `[__uepStorageNoticeTest] 索引裡找不到 slug「${slug}」，可用：${entries
            .map((e) => e.slug)
            .join(', ')}`
        );
        return;
      }
      pushUnlockNotice({ slug: target.slug, title: target.title });
    },
    clear() {
      clearUnlockNotice();
    },
    status() {
      const { blocked, visible } = partition();
      return {
        indexed: blocked.length + visible.length,
        blocked,
        visible,
        pending: hasPendingUnlockNotice(),
      };
    },
  };

  window.__uepStorageNoticeTest = bridge;
  return () => {
    if (window.__uepStorageNoticeTest === bridge) {
      delete window.__uepStorageNoticeTest;
    }
  };
}
