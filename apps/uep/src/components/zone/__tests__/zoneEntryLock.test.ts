// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  ZONE_ENTRY_ACTIVE_CLASS,
  acquireZoneEntryLock,
  isZoneEntryActive,
  resetZoneEntryLock,
} from '../zoneEntryLock';

const hasClass = () =>
  document.body.classList.contains(ZONE_ENTRY_ACTIVE_CLASS);

describe('zoneEntryLock', () => {
  afterEach(() => {
    resetZoneEntryLock();
  });

  it('取得鎖時掛上 body class，釋放後移除', () => {
    expect(hasClass()).toBe(false);
    const release = acquireZoneEntryLock();
    expect(hasClass()).toBe(true);
    expect(isZoneEntryActive()).toBe(true);
    release();
    expect(hasClass()).toBe(false);
    expect(isZoneEntryActive()).toBe(false);
  });

  it('多來源重疊：全部釋放前 class 不消失（ref-count）', () => {
    const releasePortal = acquireZoneEntryLock();
    const releaseBoot = acquireZoneEntryLock();
    releasePortal();
    expect(hasClass()).toBe(true);
    releaseBoot();
    expect(hasClass()).toBe(false);
  });

  it('釋放函式重複呼叫安全（不會扣成負數）', () => {
    const releaseA = acquireZoneEntryLock();
    releaseA();
    releaseA();
    const releaseB = acquireZoneEntryLock();
    expect(hasClass()).toBe(true);
    releaseB();
    expect(hasClass()).toBe(false);
  });
});
