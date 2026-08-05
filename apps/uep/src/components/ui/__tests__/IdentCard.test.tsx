/**
 * IdentCard 測試
 *
 * 兩組契約：
 *
 * 1. 展開高度所依賴的 `--ident-rows` 要跟著實際渲染的列數走。證卡背面是
 *    `position: absolute; inset: 0`，容器不會被內容撐開——高度給死的話，
 *    多出來的列會把底部的撕下提示（唯一的登出說明）擠進 overflow: hidden
 *    的裁切區。這是 2026-08-05 回報的實際災情。
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

function rowsOf(container: HTMLElement): string {
  const root = container.querySelector('.uep-ident') as HTMLElement;
  return root.style.getPropertyValue('--ident-rows');
}

describe('IdentCard', () => {
  beforeEach(() => {
    session.observerEver = false;
    progress.islandsUnlocked = [];
    flags.has = false;
    requestGuide.mockClear();
  });

  it('只有恆在的三列時 --ident-rows 是 3', () => {
    const { container } = render(<IdentCard />);
    expect(rowsOf(container)).toBe('3');
    expect(container.querySelectorAll('.uep-ident__row')).toHaveLength(3);
  });

  it('浮島與印記兩列都出現時算到 5', () => {
    session.observerEver = true;
    progress.islandsUnlocked = ['history', 'echoes'];
    const { container } = render(<IdentCard />);
    expect(rowsOf(container)).toBe('5');
    expect(container.querySelectorAll('.uep-ident__row')).toHaveLength(5);
  });

  it('--ident-rows 與實際列數一致（只有浮島）', () => {
    progress.islandsUnlocked = ['history'];
    const { container } = render(<IdentCard />);
    expect(rowsOf(container)).toBe(
      String(container.querySelectorAll('.uep-ident__row').length)
    );
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
