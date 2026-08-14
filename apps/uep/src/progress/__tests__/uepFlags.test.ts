import { describe, it, expect, beforeEach } from 'vitest';

import { getProgressManager } from '../progressStore';
import {
  UEP_FLAGS,
  UEP_ZONE_IDS,
  markUepAfk,
  markUepFromFar,
  markUepIntro,
  markZoneVisited,
  syncDerivedUepFlags,
  zoneVisitedFlag,
} from '../uepFlags';

const manager = () => getProgressManager();

describe('uepFlags', () => {
  beforeEach(() => {
    manager().reset();
  });

  it('進站授予 uep:intro', () => {
    markUepIntro();
    expect(manager().hasFlag(UEP_FLAGS.intro)).toBe(true);
  });

  it('造訪足跡以 zone:visited: 為前綴', () => {
    expect(zoneVisitedFlag('history')).toBe('zone:visited:history');
  });

  it('走過部分區域不給 uep:all-zone', () => {
    markZoneVisited('history');
    markZoneVisited('echoes');
    expect(manager().hasFlag(UEP_FLAGS.allZone)).toBe(false);
  });

  it('五區走完才給 uep:all-zone', () => {
    for (const zone of UEP_ZONE_IDS) markZoneVisited(zone);
    expect(manager().hasFlag(UEP_FLAGS.allZone)).toBe(true);
  });

  it('五座島全解鎖才給 uep:all-island', () => {
    for (const island of UEP_ZONE_IDS.slice(0, 4)) {
      manager().unlockIsland(island);
    }
    syncDerivedUepFlags();
    expect(manager().hasFlag(UEP_FLAGS.allIsland)).toBe(false);

    manager().unlockIsland(UEP_ZONE_IDS[4]);
    syncDerivedUepFlags();
    expect(manager().hasFlag(UEP_FLAGS.allIsland)).toBe(true);
  });

  /* 推導旗標的條件也可能在遠端 hydrate 帶回另一台裝置的進度時湊齊，
     所以 sync 必須是「重算」而不是「事件當下判斷一次」。 */
  it('sync 可重複呼叫且冪等', () => {
    for (const zone of UEP_ZONE_IDS) markZoneVisited(zone);
    syncDerivedUepFlags();
    syncDerivedUepFlags();
    const count = manager()
      .getState()
      .flags.filter((f) => f === UEP_FLAGS.allZone).length;
    expect(count).toBe(1);
  });

  it('afk 與 from-far 各自獨立授予', () => {
    markUepAfk();
    expect(manager().hasFlag(UEP_FLAGS.afk)).toBe(true);
    expect(manager().hasFlag(UEP_FLAGS.fromFar)).toBe(false);

    markUepFromFar();
    expect(manager().hasFlag(UEP_FLAGS.fromFar)).toBe(true);
  });

  it('全系列都是 uep: 前綴——與既有的 uep:teatime 一致', () => {
    for (const flag of Object.values(UEP_FLAGS)) {
      expect(flag.startsWith('uep:')).toBe(true);
    }
    expect(UEP_FLAGS.teatime).toBe('uep:teatime');
  });
});
