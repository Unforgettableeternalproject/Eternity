/**
 * VisualsIsland 元件測試（S8 下半場 V-C）
 *
 * 重點驗證：
 * - 資料鏈：空狀態 / mount 讀回 window 投射（收合展開續示）/ 事件即時切換
 * - 檢視器：大圖 + 箭頭導航 + caption + 計數
 * - 三態：A 鎖定格不載圖（島內大圖與縮圖皆然）、B 模糊 class
 *
 * 三態 fixture 不依賴 progress 操作：initialState 'locked' 無 lockGate
 * ＝永遠 A（案 3）、'partial' 無條件＝永遠 B（案 6），求值結果與
 * 預設進度無關。
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import VisualsIsland from '../VisualsIsland';
import {
  clearPhantomGallery,
  getPhantomGallery,
  hasClueSnapshot,
  PHANTOM_STATE_STORAGE_KEY,
  pushClueGallery,
  pushPhantomGallery,
  pushPhantomSuggestion,
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

/** 三態各佔一格的 fixture：第一張恆 C、第二張永遠 A、第三張永遠 B */
function makeThreeStateGallery(): PhantomGallery {
  return makeGallery({
    images: [
      { id: 'img-1', file: 'images/a.png', caption: '正面', sortOrder: 0 },
      {
        id: 'img-2',
        file: 'images/b.png',
        caption: '側面',
        sortOrder: 1,
        initialState: 'locked',
      },
      {
        id: 'img-3',
        file: 'images/c.png',
        caption: '背面',
        sortOrder: 2,
        initialState: 'partial',
      },
    ],
  });
}

afterEach(() => {
  cleanup();
  clearPhantomGallery();
});

describe('VisualsIsland 資料鏈', () => {
  it('無投射時顯示空狀態', () => {
    render(<VisualsIsland />);
    expect(screen.getByText(/畫框還空著/)).toBeTruthy();
  });

  it('mount 時讀回 window 目前投射（收合後展開續示）', () => {
    pushPhantomGallery(makeGallery());
    render(<VisualsIsland />);
    expect(screen.getByText('女主角設定集')).toBeTruthy();
  });

  it('清除目前投射後立即回到空畫框並移除持久狀態', () => {
    pushPhantomGallery(makeGallery());
    render(<VisualsIsland />);

    fireEvent.click(screen.getByRole('button', { name: '清除目前投射' }));

    expect(screen.getByText(/畫框還空著/)).toBeTruthy();
    expect(getPhantomGallery()).toBeNull();
    expect(window.localStorage.getItem(PHANTOM_STATE_STORAGE_KEY)).toBeNull();
  });

  it('#4：clue 插播中按清除→發清除請求事件、島端不逕自全清（復原交 Reader）', () => {
    pushPhantomGallery(makeGallery({ id: 'visuals/profiles/cast/base' }));
    pushClueGallery(
      makeGallery({ id: 'visuals/illustrations/scenes/dawn', source: 'clue' })
    );
    expect(hasClueSnapshot()).toBe(true);
    render(<VisualsIsland />);

    const listener = vi.fn();
    window.addEventListener(UEP_PHANTOM_CLUE_CLEAR_EVENT, listener);
    fireEvent.click(screen.getByRole('button', { name: '清除目前投射' }));
    window.removeEventListener(UEP_PHANTOM_CLUE_CLEAR_EVENT, listener);

    // 島端只發請求（Reader 負責復原＋撤書籤）；不逕自 clearPhantomGallery
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPhantomGallery()).not.toBeNull();
    expect(hasClueSnapshot()).toBe(true);
  });

  it('展開中 push 新投射即時切換並重設索引', () => {
    pushPhantomGallery(makeGallery());
    const { container } = render(<VisualsIsland />);
    fireEvent.click(screen.getByLabelText('下一張'));
    act(() => {
      pushPhantomGallery(
        makeGallery({
          id: 'visuals/illustrations/scenes/dawn',
          title: '黎明的場景',
          source: 'clue',
        })
      );
    });
    expect(screen.getByText('黎明的場景')).toBeTruthy();
    expect(screen.getByText(/01 \//)).toBeTruthy();
    expect(container.querySelector('.uep-visland__frame img')).toBeTruthy();
  });

  it('#8 指定 initialImageId 時 mount 與即時投射都直接聚焦該圖', () => {
    pushPhantomGallery(makeGallery({ initialImageId: 'img-2' }));
    render(<VisualsIsland />);
    expect(screen.getByText('側面')).toBeTruthy();
    act(() => {
      pushPhantomGallery(
        makeGallery({
          id: 'visuals/illustrations/scenes/dawn',
          title: '黎明',
          source: 'clue',
          initialImageId: 'img-1',
        })
      );
    });
    expect(screen.getByText('正面')).toBeTruthy();
  });
});

describe('VisualsIsland 檢視器', () => {
  it('大圖顯示第一張、caption 與計數就位', () => {
    pushPhantomGallery(makeGallery());
    const { container } = render(<VisualsIsland />);
    const main = container.querySelector(
      '.uep-visland__frame img'
    ) as HTMLImageElement;
    expect(main.src).toContain('images/a.png');
    expect(screen.getByText('正面')).toBeTruthy();
    expect(screen.getByText(/01 \/\s*02/)).toBeTruthy();
  });

  it('箭頭導航循環切換', () => {
    pushPhantomGallery(makeGallery());
    render(<VisualsIsland />);
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(screen.getByText('側面')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(screen.getByText('正面')).toBeTruthy(); // 循環回第一張
    fireEvent.click(screen.getByLabelText('上一張'));
    expect(screen.getByText('側面')).toBeTruthy();
  });

  it('點縮圖直接跳到該張', () => {
    pushPhantomGallery(makeGallery());
    render(<VisualsIsland />);
    fireEvent.click(screen.getByLabelText('檢視第 2 張'));
    expect(screen.getByText('側面')).toBeTruthy();
  });

  it('單張圖片不顯示箭頭', () => {
    pushPhantomGallery(
      makeGallery({
        images: [
          { id: 'img-1', file: 'images/a.png', caption: '唯一', sortOrder: 0 },
        ],
      })
    );
    render(<VisualsIsland />);
    expect(screen.queryByLabelText('下一張')).toBeNull();
  });
});

describe('VisualsIsland entity 嵌入提示', () => {
  it('mount 時消費 pending 提示（Host 先推、島後開的順序）', () => {
    pushPhantomSuggestion(makeGallery({ source: 'embed', title: '相關畫廊' }));
    render(<VisualsIsland />);
    expect(screen.getByText('相關畫廊')).toBeTruthy();
    expect(screen.getByText('展示')).toBeTruthy();
  });

  it('無投射時提示卡仍出現（嵌入可先於任何投射）', () => {
    pushPhantomSuggestion(makeGallery({ source: 'embed', title: '相關畫廊' }));
    render(<VisualsIsland />);
    expect(screen.getByText(/畫框還空著/)).toBeTruthy();
    expect(screen.getByText('相關畫廊')).toBeTruthy();
  });

  it('展開中即時接收提示', () => {
    pushPhantomGallery(makeGallery());
    render(<VisualsIsland />);
    act(() => {
      pushPhantomSuggestion(
        makeGallery({
          id: 'visuals/profiles/cast/rival',
          title: '對手設定集',
          source: 'embed',
        })
      );
    });
    expect(screen.getByText('對手設定集')).toBeTruthy();
    // 提示不影響目前投射
    expect(screen.getByText('女主角設定集')).toBeTruthy();
  });

  it('按「展示」提示轉為正式投射並收卡', () => {
    pushPhantomSuggestion(
      makeGallery({
        id: 'visuals/profiles/cast/rival',
        title: '對手設定集',
        source: 'embed',
      })
    );
    render(<VisualsIsland />);
    fireEvent.click(screen.getByText('展示'));
    expect(screen.queryByText('展示')).toBeNull();
    expect(screen.getByText('對手設定集')).toBeTruthy();
    expect(screen.getByText(/01 \//)).toBeTruthy();
  });

  it('pending 提示的畫廊已在投射中 → 不出卡（推送之後才變成正在展示）', () => {
    pushPhantomSuggestion(makeGallery({ source: 'embed' }));
    pushPhantomGallery(makeGallery()); // 同一個 gallery 已被投上去
    render(<VisualsIsland />);
    expect(screen.getByText('女主角設定集')).toBeTruthy();
    expect(screen.queryByText('展示')).toBeNull();
  });

  it('按「忽略」收卡且不換投射', () => {
    pushPhantomGallery(makeGallery());
    render(<VisualsIsland />);
    act(() => {
      pushPhantomSuggestion(
        makeGallery({ id: 'visuals/profiles/cast/rival', title: '對手設定集' })
      );
    });
    fireEvent.click(screen.getByText('忽略'));
    expect(screen.queryByText('對手設定集')).toBeNull();
    expect(screen.getByText('女主角設定集')).toBeTruthy();
  });
});

describe('VisualsIsland 三態', () => {
  it('A 鎖定：縮圖為鎖定格不載圖，大圖切到時也不載圖', () => {
    pushPhantomGallery(makeThreeStateGallery());
    const { container } = render(<VisualsIsland />);
    const thumbs = container.querySelectorAll('.uep-visland__thumb');
    expect(thumbs[1].querySelector('img')).toBeNull();
    expect(thumbs[1].querySelector('.uep-visland__locked')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('第 2 張（未解鎖）'));
    expect(container.querySelector('.uep-visland__frame img')).toBeNull();
    expect(
      container.querySelector('.uep-visland__frame .uep-visland__locked')
    ).toBeTruthy();
    expect(screen.getByText('？？？')).toBeTruthy();
  });

  it('B 部分解鎖：縮圖與大圖掛 is-partial 模糊、caption 帶標記', () => {
    pushPhantomGallery(makeThreeStateGallery());
    const { container } = render(<VisualsIsland />);
    const thumbs = container.querySelectorAll('.uep-visland__thumb');
    expect(thumbs[2].className).toContain('is-partial');

    fireEvent.click(screen.getByLabelText('檢視第 3 張'));
    const frame = container.querySelector('.uep-visland__frame')!;
    expect(frame.className).toContain('is-partial');
    expect(frame.querySelector('img')).toBeTruthy(); // B 仍載圖，靠遮罩
    expect(screen.getByText(/尚未完全顯現/)).toBeTruthy();
  });

  it('第一張圖恆等式：即使標了 locked 仍完整顯示', () => {
    pushPhantomGallery(
      makeGallery({
        images: [
          {
            id: 'img-1',
            file: 'images/a.png',
            caption: '第一張',
            sortOrder: 0,
            initialState: 'locked',
          },
        ],
      })
    );
    const { container } = render(<VisualsIsland />);
    expect(container.querySelector('.uep-visland__frame img')).toBeTruthy();
  });
});
