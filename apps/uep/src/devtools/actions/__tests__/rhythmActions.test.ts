/**
 * 閱讀節奏／浮島教學 DevTools actions 測試（S10-4）
 *
 * 重點在「跳過門檻但走正規路徑」這件事有沒有真的成立：
 * - 強制閒置走的是 activityWatch 的正規判定（會通知訂閱者），不是設旗標
 * - 休息提醒與 activityWatch 都可能沒掛載（非 Reader 頁），available 要擋住
 * - 清除 seen 的動作真的動到 progress
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRegistry } from '../../actionRegistry';
import {
  startActivityWatch,
  stopActivityWatch,
  subscribeActivity,
} from '../../../lib/activityWatch';
import { clearUepSettingsCache } from '../../../lib/uepSettings';
import { getProgressManager } from '../../../progress';
import { registerRhythmActions } from '../rhythmActions';

const ACTION_IDS = [
  'rhythm:force-idle',
  'rhythm:status',
  'rhythm:restart-watch',
  'rhythm:trigger-rest',
  'rhythm:rest-status',
  'guide:clear-seen-all',
  'guide:clear-session-limit',
  'guide:play:history',
  'guide:clear-seen:history',
];

function mockSettings() {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        settings: {
          'reader.activityIdleThresholdSec': 180,
          'reader.idleNudgeMode': 'enabled',
        },
      },
    }),
  })) as unknown as typeof fetch;
}

describe('rhythmActions', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearUepSettingsCache();
    delete window.__uepSettings;
    delete document.body.dataset.readerPage;
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    mockSettings();
    registerRhythmActions();
  });

  afterEach(() => {
    stopActivityWatch();
    getRegistry().unregister(ACTION_IDS);
    vi.restoreAllMocks();
  });

  it('全部 action 都註冊了', () => {
    const ids = getRegistry()
      .getAll()
      .map((a) => a.id);
    for (const id of ACTION_IDS) expect(ids).toContain(id);
  });

  it('非 Reader 頁時 activityWatch 相關 action 不可用', () => {
    const forceIdle = getRegistry()
      .getAll()
      .find((a) => a.id === 'rhythm:force-idle');
    expect(forceIdle?.available?.()).toBe(false);

    document.body.dataset.readerPage = 'true';
    expect(forceIdle?.available?.()).toBe(true);
  });

  it('強制閒置走正規判定——訂閱者會收到通知', async () => {
    document.body.dataset.readerPage = 'true';
    await startActivityWatch();
    const seen: boolean[] = [];
    subscribeActivity((s) => seen.push(s.idle));

    await getRegistry().dispatch('rhythm:force-idle');
    expect(seen).toEqual([true]);
  });

  it('休息提醒 bridge 未掛載時不可用，也不會丟錯', async () => {
    const trigger = getRegistry()
      .getAll()
      .find((a) => a.id === 'rhythm:trigger-rest');
    expect(trigger?.available?.()).toBe(false);

    const result = await getRegistry().dispatch('rhythm:trigger-rest');
    expect(result.ok).toBe(true);
  });

  it('bridge 掛載時觸發會呼叫到它', async () => {
    const trigger = vi.fn();
    window.__uepRestReminderTest = {
      trigger,
      dismiss: () => {},
      state: () => ({
        activeMs: 0,
        completedInWindow: 0,
        cooldownRemainingMs: 0,
        pending: false,
      }),
    };

    await getRegistry().dispatch('rhythm:trigger-rest');
    expect(trigger).toHaveBeenCalled();
    delete window.__uepRestReminderTest;
  });

  it('清除已看過的教學真的動到 progress', async () => {
    const progress = getProgressManager();
    progress.markIslandGuideSeen('history');
    progress.markIslandGuideSeen('echoes');

    await getRegistry().dispatch('guide:clear-seen:history');
    expect(progress.getState().islandGuidesSeen).toEqual(['echoes']);

    await getRegistry().dispatch('guide:clear-seen-all');
    expect(progress.getState().islandGuidesSeen).toEqual([]);
  });

  it('解除 session 上限會清掉 sessionStorage key', async () => {
    sessionStorage.setItem('uep-island-guide-auto-shown', 'true');
    await getRegistry().dispatch('guide:clear-session-limit');
    expect(sessionStorage.getItem('uep-island-guide-auto-shown')).toBeNull();
  });
});
