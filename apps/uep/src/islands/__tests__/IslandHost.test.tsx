/**
 * IslandHost — entity-activate 消費行為測試（S9-D.5）
 *
 * S9-D.5 起收合的島不再因為互動式嵌入被點擊就強制展開：detail 只會
 * 暫存進 terminalBridge，展開與否交還使用者（dock chip 閃爍提示）。
 * 本檔只驗證這個掛點——其餘掛載守門/資料流由各自模組測試覆蓋。
 *
 * 大量週邊模組（DraggableIsland/IslandDock/testBridge/PinnedNoteLayer/
 * SongPreviewCard）與本測試主張無關，一律換成無副作用的假元件，避免
 * 牽動它們各自的 hook 訂閱造成測試不穩定。
 */
import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityActivateDetail } from '../../embed';
import { UEP_ENTITY_ACTIVATE_EVENT } from '../../embed';
import { createInitialState } from '../../progress';
import type { ProgressState } from '../../progress';

const progressMock = vi.hoisted(() => ({
  state: null as ProgressState | null,
}));

/** 可掛載的 zone id；預設只留 concepts，避免牽動 echoes/visuals 各自的
 * entity-activate 反查流程（不是本測試主張）。第二個測試會改成全假。 */
const gatingMock = vi.hoisted(() => ({
  allowedId: 'concepts' as string | null,
}));

vi.mock('../../auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth')>()),
  useReaderAuth: () => null,
}));

vi.mock('../../progress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../progress')>()),
  useProgress: () => progressMock.state,
}));

vi.mock('../islandRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../islandRuntime')>()),
  canUseIslands: () => true,
  shouldMountIsland: (_progress: unknown, id: string) =>
    id === gatingMock.allowedId,
}));

vi.mock('../useIslands', () => ({
  useDesktopIslandViewport: () => true,
  useIslandRuntimeState: () => ({ windows: {}, focusOrder: [] }),
}));

/** 嵌入提示去重測試用：目前播放中的曲目（audio singleton 不進測試） */
const audioMock = vi.hoisted(() => ({
  currentSongId: null as string | null,
}));
vi.mock('../../audio', () => ({
  getAudioStore: () => ({
    getState: () => ({ currentSongId: audioMock.currentSongId }),
    // pending 提示的事後失效 watcher 會訂閱；本檔不驗它，回 no-op 退訂
    subscribe: () => () => {},
  }),
  resolveSpoilerLevel: () => 0,
}));

/* 解鎖判定與 zone tree 不是本檔主張，一律通過（各自模組另有測試） */
vi.mock('../../components/echoes/echoesVisibility', () => ({
  isSongUnlockedInZone: () => true,
}));
vi.mock('../../components/visuals/visualsVisibility', () => ({
  isGalleryUnlockedInZone: () => true,
}));
vi.mock('../zoneProgressTree', () => ({
  fetchZoneProgressTree: () => Promise.resolve(null),
}));

vi.mock('../DraggableIsland', () => ({ default: () => null }));
vi.mock('../IslandDock', () => ({ default: () => null }));
vi.mock('../testBridge', () => ({
  mountIslandsTestBridge: () => () => {},
}));
vi.mock('../storage/PinnedNoteLayer', () => ({ default: () => null }));
vi.mock('../echoes/SongPreviewCard', () => ({ default: () => null }));

/** chip 精準化測試用的進度葉集合（tree 端點不打網路） */
const signalMock = vi.hoisted(() => ({
  ids: ['history/u/c1/a1/s1'] as string[],
}));
vi.mock('../history/historyIslandData', () => ({
  fetchHistoryCountSignalIds: () => Promise.resolve(new Set(signalMock.ids)),
}));

import IslandHost from '../IslandHost';
import {
  hasPendingEntityActivate,
  resetEntityActivateBridge,
} from '../concepts/terminalBridge';
import { clearAllChipAttention, getChipAttentionMark } from '../chipAttention';
import {
  hasPendingRelated,
  resetRelatedBridge,
  subscribeRelated,
} from '../relatedBridge';
import { getRelatedPendingFlag } from '../interlinkTrigger';
import {
  clearEchoSuggestion,
  hasEchoSuggestion,
} from '../echoes/echoSuggestionBridge';
import {
  clearPhantomGallery,
  hasPhantomSuggestion,
  pushPhantomGallery,
} from '../visuals/phantomBridge';
import { invalidateEntityBindingCache } from '../../components/concepts/entityBinding';
import { getIslandRuntime } from '../islandRuntime';
import { ISLAND_RELATED_EVENT } from '../types';
import type { IslandRelatedDetail } from '../types';

describe('IslandHost — entity-activate 只留 pending，不強制展開島', () => {
  beforeEach(() => {
    progressMock.state = createInitialState();
    gatingMock.allowedId = 'concepts';
    resetEntityActivateBridge();
  });

  afterEach(() => {
    resetEntityActivateBridge();
    vi.restoreAllMocks();
  });

  it('收到 uep:entity-activate 後 pending 進 terminalBridge，但不呼叫 runtime.open', () => {
    const runtime = getIslandRuntime();
    const openSpy = vi.spyOn(runtime, 'open');

    render(<IslandHost />);

    expect(hasPendingEntityActivate()).toBe(false);

    const detail: EntityActivateDetail = {
      kind: 'character',
      ref: 'entity:test-char',
      entityKey: 'test-char',
    };
    act(() => {
      window.dispatchEvent(
        new CustomEvent<EntityActivateDetail>(UEP_ENTITY_ACTIVATE_EVENT, {
          detail,
        })
      );
    });

    expect(hasPendingEntityActivate()).toBe(true);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('concepts 島不可掛載時（shouldMountIsland 為假），entity-activate 靜默忽略', () => {
    gatingMock.allowedId = null; // 沒有任何 zone 可掛載

    render(<IslandHost />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent<EntityActivateDetail>(UEP_ENTITY_ACTIVATE_EVENT, {
          detail: { kind: 'character', ref: 'entity:test-char' },
        })
      );
    });

    expect(hasPendingEntityActivate()).toBe(false);
  });
});

/**
 * 跨區互聯的 live lifecycle（S10-1 修補）
 *
 * 原本 HistoryIsland 自己訂閱 ISLAND_RELATED_EVENT，島收合時該元件根本
 * 沒有 mount——收合期間的線索整個消失，「chip 亮框 → 展開後看到卡片」
 * 這條定案路徑從來不會發生。監聽必須常駐在 Host。
 */
describe('IslandHost — 收合的 History 島不漏接互聯線索', () => {
  const sample: IslandRelatedDetail = {
    targetIsland: 'history',
    sourceZone: 'echoes',
    items: [{ pageId: 'history/chpt-01', title: '第一章' }],
    label: '雨海終曲',
  };

  function emitRelated(detail: IslandRelatedDetail = sample) {
    act(() => {
      window.dispatchEvent(
        new CustomEvent<IslandRelatedDetail>(ISLAND_RELATED_EVENT, { detail })
      );
    });
  }

  beforeEach(() => {
    progressMock.state = createInitialState();
    gatingMock.allowedId = 'history';
    resetRelatedBridge();
    window.history.pushState({}, '', '/echoes');
  });

  afterEach(() => {
    resetRelatedBridge();
    vi.restoreAllMocks();
  });

  it('島收合時線索進 relatedBridge 並亮起 dock chip', () => {
    render(<IslandHost />);

    expect(hasPendingRelated('history')).toBe(false);
    emitRelated();

    expect(hasPendingRelated('history')).toBe(true);
    expect(getRelatedPendingFlag('history')).toBe(true);
  });

  it('島展開（有訂閱者）時直接送達，不留 pending', () => {
    render(<IslandHost />);
    const received: (IslandRelatedDetail | null)[] = [];
    subscribeRelated('history', (detail) => received.push(detail));

    emitRelated();

    expect(received).toEqual([sample]);
    expect(hasPendingRelated('history')).toBe(false);
  });

  it('history 島不可掛載時靜默忽略（不亮 chip）', () => {
    gatingMock.allowedId = null;
    render(<IslandHost />);

    emitRelated();

    expect(hasPendingRelated('history')).toBe(false);
    expect(getRelatedPendingFlag('history')).toBe(false);
  });

  it('換頁時 pending 線索作廢——脈絡已不在，與嵌入提示同一判準', () => {
    render(<IslandHost />);
    emitRelated();
    expect(hasPendingRelated('history')).toBe(true);

    act(() => {
      window.history.pushState({}, '', '/history');
    });

    expect(hasPendingRelated('history')).toBe(false);
    expect(getRelatedPendingFlag('history')).toBe(false);
  });
});

/**
 * 嵌入提示的去重（2026-07-29）
 *
 * 點到的 entity 對應的曲目／畫廊要是已經在島上了，那張提示卡沒有可提示的
 * 事——按下去只是把使用者正在聽/看的東西再放一次。與既有的 sourceZone
 * 判斷同一個道理，只是「已經在看」的證據來自播放/投射狀態。
 */
describe('IslandHost — 已在播放／展示的項目不再出嵌入提示卡', () => {
  const SONG = {
    id: 'echoes/characters/heroine-theme',
    title: '女主角的主題',
    audioFile: 'audio/heroine.mp3',
    songType: 'character',
    clusterId: 'characters',
    entityKey: 'heroine',
    spoilerRevisions: [],
  };
  const GALLERY = {
    id: 'visuals/profiles/cast/heroine',
    title: '女主角設定集',
    entityKey: 'heroine',
    divisionId: 'profiles',
    images: [
      { id: 'img-1', file: 'images/a.png', caption: '正面', sortOrder: 0 },
    ],
  };

  /**
   * ⚠️ `ok: true` 不可省：`resolveEntityBinding` 的 `loadIndex` 會檢查
   * `res.ok`，缺了就 throw → 求值回 `{ status: 'error' }` → 消費端
   * fail closed（不推提示卡）。這裡的 concepts 索引回的是歌曲 payload，
   * `data.entries` 為空，因此判成 orphan 並退回 by-key 反查——正是這組
   * 測試要走的路徑。
   */
  function stubFetch(payload: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
      )
    );
  }

  /** 事件 → fetch → Promise.all 落地 */
  async function activateEntity() {
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent<EntityActivateDetail>(UEP_ENTITY_ACTIVATE_EVENT, {
          detail: {
            kind: 'character',
            ref: 'entity:heroine',
            entityKey: 'heroine',
          },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(() => {
    progressMock.state = createInitialState();
    audioMock.currentSongId = null;
    clearEchoSuggestion();
    clearPhantomGallery();
  });

  afterEach(() => {
    clearEchoSuggestion();
    clearPhantomGallery();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Echoes：反查到的曲目正是目前播放中的 → 不推提示', async () => {
    gatingMock.allowedId = 'echoes';
    audioMock.currentSongId = SONG.id;
    stubFetch({ ok: true, data: { song: SONG } });
    render(<IslandHost />);

    await activateEntity();

    expect(hasEchoSuggestion()).toBe(false);
  });

  it('Echoes：播的是別首 → 照常推提示', async () => {
    gatingMock.allowedId = 'echoes';
    audioMock.currentSongId = 'echoes/stories/another';
    stubFetch({ ok: true, data: { song: SONG } });
    render(<IslandHost />);

    await activateEntity();

    expect(hasEchoSuggestion()).toBe(true);
  });

  it('Visuals：反查到的畫廊正是目前投射中的 → 不推提示', async () => {
    gatingMock.allowedId = 'visuals';
    pushPhantomGallery({ ...GALLERY, source: 'mirror' });
    stubFetch({ ok: true, data: { gallery: GALLERY } });
    render(<IslandHost />);

    await activateEntity();

    expect(hasPhantomSuggestion()).toBe(false);
  });

  it('Visuals：投射的是別個畫廊 → 照常推提示', async () => {
    gatingMock.allowedId = 'visuals';
    pushPhantomGallery({
      ...GALLERY,
      id: 'visuals/profiles/cast/rival',
      source: 'mirror',
    });
    stubFetch({ ok: true, data: { gallery: GALLERY } });
    render(<IslandHost />);

    await activateEntity();

    expect(hasPhantomSuggestion()).toBe(true);
  });
});

/**
 * 進度推進 → 旅程之書 chip 標記（S9-D.6；2026-07-29 精準化）
 *
 * 兩道閘：島展開中不標記（目錄頁碼自己閃，事後標記只會在收合那一刻
 * 變成殘影）；只有「目錄數字真的會變」的完成（進度葉）才標記。
 */
describe('IslandHost — 進度推進的 chip 標記', () => {
  /** 讓 dynamic import 的 promise 鏈跑完 */
  async function flushAsync() {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }

  function completeAndRerender(
    rerender: (ui: ReactElement) => void,
    pageId: string
  ) {
    progressMock.state = {
      ...createInitialState(),
      completedPageIds: [pageId],
    };
    rerender(<IslandHost />);
  }

  beforeEach(() => {
    progressMock.state = createInitialState();
    gatingMock.allowedId = 'history';
    clearAllChipAttention();
  });

  afterEach(() => {
    getIslandRuntime().resetAll();
    clearAllChipAttention();
    vi.restoreAllMocks();
  });

  it('進度葉完成且島收合 → 標記 chip', async () => {
    const { rerender } = render(<IslandHost />);
    completeAndRerender(rerender, 'history/u/c1/a1/s1');
    await flushAsync();
    expect(getChipAttentionMark('history')).toBe('閱讀進度已更新');
  });

  it('容器頁（序節）完成 → 不標記——目錄數字不會動', async () => {
    const { rerender } = render(<IslandHost />);
    completeAndRerender(rerender, 'history/u/c1/a1');
    await flushAsync();
    expect(getChipAttentionMark('history')).toBeNull();
  });

  it('島展開中收到進度葉完成 → 不標記——目錄頁碼自己閃', async () => {
    getIslandRuntime().open('history');
    const { rerender } = render(<IslandHost />);
    completeAndRerender(rerender, 'history/u/c1/a1/s1');
    await flushAsync();
    expect(getChipAttentionMark('history')).toBeNull();
  });
});

/**
 * entity 一對多綁定接線（T-8，2026-08-15 定案）
 *
 * 走真實的 resolveEntityBinding 求值路徑（不 mock 該模組），fetch 依 URL
 * 分派，確認：有 dossier 綁定時改打 by-id 端點、孤兒 entityKey 維持原本
 * 的 by-key 反查。後者是**回歸鎖**——絕大多數 entity 屬於這種情況。
 */
describe('IslandHost — entity 一對多綁定接線', () => {
  const BOUND_SONG = {
    id: 'echoes/t8/hero-theme',
    title: '轉正後主題曲',
    audioFile: 'audio/hero.mp3',
    songType: 'character',
    clusterId: 'characters',
    entityKey: 't8-turncoat',
    spoilerRevisions: [],
  };

  const DOSSIER_PAGE = {
    variants: [
      {
        id: 'u',
        subcategories: [
          {
            label: '人物',
            groups: [
              {
                label: '',
                entries: [
                  {
                    name: '轉正角色',
                    entityKey: 't8-turncoat',
                    revisions: [
                      {
                        id: 'base',
                        gate: null,
                        patch: {
                          set: { 'bindings.echoes': 'echoes/t8/hero-theme' },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  /** 記錄所有被請求的 URL，供斷言走了哪一條路徑 */
  let requested: string[] = [];

  function stubRoutedFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        requested.push(url);
        if (url.includes('/api/concepts/entity-index')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                ok: true,
                data: {
                  entries: [
                    {
                      stack: 'dossier',
                      pageId: 'concepts/t8/records',
                      entityKey: 't8-turncoat',
                    },
                  ],
                },
              }),
          });
        }
        if (url.includes('/api/content/concepts/t8/records')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                ok: true,
                data: {
                  content: [
                    {
                      type: 'dossier',
                      content: JSON.stringify(DOSSIER_PAGE),
                    },
                  ],
                },
              }),
          });
        }
        // 兩個曲目端點都回同一首，差別只在測試斷言看的是被打的 URL
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { song: BOUND_SONG } }),
        });
      })
    );
  }

  async function activate(entityKey: string) {
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent<EntityActivateDetail>(UEP_ENTITY_ACTIVATE_EVENT, {
          detail: {
            kind: 'character',
            ref: `entity:${entityKey}`,
            entityKey,
          },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(() => {
    progressMock.state = createInitialState();
    audioMock.currentSongId = null;
    gatingMock.allowedId = 'echoes';
    requested = [];
    invalidateEntityBindingCache();
    clearEchoSuggestion();
    stubRoutedFetch();
  });

  afterEach(() => {
    clearEchoSuggestion();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('有 dossier 綁定 → 改打 by-id 端點', async () => {
    render(<IslandHost />);
    await activate('t8-turncoat');

    expect(
      requested.some((u) =>
        u.includes('/api/echoes/song?id=echoes%2Ft8%2Fhero-theme')
      )
    ).toBe(true);
    expect(requested.some((u) => u.includes('/api/echoes/entity-song'))).toBe(
      false
    );
  });

  it('🔒 孤兒 entityKey → 維持原本的 by-key 反查（fallback 零走樣）', async () => {
    render(<IslandHost />);
    await activate('t8-orphan');

    expect(
      requested.some((u) => u.includes('/api/echoes/entity-song?key=t8-orphan'))
    ).toBe(true);
    expect(requested.some((u) => u.includes('/api/echoes/song?id='))).toBe(
      false
    );
  });

  it('🔒 綁定指到別人的歌 → 不顯示（entityKey 不一致）', async () => {
    // picker 的候選本來就只列同 entityKey 的曲目，會不一致代表資料壞了
    // （target 被刪、entityKey 被改、載入失敗時手填打錯）
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        requested.push(url);
        if (url.includes('/api/concepts/entity-index')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                ok: true,
                data: {
                  entries: [
                    {
                      stack: 'dossier',
                      pageId: 'concepts/t8/records',
                      entityKey: 't8-turncoat',
                    },
                  ],
                },
              }),
          });
        }
        if (url.includes('/api/content/concepts/t8/records')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                ok: true,
                data: {
                  content: [
                    { type: 'dossier', content: JSON.stringify(DOSSIER_PAGE) },
                  ],
                },
              }),
          });
        }
        // by-id 回來的歌掛在另一個實體身上
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ok: true,
              data: { song: { ...BOUND_SONG, entityKey: 'someone-else' } },
            }),
        });
      })
    );
    invalidateEntityBindingCache();
    render(<IslandHost />);
    await activate('t8-turncoat');

    expect(hasEchoSuggestion()).toBe(false);
  });

  it('🔒 權威資料拿不到 → fail closed，不退回 by-key', async () => {
    // by-key 是全表掃描命中第一筆（無 ORDER BY），同 key 多候選時會顯示
    // 任意一筆，繞過 dossier 寫好的明確指向。索引暫時抓不到寧可什麼都不推
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        requested.push(url);
        if (url.includes('/api/concepts/entity-index')) {
          return Promise.reject(new Error('network down'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { song: BOUND_SONG } }),
        });
      })
    );
    invalidateEntityBindingCache();
    render(<IslandHost />);
    await activate('t8-turncoat');

    expect(requested.some((u) => u.includes('/api/echoes/entity-song'))).toBe(
      false
    );
    expect(requested.some((u) => u.includes('/api/echoes/song?id='))).toBe(
      false
    );
    expect(hasEchoSuggestion()).toBe(false);
  });
});
