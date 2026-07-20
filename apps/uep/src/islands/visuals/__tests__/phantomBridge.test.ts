import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UEP_PHANTOM_SHOW_EVENT,
  UEP_PHANTOM_SUGGESTION_EVENT,
  canMirrorGallery,
  clearPhantomGallery,
  consumePhantomSuggestion,
  getPhantomGallery,
  isPhantomEligibleDivision,
  isPhantomSuggestionEligible,
  pushPhantomGallery,
  pushPhantomSuggestion,
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
});

describe('isPhantomEligibleDivision', () => {
  it('只有陳列走廊與鑲框室進島', () => {
    expect(isPhantomEligibleDivision('profiles')).toBe(true);
    expect(isPhantomEligibleDivision('illustrations')).toBe(true);
  });

  it.each([['sketchs'], ['pixel'], [null], [undefined], ['']])(
    '排除 %s',
    (divisionId) => {
      expect(isPhantomEligibleDivision(divisionId)).toBe(false);
    }
  );
});

describe('canMirrorGallery', () => {
  const base = { divisionId: 'profiles', layout: 'corridor', imageCount: 3 };

  it('陳列走廊/鑲框室、非精靈圖、有圖片 → 可映照', () => {
    expect(canMirrorGallery(base)).toBe(true);
    expect(
      canMirrorGallery({
        ...base,
        divisionId: 'illustrations',
        layout: 'museum',
      })
    ).toBe(true);
  });

  it.each([
    [{ ...base, divisionId: 'sketchs' }, '分館不進島'],
    [{ ...base, divisionId: 'pixel' }, '基底實驗室不進島'],
    [{ ...base, layout: 'sprite' }, '精靈圖 gallery 本輪排除'],
    [{ ...base, imageCount: 0 }, '空 gallery'],
  ])('排除 %j（%s）', (input) => {
    expect(canMirrorGallery(input)).toBe(false);
  });
});

describe('isPhantomSuggestionEligible', () => {
  const base = { divisionId: 'profiles', unlocked: true, imageCount: 2 };

  it('進島分館且已解鎖且有圖片 → 可提示', () => {
    expect(isPhantomSuggestionEligible(base)).toBe(true);
  });

  it.each([
    [{ ...base, divisionId: 'sketchs' }, '分館不進島'],
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

  it('clearPhantomGallery 同時清除投射與 pending 提示（登出/reset）', () => {
    pushPhantomGallery(makeGallery());
    pushPhantomSuggestion(makeGallery({ source: 'embed' }));
    clearPhantomGallery();
    expect(getPhantomGallery()).toBeNull();
    expect(consumePhantomSuggestion()).toBeNull();
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
