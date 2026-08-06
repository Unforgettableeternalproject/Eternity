/**
 * IdentCard 測試
 *
 * 兩組契約：
 *
 * 1. 背面內容必須包在 `.uep-ident__back-inner` 裡。展開高度是量那一層算出來
 *    的（背面 absolute 定位，撐不開容器；高度不夠時底部的撕下提示——唯一的
 *    登出說明——會被 overflow: hidden 切掉）。jsdom 沒有版面，量不到真實
 *    高度，所以這裡只釘結構，實際高度靠瀏覽器驗收。
 * 2. 識別證教學的觸發：登入儀式演完 + 沒看過 → 請求；以及外部要求翻開時
 *    真的翻開（教學要指的東西全在背面）。
 */
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { WELCOME_DONE_EVENT } from '../GlobalWelcomeHost';
import IdentCard from '../IdentCard';

const session = {
  token: 't',
  username: 'Test',
  alias: '守夜的譯讀者',
  observerEver: false,
};

const progress = {
  view: 'observer' as 'observer' | 'explorer',
  completedPageIds: [] as string[],
  flags: [] as string[],
  islandsUnlocked: [] as string[],
};

vi.mock('../../../auth', () => ({
  useReaderAuth: () => session,
  getReaderAuth: () => ({
    displayAlias: () => `已見證的${session.alias}`,
    logout: vi.fn(),
  }),
}));

vi.mock('../../../progress/useProgress', () => ({
  useProgress: () => progress,
}));

const flags = { has: false };
vi.mock('../../../progress', () => ({
  getProgressManager: () => ({ hasFlag: () => flags.has }),
}));

const requestGuide = vi.fn();
vi.mock('../../../islands/guide/guideRequest', () => ({
  requestGuide: (id: string) => requestGuide(id),
}));

vi.mock('../ViewSwitch', () => ({
  default: () => <div data-testid="view-switch" />,
}));

vi.mock('../../../islands/IslandSettingsPanel', () => ({
  default: () => null,
}));

/* 視窗寬度替身。順帶隔開 islandRuntime 的模組載入副作用——它在載入
   當下就會讀 readerAuth，本檔的 auth 替身沒有那些方法 */
const viewport = { desktop: true };
vi.mock('../../../islands/useIslands', () => ({
  useDesktopIslandViewport: () => viewport.desktop,
}));

/* 一律查 baseElement（＝document.body）而不是 render 回傳的 container：
   識別證 portal 到 body 才能逃出 TopBar 的堆疊上下文，DOM 上並不在
   container 裡面。 */
function backInner(root: HTMLElement): HTMLElement | null {
  return root.querySelector('.uep-ident__back-inner');
}

describe('IdentCard', () => {
  beforeEach(() => {
    session.observerEver = false;
    progress.islandsUnlocked = [];
    flags.has = false;
    viewport.desktop = true;
    requestGuide.mockClear();
  });

  it('背面內容包在可量測的內容層裡', () => {
    const { baseElement } = render(<IdentCard />);
    const inner = backInner(baseElement);
    expect(inner).toBeTruthy();
    expect(inner!.parentElement!.className).toContain('uep-ident__face--back');
  });

  it('會變動的區塊都在內容層之內——量它才算得出正確高度', () => {
    session.observerEver = true;
    progress.islandsUnlocked = ['history'];
    const { baseElement } = render(<IdentCard />);
    const inner = backInner(baseElement)!;

    // 代稱（窄視窗會折行）、資料列（兩列是條件渲染）、撕下提示（最容易被切掉）
    expect(inner.querySelector('.uep-ident__alias')).toBeTruthy();
    expect(inner.querySelectorAll('.uep-ident__row')).toHaveLength(5);
    expect(inner.querySelector('.uep-ident__tear-hint')).toBeTruthy();
  });

  /* 識別證掛在 TopBar 下緣，但不能是它的子元素：sticky 讓 TopBar 成為
     堆疊上下文，整個子樹都畫在 100 那一層，浮島（2000+）一律蓋在上面。
     抬高 TopBar 不是解法——整條頂欄會浮到浮島之上把它們裁掉。 */
  describe('脫離 TopBar 的堆疊上下文', () => {
    afterEach(() => {
      document.querySelector('.uep-topbar')?.remove();
    });

    function mountTopBar(bottom: number): HTMLElement {
      const bar = document.createElement('div');
      bar.className = 'uep-topbar';
      bar.getBoundingClientRect = () => ({ bottom }) as DOMRect;
      document.body.appendChild(bar);
      return bar;
    }

    it('render 到 body 而不是呼叫端的容器裡', () => {
      const { container, baseElement } = render(<IdentCard />);
      expect(container.querySelector('.uep-ident')).toBeNull();
      expect(baseElement.querySelector('.uep-ident')).toBeTruthy();
    });

    it('垂直位置量 TopBar 的下緣', () => {
      class MockResizeObserver {
        observe() {}
        disconnect() {}
      }
      vi.stubGlobal('ResizeObserver', MockResizeObserver);
      mountTopBar(88);

      const { baseElement } = render(<IdentCard />);
      const root = baseElement.querySelector('.uep-ident') as HTMLElement;
      expect(root.style.getPropertyValue('--ident-anchor-top')).toBe('88px');

      vi.unstubAllGlobals();
    });

    /* 沒有頂欄的頁面本來就不掛識別證；量測失敗不該讓整張卡消失或
       疊到畫面左上角，交給 CSS 的預設值 */
    it('找不到 TopBar 時不寫錨點，由 CSS 預設值接手', () => {
      const { baseElement } = render(<IdentCard />);
      const root = baseElement.querySelector('.uep-ident') as HTMLElement;
      expect(root.style.getPropertyValue('--ident-anchor-top')).toBe('');
    });
  });

  /* 手機沒有浮島，所以齒輪開的偏好面板必然是空的；而撕下手勢在手機上
     與瀏覽器下拉重整衝突，登出改走明確按鈕 */
  describe('手機分支', () => {
    it('桌面：有齒輪、有撕下提示、沒有登出按鈕', () => {
      const { baseElement } = render(<IdentCard />);
      expect(baseElement.querySelector('.uep-ident__gear')).toBeTruthy();
      expect(baseElement.querySelector('.uep-ident__tear-hint')).toBeTruthy();
      expect(baseElement.querySelector('.uep-ident__logout')).toBeNull();
    });

    it('手機：齒輪與撕下提示都消失，換成登出按鈕', () => {
      viewport.desktop = false;
      const { baseElement } = render(<IdentCard />);
      expect(baseElement.querySelector('.uep-ident__gear')).toBeNull();
      expect(baseElement.querySelector('.uep-ident__tear-hint')).toBeNull();
      expect(baseElement.querySelector('.uep-ident__logout')).toBeTruthy();
    });

    it('手機的登出按鈕在可量測的內容層之內', () => {
      viewport.desktop = false;
      const { baseElement } = render(<IdentCard />);
      // 與撕下提示同一個位置——它是展開高度的最後一個元素，最容易被切掉
      expect(
        backInner(baseElement)!.querySelector('.uep-ident__logout')
      ).toBeTruthy();
    });
  });

  /* 基礎設施缺席時的行為。Dialog／Toast 都掛在 DesignLayout 且已改為
     client:load，正常情況走不到這裡；但慢裝置上的 hydration 競態一旦
     重演，使用者至少要知道發生了什麼，而不是以為自己按錯。 */
  describe('對話框尚未就緒', () => {
    afterEach(() => {
      delete (window as unknown as Record<string, unknown>).__uepDialogManager;
      delete (window as unknown as Record<string, unknown>).__uepToastManager;
    });

    it('沒有 dialog manager 時不登出，改用 toast 告知', async () => {
      const info = vi.fn();
      (window as unknown as Record<string, unknown>).__uepToastManager = {
        info,
      };
      viewport.desktop = false;
      const { baseElement } = render(<IdentCard />);

      const btn = baseElement.querySelector('.uep-ident__logout')!;
      await act(async () => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(info).toHaveBeenCalled();
      // 沒有 dialog 就不該播撕開動畫（那代表登出已成立）
      expect(baseElement.querySelector('.uep-ident.is-torn')).toBeNull();
    });

    it('連 toast 都缺席也不擲錯——選擇性串連不能變成例外', async () => {
      viewport.desktop = false;
      const { baseElement } = render(<IdentCard />);
      const btn = baseElement.querySelector('.uep-ident__logout')!;
      await act(async () => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(baseElement.querySelector('.uep-ident.is-torn')).toBeNull();
    });
  });

  describe('教學觸發', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      document.documentElement.classList.remove('uep-welcome-pending');
    });

    /** 登入儀式結束 → 掛上動畫 → 才輪到教學 */
    async function playWelcome() {
      await act(async () => {
        window.dispatchEvent(new CustomEvent(WELCOME_DONE_EVENT));
        await vi.advanceTimersByTimeAsync(3000);
      });
    }

    it('登入儀式演完後請求識別證教學', async () => {
      render(<IdentCard />);
      await playWelcome();
      expect(requestGuide).toHaveBeenCalledWith('ident');
    });

    it('掛上動畫還沒演完就不請求——教學不該蓋在動畫上', async () => {
      render(<IdentCard />);
      await act(async () => {
        window.dispatchEvent(new CustomEvent(WELCOME_DONE_EVENT));
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(requestGuide).not.toHaveBeenCalled();
    });

    it('看過的人不再請求', async () => {
      flags.has = true;
      render(<IdentCard />);
      await playWelcome();
      expect(requestGuide).not.toHaveBeenCalled();
    });

    it('一般換頁（沒有登入儀式）不請求', async () => {
      render(<IdentCard />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(requestGuide).not.toHaveBeenCalled();
    });

    /* 儀式期間識別證必須完全不可見：否則它會在全屏遮罩底下把 drop 動畫
       跑完，遮罩一淡出就是「已經掛好的識別證」，接著才播 arrival——
       同一張卡出現兩次 */
    it('儀式進行中先藏起來，直到 arrival 開播才現身', async () => {
      document.documentElement.classList.add('uep-welcome-pending');
      const { baseElement } = render(<IdentCard />);
      expect(
        baseElement.querySelector('.uep-ident.is-welcome-pending')
      ).toBeTruthy();

      await playWelcome();

      expect(
        baseElement.querySelector('.uep-ident.is-welcome-pending')
      ).toBeNull();
    });

    it('解除隱藏與 arrival 同一刻發生——中間不留靜止的一幀', async () => {
      document.documentElement.classList.add('uep-welcome-pending');
      const { baseElement } = render(<IdentCard />);

      await act(async () => {
        window.dispatchEvent(new CustomEvent(WELCOME_DONE_EVENT));
        /* 剛好跨過 ARRIVAL_POST_WELCOME_DELAY_MS，還沒到動畫結束 */
        await vi.advanceTimersByTimeAsync(400);
      });

      const root = baseElement.querySelector('.uep-ident')!;
      expect(root.className).not.toContain('is-welcome-pending');
      expect(root.className).toContain('is-arriving');
    });

    it('儀式沒送出結束事件時，保險計時器仍會讓識別證現身', async () => {
      document.documentElement.classList.add('uep-welcome-pending');
      const { baseElement } = render(<IdentCard />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6100);
      });

      expect(
        baseElement.querySelector('.uep-ident.is-welcome-pending')
      ).toBeNull();
    });

    it('一般換頁不隱藏識別證', () => {
      const { baseElement } = render(<IdentCard />);
      expect(
        baseElement.querySelector('.uep-ident.is-welcome-pending')
      ).toBeNull();
    });

    it('收到翻開事件就展開證卡', async () => {
      const { baseElement } = render(<IdentCard />);
      expect(baseElement.querySelector('.uep-ident.is-open')).toBeNull();

      await act(async () => {
        window.dispatchEvent(new CustomEvent('uep:ident-open'));
      });

      expect(baseElement.querySelector('.uep-ident.is-open')).toBeTruthy();
    });
  });
});
