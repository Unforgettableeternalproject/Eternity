import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PHANTOM_STATE_STORAGE_KEY,
  UEP_CLUE_WAITING_EVENT,
  UEP_PHANTOM_SHOW_EVENT,
  UEP_PHANTOM_SUGGESTION_EVENT,
  getClueWaitingCount,
  setClueWaitingCount,
  canMirrorGallery,
  clearPhantomGallery,
  consumePhantomSuggestion,
  getPhantomGallery,
  focusClueImage,
  hasClueSnapshot,
  isPhantomEligibleDivision,
  isPhantomSuggestionEligible,
  parsePhantomImages,
  pushClueGallery,
  pushPhantomGallery,
  pushPhantomSuggestion,
  restoreFromClueSnapshot,
  requestClueClear,
  UEP_PHANTOM_CLUE_CLEAR_EVENT,
} from '../phantomBridge';
import type { PhantomGallery } from '../phantomBridge';

function makeGallery(overrides: Partial<PhantomGallery> = {}): PhantomGallery {
  return {
    id: 'visuals/profiles/cast/heroine',
    title: '女主角設定集',
    entityKey: 'heroine',
    divisionId: 'profiles',
    images: [
      { id: 'img-1', file: 'images/a.png', caption: '正面', sortOrder: 0 },
      { id: 'img-2', file: 'images/b.png', caption: '側面', sortOrder: 1 },
    ],
    source: 'mirror',
    ...overrides,
  };
}

afterEach(() => {
  clearPhantomGallery();
  setClueWaitingCount(0);
});

describe('isPhantomEligibleDivision', () => {
  it.each([['profiles'], ['illustrations'], ['sketchs'], ['pixel']])(
    '四分館 %s 皆進島（#3 放寬）',
    (divisionId) => {
      expect(isPhantomEligibleDivision(divisionId)).toBe(true);
    }
  );

  it.each([[null], [undefined], [''], ['unknown']])(
    '非白名單分館 %s 排除',
    (divisionId) => {
      expect(isPhantomEligibleDivision(divisionId)).toBe(false);
    }
  );
});

describe('canMirrorGallery', () => {
  const base = { divisionId: 'profiles', layout: 'corridor', imageCount: 3 };

  it('四分館、非精靈圖、有圖片 → 可映照（#3 放寬）', () => {
    expect(canMirrorGallery(base)).toBe(true);
    expect(
      canMirrorGallery({
        ...base,
        divisionId: 'illustrations',
        layout: 'museum',
      })
    ).toBe(true);
    // 抽象萃取間／基底實驗室的非精靈圖 gallery 亦可映照（1e1aaea 放寬）
    expect(canMirrorGallery({ ...base, divisionId: 'sketchs' })).toBe(true);
    expect(canMirrorGallery({ ...base, divisionId: 'pixel' })).toBe(true);
  });

  it.each([
    [{ ...base, divisionId: 'unknown' }, '非白名單分館不進島'],
    [{ ...base, layout: 'sprite' }, '精靈圖 gallery 本輪排除'],
    [{ ...base, imageCount: 0 }, '空 gallery'],
  ])('排除 %j（%s）', (input) => {
    expect(canMirrorGallery(input)).toBe(false);
  });
});

describe('isPhantomSuggestionEligible', () => {
  const base = { divisionId: 'profiles', unlocked: true, imageCount: 2 };

  it.each([
    [{ ...base }, '陳列走廊'],
    [{ ...base, divisionId: 'sketchs' }, '抽象萃取間'],
    [{ ...base, divisionId: 'pixel' }, '基底實驗室'],
  ])('進島分館且已解鎖且有圖片 → 可提示（%s）', (input) => {
    expect(isPhantomSuggestionEligible(input)).toBe(true);
  });

  it.each([
    [{ ...base, divisionId: 'unknown' }, '非白名單分館'],
    [{ ...base, unlocked: false }, '未解鎖 gallery（提示不授旗）'],
    [{ ...base, imageCount: 0 }, '空 gallery'],
  ])('排除 %j（%s）', (input) => {
    expect(isPhantomSuggestionEligible(input)).toBe(false);
  });
});

describe('目前投射（current）', () => {
  it('push 後可讀回，且讀取不清除（收合再展開續示）', () => {
    const gallery = makeGallery();
    pushPhantomGallery(gallery);
    expect(getPhantomGallery()).toEqual(gallery);
    expect(getPhantomGallery()).toEqual(gallery);
  });

  it('push 會廣播 UEP_PHANTOM_SHOW_EVENT（島展開中即時切換）', () => {
    const listener = vi.fn();
    window.addEventListener(UEP_PHANTOM_SHOW_EVENT, listener);
    const gallery = makeGallery();
    pushPhantomGallery(gallery);
    window.removeEventListener(UEP_PHANTOM_SHOW_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual(gallery);
  });

  it('後 push 的投射覆蓋前者（一次展示一個 gallery）', () => {
    pushPhantomGallery(makeGallery());
    const next = makeGallery({ id: 'visuals/illustrations/scenes/dawn' });
    pushPhantomGallery(next);
    expect(getPhantomGallery()?.id).toBe('visuals/illustrations/scenes/dawn');
  });

  it('跨頁重建 window bridge 後可從 localStorage 還原投射', () => {
    const gallery = makeGallery();
    pushPhantomGallery(gallery);
    expect(
      window.localStorage.getItem(PHANTOM_STATE_STORAGE_KEY)
    ).not.toBeNull();

    delete window.__uepPhantomGallery;
    delete window.__uepPhantomClueSnapshot;

    expect(getPhantomGallery()).toEqual(gallery);
  });

  it('毀損的持久資料靜默回到空狀態', () => {
    window.localStorage.setItem(PHANTOM_STATE_STORAGE_KEY, '{broken');
    delete window.__uepPhantomGallery;
    delete window.__uepPhantomClueSnapshot;
    expect(getPhantomGallery()).toBeNull();
  });

  /* 【回歸:07/27 定案】投射畫作**不得**廣播跨島關聯事件。
   *
   * `relatedHistoryIds` 記的是「讀者點擊 visual clue 當下所在的 History
   * 頁」，等 History 島成為消費者之後，這條路的效果會是：在某頁點了嵌入
   * 的線索 → 畫作投影 → History 島浮出「相關的段落：（你正在看的這頁）」。
   * 艾斯維爾定案「點 History 文內的互動式嵌入時 History 島不該有反應」。 */
  it('push 不再廣播 ISLAND_RELATED_EVENT（含帶 relatedHistoryIds 的 clue）', async () => {
    const { ISLAND_RELATED_EVENT } = await import('../../types');
    const listener = vi.fn();
    window.addEventListener(ISLAND_RELATED_EVENT, listener);
    pushPhantomGallery(makeGallery());
    pushPhantomGallery(
      makeGallery({ relatedHistoryIds: ['history/u/1-1'], source: 'clue' })
    );
    window.removeEventListener(ISLAND_RELATED_EVENT, listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('clearPhantomGallery 同時清除投射與 pending 提示（登出/reset）', () => {
    const showListener = vi.fn();
    const suggestionListener = vi.fn();
    window.addEventListener(UEP_PHANTOM_SHOW_EVENT, showListener);
    window.addEventListener(UEP_PHANTOM_SUGGESTION_EVENT, suggestionListener);
    pushPhantomGallery(makeGallery());
    pushPhantomSuggestion(makeGallery({ source: 'embed' }));
    showListener.mockClear();
    suggestionListener.mockClear();
    clearPhantomGallery();
    window.removeEventListener(UEP_PHANTOM_SHOW_EVENT, showListener);
    window.removeEventListener(
      UEP_PHANTOM_SUGGESTION_EVENT,
      suggestionListener
    );
    expect(getPhantomGallery()).toBeNull();
    expect(consumePhantomSuggestion()).toBeNull();
    expect(window.localStorage.getItem(PHANTOM_STATE_STORAGE_KEY)).toBeNull();
    expect((showListener.mock.calls[0][0] as CustomEvent).detail).toBeNull();
    expect(
      (suggestionListener.mock.calls[0][0] as CustomEvent).detail
    ).toBeNull();
  });
});

describe('Visual Clue 快照/復原（V-D，沿 interruptionSnapshot 語意）', () => {
  const clueGallery = (id = 'visuals/illustrations/scenes/dawn') =>
    makeGallery({ id, source: 'clue', relatedHistoryIds: ['history/u/1-1'] });

  it('插播快照目前投射，恢復時回到原投射', () => {
    const original = makeGallery();
    pushPhantomGallery(original);
    pushClueGallery(clueGallery());
    expect(getPhantomGallery()?.source).toBe('clue');
    expect(hasClueSnapshot()).toBe(true);
    restoreFromClueSnapshot();
    expect(getPhantomGallery()?.id).toBe(original.id);
    expect(hasClueSnapshot()).toBe(false);
  });

  it('插播前一片空白 → 恢復回空狀態並廣播 null（島清空）', () => {
    pushClueGallery(clueGallery());
    const listener = vi.fn();
    window.addEventListener(UEP_PHANTOM_SHOW_EVENT, listener);
    restoreFromClueSnapshot();
    window.removeEventListener(UEP_PHANTOM_SHOW_EVENT, listener);
    expect(getPhantomGallery()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBeNull();
  });

  it('快照不巢狀：clue 插播中再點另一個 clue 不重拍快照', () => {
    const original = makeGallery();
    pushPhantomGallery(original);
    pushClueGallery(clueGallery('visuals/illustrations/scenes/a'));
    pushClueGallery(clueGallery('visuals/illustrations/scenes/b'));
    restoreFromClueSnapshot();
    // 恢復點是使用者自己的投射，不是上一個 clue
    expect(getPhantomGallery()?.id).toBe(original.id);
  });

  it('#4：requestClueClear 廣播 UEP_PHANTOM_CLUE_CLEAR_EVENT（島 × 請 Reader 撤書籤）', () => {
    const listener = vi.fn();
    window.addEventListener(UEP_PHANTOM_CLUE_CLEAR_EVENT, listener);
    requestClueClear();
    window.removeEventListener(UEP_PHANTOM_CLUE_CLEAR_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('跨頁重建 window bridge 後仍可恢復 clue 前的原投射', () => {
    const original = makeGallery();
    pushPhantomGallery(original);
    pushClueGallery(clueGallery());

    delete window.__uepPhantomGallery;
    delete window.__uepPhantomClueSnapshot;

    expect(getPhantomGallery()?.source).toBe('clue');
    expect(hasClueSnapshot()).toBe(true);
    restoreFromClueSnapshot();
    expect(getPhantomGallery()?.id).toBe(original.id);
  });

  it('插播中手動接管（映照/嵌入）= 快照丟棄，恢復 no-op', () => {
    pushPhantomGallery(makeGallery());
    pushClueGallery(clueGallery());
    const takeover = makeGallery({
      id: 'visuals/profiles/cast/rival',
      source: 'mirror',
    });
    pushPhantomGallery(takeover);
    expect(hasClueSnapshot()).toBe(false);
    restoreFromClueSnapshot();
    expect(getPhantomGallery()?.id).toBe(takeover.id);
  });

  it('無快照時恢復 no-op（從未插播）', () => {
    const current = makeGallery();
    pushPhantomGallery(current);
    restoreFromClueSnapshot();
    expect(getPhantomGallery()?.id).toBe(current.id);
  });

  it('pushClueGallery 一律以 clue 來源展示', () => {
    pushClueGallery(makeGallery({ source: 'mirror' }));
    expect(getPhantomGallery()?.source).toBe('clue');
  });

  it('同一 clue 的 image gate 可切到指定圖並持久化；過期 clue 不可誤切', () => {
    pushClueGallery(clueGallery('visuals/illustrations/scenes/dawn'));
    // 舊 fixture 沒 activeClueId，先以完整 #8 payload 重投射。
    pushClueGallery(
      makeGallery({
        id: 'visuals/illustrations/scenes/dawn',
        source: 'clue',
        activeClueId: 'clue-1',
      })
    );
    expect(
      focusClueImage('clue-1', 'visuals/illustrations/scenes/dawn', 'img-2')
    ).toBe(true);
    expect(getPhantomGallery()?.initialImageId).toBe('img-2');
    expect(
      focusClueImage('old-clue', 'visuals/illustrations/scenes/dawn', 'img-1')
    ).toBe(false);
    expect(getPhantomGallery()?.initialImageId).toBe('img-2');
  });

  it('clearPhantomGallery（登出/reset）一併清除快照', () => {
    pushPhantomGallery(makeGallery());
    pushClueGallery(clueGallery());
    clearPhantomGallery();
    expect(hasClueSnapshot()).toBe(false);
  });
});

describe('clue 等待計數（dock chip 閃爍 bridge，V-D.31）', () => {
  it('set 後可讀回，並廣播 UEP_CLUE_WAITING_EVENT', () => {
    const listener = vi.fn();
    window.addEventListener(UEP_CLUE_WAITING_EVENT, listener);
    setClueWaitingCount(2);
    window.removeEventListener(UEP_CLUE_WAITING_EVENT, listener);
    expect(getClueWaitingCount()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe(2);
  });

  it('同值不重複廣播（scroll 高頻呼叫防抖）', () => {
    setClueWaitingCount(1);
    const listener = vi.fn();
    window.addEventListener(UEP_CLUE_WAITING_EVENT, listener);
    setClueWaitingCount(1);
    window.removeEventListener(UEP_CLUE_WAITING_EVENT, listener);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('parsePhantomImages — worker payload 摘要防禦解析', () => {
  it('正常摘要轉為 PhantomImage（含三態欄位）', () => {
    const images = parsePhantomImages([
      {
        id: 'img-1',
        file: 'images/a.png',
        caption: '正面',
        sortOrder: 0,
        initialState: 'partial',
        partialGate: { requiresFlags: ['met:heroine'] },
      },
    ]);
    expect(images).toEqual([
      {
        id: 'img-1',
        file: 'images/a.png',
        caption: '正面',
        sortOrder: 0,
        initialState: 'partial',
        partialGate: { requiresFlags: ['met:heroine'] },
      },
    ]);
  });

  it('壞項過濾：非物件、缺 file、非法 initialState', () => {
    const images = parsePhantomImages([
      null,
      'oops',
      { id: 'no-file', caption: 'x' },
      { file: 'images/ok.png', initialState: 'weird' },
    ]);
    expect(images).toHaveLength(1);
    expect(images[0].file).toBe('images/ok.png');
    expect(images[0].initialState).toBeUndefined();
  });

  it('非陣列輸入回傳空陣列', () => {
    expect(parsePhantomImages(undefined)).toEqual([]);
    expect(parsePhantomImages({})).toEqual([]);
  });
});

describe('entity 嵌入提示（suggestion）', () => {
  it('consume 讀取即清（一次性 pending，同 echoSuggestionBridge）', () => {
    const suggestion = makeGallery({ source: 'embed' });
    pushPhantomSuggestion(suggestion);
    expect(consumePhantomSuggestion()).toEqual(suggestion);
    expect(consumePhantomSuggestion()).toBeNull();
  });

  it('push 會廣播 UEP_PHANTOM_SUGGESTION_EVENT', () => {
    const listener = vi.fn();
    window.addEventListener(UEP_PHANTOM_SUGGESTION_EVENT, listener);
    pushPhantomSuggestion(makeGallery({ source: 'embed' }));
    window.removeEventListener(UEP_PHANTOM_SUGGESTION_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('提示不影響目前投射（提示卡按下展示前不換畫面）', () => {
    const current = makeGallery();
    pushPhantomGallery(current);
    pushPhantomSuggestion(makeGallery({ id: 'visuals/profiles/cast/rival' }));
    expect(getPhantomGallery()?.id).toBe(current.id);
  });
});
