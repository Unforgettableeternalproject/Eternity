/* global TextEncoder */
/**
 * ProgressState blob 的體積基準（S10-4 D 段）
 *
 * 進度以**單一 JSON blob** 存進 D1，上限 128KB。這個限制自 S9 便條擴充起
 * 就被標成殘留風險，但一直沒有實測基準——每次要加欄位時只能靠直覺說
 * 「這個很小應該沒差」。
 *
 * 這裡把重度使用者的 worst-case 建出來實際量，並斷言留有餘裕。它是回歸
 * 測試不是一次性量測：往後任何人加欄位，超出預算時會在這裡先失敗，而不是
 * 等真實使用者的進度存不進去（那個症狀是靜默的——寫入失敗只會讓進度停在
 * 某個版本，讀者看不到任何錯誤）。
 */
import { describe, it, expect } from 'vitest';

import {
  createInitialState,
  STORAGE_NOTE_HARD_MAX,
  STORAGE_NOTE_TEXT_HARD_MAX,
} from '../types';
import type { ProgressState } from '../types';

/** D1 單筆 blob 的額度 */
const BLOB_LIMIT_BYTES = 128 * 1024;

/**
 * 站上目前的 History 頁數（2026-08-02 實測 44）。這是「今天的重度使用者」
 * ——每頁都讀完、便條寫滿——的基準規模。
 */
const CURRENT_PAGE_COUNT = 44;

/** UTF-8 位元組數。中文一個字 3 bytes，用字元數估會嚴重低估 */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function buildHeavyState(pageCount = CURRENT_PAGE_COUNT): ProgressState {
  const state = createInitialState();
  const pageIds = Array.from(
    { length: pageCount },
    (_, i) => `history/chapter-${Math.floor(i / 12)}/arc-${i % 12}/section-${i}`
  );

  state.completedPageIds = [...pageIds];
  state.flags = [
    ...pageIds.map((id) => `completed:${id}`),
    ...Array.from({ length: 120 }, (_, i) => `met:character-key-${i}`),
    ...Array.from({ length: 108 }, (_, i) => `song:echoes/song-${i}`),
  ];
  state.pageMarkers = Object.fromEntries(
    pageIds.map((id) => [
      id,
      {
        maxMarkerIdx: 42,
        lastMarkerIdx: 41,
        totalMarkers: 42,
        updatedAt: '2026-08-02T12:34:56.789Z',
      },
    ])
  );
  state.fogRatio = Object.fromEntries(pageIds.map((id) => [id, 0.87654321]));
  state.conceptsReadLevel = Object.fromEntries(
    Array.from({ length: 200 }, (_, i) => [`entity-key-${i}`, 3])
  );
  state.islandsUnlocked = [
    'history',
    'echoes',
    'visuals',
    'concepts',
    'storage',
  ];
  state.islandGuidesSeen = [...state.islandsUnlocked];
  // 便條是最貴的一塊：硬上限張數 × 硬上限字數，全中文
  state.storageNotes = Array.from(
    { length: STORAGE_NOTE_HARD_MAX },
    (_, i) => ({
      id: `note-1754140000000-${i}`,
      text: '記'.repeat(STORAGE_NOTE_TEXT_HARD_MAX),
      tilt: -1.7,
      createdAt: '2026-08-02T12:34:56.789Z',
      updatedAt: '2026-08-02T12:34:56.789Z',
      location: {
        zone: 'history',
        pageLabel: '第七章・沉默的觀測者與其後的長夜',
      },
      capturedAt: '2026-08-02T20:34:56.789+08:00',
    })
  );
  state.lastVisitedPageId = pageIds[pageIds.length - 1];
  state.lastVisitedAt = '2026-08-02T12:34:56.789Z';

  return state;
}

function sizeOf(pageCount: number): number {
  return byteLength(JSON.stringify(buildHeavyState(pageCount)));
}

function breakdown(pageCount: number): string {
  return Object.entries(buildHeavyState(pageCount))
    .map(([key, value]) => [key, byteLength(JSON.stringify(value))] as const)
    .sort((a, b) => b[1] - a[1])
    .filter(([, size]) => size > 512)
    .map(([key, size]) => `${key}: ${(size / 1024).toFixed(1)}KB`)
    .join(', ');
}

describe('ProgressState blob 體積', () => {
  it('今天的重度使用者仍在額度內', () => {
    const bytes = sizeOf(CURRENT_PAGE_COUNT);
    if (bytes > BLOB_LIMIT_BYTES) {
      throw new Error(
        `blob ${(bytes / 1024).toFixed(1)}KB 超過 ${BLOB_LIMIT_BYTES / 1024}KB — ${breakdown(CURRENT_PAGE_COUNT)}`
      );
    }
    expect(bytes).toBeLessThan(BLOB_LIMIT_BYTES);
  });

  /**
   * ⚠️ 2026-08-02 首次實測的結論，寫成斷言而不是註解，才不會隨時間失真。
   *
   * 每頁的固定成本約 380 bytes（pageMarkers + fogRatio + completedPageIds +
   * `completed:` 旗標各一份），與便條的 86KB 疊加後，**額度只夠再長到
   * 一百多頁**。History 目前 44 頁，看起來還早，但這是持續累積的內容站。
   *
   * 這條界線一旦逼近，解法不是調參數而是把便條移出 blob（獨立表）——
   * 便條佔了三分之二以上，砍其他欄位都只是拖延。
   */
  it('記錄成長天花板：便條寫滿時，額度只夠約一百多頁', () => {
    const ceiling = (() => {
      for (let pages = CURRENT_PAGE_COUNT; pages <= 2000; pages += 10) {
        if (sizeOf(pages) > BLOB_LIMIT_BYTES) return pages;
      }
      return Infinity;
    })();

    expect(ceiling).toBeGreaterThan(CURRENT_PAGE_COUNT);
    // 天花板顯著上移（例如便條搬出 blob）時這裡會失敗——那是好事，
    // 但要順手更新這份基準與上面的說明
    expect(ceiling).toBeLessThan(400);
  });

  it('便條是最大的單一來源——調整硬上限前先看這裡', () => {
    const state = buildHeavyState();
    const notesBytes = byteLength(JSON.stringify(state.storageNotes));
    expect(notesBytes).toBeGreaterThan(byteLength(JSON.stringify(state)) * 0.5);
  });

  it('islandGuidesSeen 對總量可忽略（S10-4 新欄位）', () => {
    const without = buildHeavyState();
    without.islandGuidesSeen = [];
    expect(
      sizeOf(CURRENT_PAGE_COUNT) - byteLength(JSON.stringify(without))
    ).toBeLessThan(100);
  });
});
