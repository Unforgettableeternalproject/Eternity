/**
 * IslandSettingsPanel 測試（2026-08-12 解鎖提示）
 *
 * 契約：鎖定列不露島名（維持「未知的浮島」），問號按鈕內帶一則漸進解碼
 * 的解鎖提示氣泡（hover/focus 揭示由 CSS 負責，jsdom 只釘結構）；
 * 已解鎖列顯示島名、不帶提示。
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createInitialState } from '../../progress/types';
import type { ProgressState } from '../../progress/types';
import IslandSettingsPanel from '../IslandSettingsPanel';

const progressRef: { state: ProgressState } = {
  state: createInitialState(),
};

vi.mock('../../progress', () => ({
  useProgress: () => progressRef.state,
  getProgressManager: () => ({ setIslandDisabled: vi.fn() }),
}));

vi.mock('../guide/guideRequest', () => ({ requestGuide: vi.fn() }));

/* islandRuntime 在模組載入當下就會讀 readerAuth——用純函式替身隔開副作用 */
vi.mock('../islandRuntime', () => ({
  isIslandUnlocked: (state: ProgressState, id: string) =>
    state.islandsUnlocked.includes(id),
  isIslandDisabled: (state: ProgressState, id: string) =>
    state.islandsDisabled.includes(id),
}));

describe('IslandSettingsPanel', () => {
  beforeEach(() => {
    progressRef.state = createInitialState();
  });

  it('鎖定列的問號按鈕內帶漸進解碼提示（含遮蔽字元），不露島名', () => {
    const { baseElement } = render(<IslandSettingsPanel onClose={() => {}} />);
    const locked = baseElement.querySelectorAll(
      '.uep-island-settings__row--locked'
    );
    expect(locked).toHaveLength(5);
    locked.forEach((row) => {
      expect(row.textContent).toContain('未知的浮島');
      const hint = row.querySelector('.uep-island-settings__hint');
      expect(hint).toBeTruthy();
      expect(hint!.textContent).toContain('▓');
      // 氣泡必須在問號按鈕裡——hover/focus 的 CSS 揭示規則靠這層結構
      const btn = hint!.closest('.uep-island-settings__hint-btn');
      expect(btn).toBeTruthy();
      expect(btn!.tagName).toBe('BUTTON');
      // 遮蔽字元對 AT 是雜訊：氣泡隱藏、語意在按鈕的 aria-label
      expect(hint!.getAttribute('aria-hidden')).toBe('true');
      expect(btn!.getAttribute('aria-label')).toContain('解鎖提示');
    });
  });

  it('熟悉度提高後提示露出更多字（遮蔽字元變少）', () => {
    const first = render(<IslandSettingsPanel onClose={() => {}} />);
    const maskedBefore = first.baseElement
      .querySelector('.uep-island-settings__hint')!
      .textContent!.split('▓').length;
    first.unmount();

    progressRef.state = {
      ...createInitialState(),
      flags: ['zone:visited:history'],
      zoneFamiliarity: { history: 20 },
    };
    const second = render(<IslandSettingsPanel onClose={() => {}} />);
    const maskedAfter = second.baseElement
      .querySelector('.uep-island-settings__hint')!
      .textContent!.split('▓').length;
    expect(maskedAfter).toBeLessThan(maskedBefore);
  });

  it('已解鎖列顯示島名、不帶提示', () => {
    progressRef.state = {
      ...createInitialState(),
      islandsUnlocked: ['history'],
    };
    const { baseElement } = render(<IslandSettingsPanel onClose={() => {}} />);
    expect(baseElement.textContent).toContain('旅程之書');
    expect(
      baseElement.querySelectorAll('.uep-island-settings__row--locked')
    ).toHaveLength(4);
    expect(
      baseElement.querySelectorAll('.uep-island-settings__hint')
    ).toHaveLength(4);
  });
});
