/**
 * UEP 浮島系統 — 解鎖提示的漸進解碼（2026-08-12）
 *
 * 偏好面板的鎖定列原本只有「未知的浮島 · 尚未喚醒」，刻意不透露解鎖方式。
 * 艾斯維爾 2026-08-12 定案推翻該原則：每座島給**一句**指向地點＋行為暗示的
 * 提示，未達熟悉度時部分字元遮蔽，隨探索逐步解密——分階模糊感由遮蔽比例
 * 代勞，不寫多段文案。
 *
 * 解碼比例的三個來源（映射見 unlockHintRevealRatio）：
 *   基礎 0.2 ＋ 造訪過該 zone（zone:visited:*）0.15
 *   ＋ zone 熟悉度計數（每次 ×0.02）
 * 封頂 0.9——**永遠不揭露全句**，最後一段留給儀式本身的發現感。
 *
 * 遮蔽是確定性的：以島 id 為 seed 算出固定的揭露順序，同一比例永遠露出
 * 同一批字（不隨 render 跳動），比例上升時已露出的字不會再被遮回去。
 */

import { useEffect } from 'react';

import { getProgressManager } from '../progress';
import type { ProgressState } from '../progress';
import { zoneVisitedFlag } from '../progress/uepFlags';

import { isIslandId } from './types';
import type { IslandId } from './types';
import { useCurrentLocation } from './useCurrentLocation';

/**
 * 各島的解鎖提示（硬編碼——與教學文案同一個定案：寫定就不太動的東西，
 * 不值得開 settings 表）。格式契約：指向地點＋行為暗示，**不點破機制**
 * （機率、點擊次數這類數字不出現）。
 */
export const ISLAND_UNLOCK_HINTS: Record<IslandId, string> = {
  history: '在歷史的長廊讀完一篇記述，或許會有誰的書籤悄悄遺落。',
  concepts: '調整房的終端偶爾會顯示斷線——那不是故障，去碰碰那道訊號。',
  echoes: '讓蒐藏間的回聲多流轉一會兒，有一枚失去色彩的聲音正在迷路。',
  visuals: '在重現室的展廊之間多走幾步，某個幻影並不屬於任何展區。',
  storage: '置物空間裡躺著一張孤零零的紙條，替它拂去積塵吧。',
};

/** 解碼比例：基礎值（沒去過該 zone 也能看出「有一句話在這裡」） */
const REVEAL_BASE = 0.2;
/** 造訪過該 zone（zone:visited:*）的跳升 */
const REVEAL_VISITED_BONUS = 0.15;
/** 每次熟悉度計數的步進 */
const REVEAL_PER_VISIT = 0.02;
/** 封頂——永遠不揭露全句，剩下的留給儀式本身 */
const REVEAL_MAX = 0.9;

/** 遮蔽字元（與站台掃描線／訊號美學一致的實心塊） */
const MASK_CHAR = '▓';

/**
 * 依進度算出該島提示的可讀比例（0~REVEAL_MAX）。
 * 已解鎖的島不會走到這裡（鎖定列只給未解鎖的島），不另做分支。
 */
export function unlockHintRevealRatio(
  state: ProgressState,
  islandId: IslandId
): number {
  const visited = state.flags.includes(zoneVisitedFlag(islandId));
  const familiarity = state.zoneFamiliarity[islandId] ?? 0;
  return Math.min(
    REVEAL_MAX,
    REVEAL_BASE +
      (visited ? REVEAL_VISITED_BONUS : 0) +
      familiarity * REVEAL_PER_VISIT
  );
}

/** mulberry32——確定性 PRNG。Math.random 會讓遮蔽位置每次 render 跳動 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字串 → 32-bit seed（FNV-1a） */
function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 可遮蔽的字元：字母與數字（含 CJK）。標點留著，句子的節奏要看得出來 */
const MASKABLE_RE = /[\p{L}\p{N}]/u;

/**
 * 依比例遮蔽提示句。揭露順序由 seed（島 id）決定的固定洗牌給出，
 * 取前 N 個為可讀——比例單調上升時揭露集合是前綴關係，已解密的字
 * 不會退回遮蔽。
 */
export function maskUnlockHint(
  islandId: IslandId,
  hint: string,
  ratio: number
): string {
  const chars = [...hint];
  const maskable: number[] = [];
  chars.forEach((ch, i) => {
    if (MASKABLE_RE.test(ch)) maskable.push(i);
  });
  if (maskable.length === 0) return hint;

  // Fisher–Yates（seeded）：這一座島的揭露順序永遠相同
  const order = [...maskable];
  const rand = mulberry32(hashSeed(islandId));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const revealCount = Math.round(
    maskable.length * Math.min(1, Math.max(0, ratio))
  );
  const revealed = new Set(order.slice(0, revealCount));
  return chars
    .map((ch, i) => (!MASKABLE_RE.test(ch) || revealed.has(i) ? ch : MASK_CHAR))
    .join('');
}

/** 面板消費用的一步到位版本 */
export function revealedUnlockHint(
  state: ProgressState,
  islandId: IslandId
): string {
  return maskUnlockHint(
    islandId,
    ISLAND_UNLOCK_HINTS[islandId],
    unlockHintRevealRatio(state, islandId)
  );
}

/**
 * zone 熟悉度追蹤——掛在 IslandHost（全站常駐；hooks 在守門 return null
 * 之前就會跑，訪客與手機的匿名足跡照樣累積，登入後隨 blob 同步）。
 *
 * 訊號是 location（pathname + search）變化且落在某 zone 內：五區 Reader
 * 都用 query string 切子頁（useZoneRouter 的 pushState/replaceState 會被
 * useCurrentLocation 的 monkey patch 派事件），所以不需要各 Reader 接線。
 * effect deps 天然去掉「同一 URL 重複派事件」；重複造訪同一頁刻意計入
 * （定案：重讀也是熟悉）。
 */
export function useZoneFamiliarityTracker(): void {
  const { pathname, search, zone } = useCurrentLocation();
  useEffect(() => {
    // 只數五大 zone——useCurrentLocation 的 zone 還會回 'home'（首頁的
    // 釘選便條身分），那不是任何一座島的地盤
    if (!isIslandId(zone)) return;
    getProgressManager().bumpZoneFamiliarity(zone);
    // pathname/search 進 deps 是刻意的：同 zone 內換子頁也要計數
  }, [pathname, search, zone]);
}
