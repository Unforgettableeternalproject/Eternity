import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { READER_SESSION_KEY } from '../../../auth/readerAuth';
import { PINNED_STORAGE_KEY } from '../../../islands/storage/pinnedStore';
import { PROGRESS_STORAGE_KEY } from '../../../progress/adapters';
import OnboardingGate, { ONBOARDED_KEY } from '../OnboardingGate';

describe('OnboardingGate console 測試 bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.sessionStorage.clear();
    delete window.__uepOnboardingTest;
  });

  afterEach(() => {
    delete window.__uepOnboardingTest;
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('掛上 window.__uepOnboardingTest 並可直接叫出入站選擇', async () => {
    render(<OnboardingGate />);

    await waitFor(() => expect(window.__uepOnboardingTest).toBeTruthy());
    act(() => window.__uepOnboardingTest!.showChoice());

    expect(
      screen.getByRole('dialog', { name: '你想以什麼身分遊歷這個世界？' })
    ).toBeTruthy();
  });

  it('儀式下方有直接登入捷徑，導向 /login 且不標記 onboarded（S7 驗收 #1）', async () => {
    render(<OnboardingGate />);

    await waitFor(() => expect(window.__uepOnboardingTest).toBeTruthy());
    act(() => window.__uepOnboardingTest!.showChoice());

    const link = screen.getByRole('link', {
      name: '已經銘刻過記錄？直接登入 ▸',
    });
    expect(link.getAttribute('href')).toBe('/login?return=%2F');
    // 捷徑是純連結——點擊前後皆不寫 onboarded 標記
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBeNull();
  });

  it('可直接叫出觀測者協議儀式', async () => {
    render(<OnboardingGate />);

    await waitFor(() => expect(window.__uepOnboardingTest).toBeTruthy());
    act(() => window.__uepOnboardingTest!.showObserverGate());

    expect(
      screen.getByRole('alertdialog', { name: '觀測者協議' })
    ).toBeTruthy();
  });

  it('resetLocalIdentity 可清除本機入站紀錄並在不 reload 時顯示選擇', async () => {
    window.localStorage.setItem(ONBOARDED_KEY, '2026-07-04T00:00:00.000Z');
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, '{"view":"observer"}');

    render(<OnboardingGate />);

    await waitFor(() => expect(window.__uepOnboardingTest).toBeTruthy());
    await act(async () => {
      await window.__uepOnboardingTest!.resetLocalIdentity({ reload: false });
    });

    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBeNull();
    expect(window.localStorage.getItem(PROGRESS_STORAGE_KEY)).toBeNull();
    expect(window.__uepOnboardingTest!.status()).toMatchObject({
      stage: 'choice',
      onboarded: false,
      progressExists: false,
    });
  });

  /**
   * 【回歸 2026-07-26】重置必須連登入 session 一起斷。
   *
   * 舊實作只 removeItem 了 onboarded 與 progress 兩把 key，session 原封
   * 不動。重載後 readerAuth 偵測到 session 仍在 → attachServerAdapter →
   * 把伺服器上的舊帳號進度 hydrate 回來，progress key 復活、OnboardingGate
   * 下一輪直接放行，使用者看到的就是「重置了幾次又自己變回舊帳號」。
   */
  it('resetLocalIdentity 會清掉登入 session 與整個 UEP 命名空間', async () => {
    window.localStorage.setItem(ONBOARDED_KEY, 'x');
    window.localStorage.setItem(READER_SESSION_KEY, '{"token":"t"}');
    window.localStorage.setItem(PINNED_STORAGE_KEY, '[]');
    window.localStorage.setItem('uep.islands.v1.history', '{}');
    window.localStorage.setItem('uep.islands.terminal.v1', '[]');
    window.sessionStorage.setItem('uep.welcome.pending.v1', 'login');
    // 命名空間外的第三方 key 不該被波及
    window.localStorage.setItem('unrelated-app-key', 'keep');

    render(<OnboardingGate />);
    await waitFor(() => expect(window.__uepOnboardingTest).toBeTruthy());
    await act(async () => {
      await window.__uepOnboardingTest!.resetLocalIdentity({ reload: false });
    });

    expect(window.localStorage.getItem(READER_SESSION_KEY)).toBeNull();
    expect(window.localStorage.getItem(PINNED_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem('uep.islands.v1.history')).toBeNull();
    expect(window.localStorage.getItem('uep.islands.terminal.v1')).toBeNull();
    expect(window.sessionStorage.getItem('uep.welcome.pending.v1')).toBeNull();
    expect(window.localStorage.getItem('unrelated-app-key')).toBe('keep');
  });
});
