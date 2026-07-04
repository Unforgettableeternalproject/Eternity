import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROGRESS_STORAGE_KEY } from '../../../progress/adapters';
import OnboardingGate, { ONBOARDED_KEY } from '../OnboardingGate';

describe('OnboardingGate console 測試 bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    delete window.__uepOnboardingTest;
  });

  afterEach(() => {
    delete window.__uepOnboardingTest;
    window.localStorage.clear();
  });

  it('掛上 window.__uepOnboardingTest 並可直接叫出入站選擇', async () => {
    render(<OnboardingGate />);

    await waitFor(() => expect(window.__uepOnboardingTest).toBeTruthy());
    act(() => window.__uepOnboardingTest!.showChoice());

    expect(
      screen.getByRole('dialog', { name: '你想以什麼身分遊歷這個世界？' })
    ).toBeTruthy();
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
    act(() =>
      window.__uepOnboardingTest!.resetLocalIdentity({ reload: false })
    );

    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBeNull();
    expect(window.localStorage.getItem(PROGRESS_STORAGE_KEY)).toBeNull();
    expect(window.__uepOnboardingTest!.status()).toMatchObject({
      stage: 'choice',
      onboarded: false,
      progressExists: false,
    });
  });
});
