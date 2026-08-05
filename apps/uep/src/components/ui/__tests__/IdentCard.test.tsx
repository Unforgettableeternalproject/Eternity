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

function backInner(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.uep-ident__back-inner');
}

describe('IdentCard', () => {
  beforeEach(() => {
    session.observerEver = false;
    progress.islandsUnlocked = [];
    flags.has = false;
    requestGuide.mockClear();
  });

  it('背面內容包在可量測的內容層裡', () => {
    const { container } = render(<IdentCard />);
    const inner = backInner(container);
    expect(inner).toBeTruthy();
    expect(inner!.parentElement!.className).toContain('uep-ident__face--back');
  });

  it('會變動的區塊都在內容層之內——量它才算得出正確高度', () => {
    session.observerEver = true;
    progress.islandsUnlocked = ['history'];
    const { container } = render(<IdentCard />);
    const inner = backInner(container)!;

    // 代稱（窄視窗會折行）、資料列（兩列是條件渲染）、撕下提示（最容易被切掉）
    expect(inner.querySelector('.uep-ident__alias')).toBeTruthy();
    expect(inner.querySelectorAll('.uep-ident__row')).toHaveLength(5);
    expect(inner.querySelector('.uep-ident__tear-hint')).toBeTruthy();
  });

  describe('教學觸發', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
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

    it('收到翻開事件就展開證卡', async () => {
      const { container } = render(<IdentCard />);
      expect(container.querySelector('.uep-ident.is-open')).toBeNull();

      await act(async () => {
        window.dispatchEvent(new CustomEvent('uep:ident-open'));
      });

      expect(container.querySelector('.uep-ident.is-open')).toBeTruthy();
    });
  });
});
