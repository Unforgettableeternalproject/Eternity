/**
 * 保底解鎖小物件測試（S9-B）
 *
 * S9-B 起本元件預設關閉（`UNLOCK_OBJECT_ENABLED = false`）——各 zone 已有
 * 專屬儀式，兩個入口做同一件事會讓使用者困惑（艾斯維爾 07/25 一驗）。
 * 這裡守著「即使資格全過也不該冒出來」，避免日後改動不小心把它放回來。
 */

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UnlockEligibility } from '../unlockRitual';

const ritualMock = vi.hoisted(() => ({
  eligibility: {
    canUse: true,
    visited: true,
    unlocked: false,
    eligible: true,
  } as UnlockEligibility,
}));
vi.mock('../unlockRitual', () => ({
  AWAKEN_MS: 100,
  useUnlockEligibility: () => ritualMock.eligibility,
  completeUnlockRitual: vi.fn(),
}));

import IslandUnlockObject from '../IslandUnlockObject';

describe('IslandUnlockObject', () => {
  it('資格全過也不渲染——S9-B 起預設關閉', () => {
    const { container } = render(<IslandUnlockObject zoneId="storage" />);
    expect(container.querySelector('.uep-unlock-object')).toBeNull();
  });

  it('非浮島 zone 一律不渲染', () => {
    const { container } = render(<IslandUnlockObject zoneId="portal" />);
    expect(container.firstChild).toBeNull();
  });
});
