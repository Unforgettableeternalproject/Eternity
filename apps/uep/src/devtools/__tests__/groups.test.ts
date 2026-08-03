/**
 * 群組清單的一致性測試（2026-08-03 面板精簡）
 *
 * 這兩條斷言防的是同一種漏：新增群組時只改了 `GROUPS` 而忘了 `GROUP_ORDER`。
 * 症狀是那一組被排到面板最底下——沒有錯誤訊息，只是位置很奇怪，而且要有人
 * 剛好注意到才會發現。
 */
import { describe, expect, it } from 'vitest';

import { getRegistry } from '../actionRegistry';
import { registerAllActions } from '../actions';
import { GROUPS, GROUP_ORDER } from '../groups';

describe('DevTools 群組', () => {
  it('GROUP_ORDER 涵蓋全部 GROUPS 且無多餘項', () => {
    expect([...GROUP_ORDER].sort()).toEqual(Object.values(GROUPS).sort());
  });

  it('所有註冊的 action 都掛在已知群組上', () => {
    registerAllActions();
    const known = new Set<string>(Object.values(GROUPS));
    const unknown = getRegistry()
      .getAll()
      .filter((a) => !known.has(a.group))
      .map((a) => `${a.id}（group=${a.group}）`);
    expect(unknown).toEqual([]);
  });

  it('getGroups 依 GROUP_ORDER 排序，不是字母序', () => {
    registerAllActions();
    const groups = getRegistry().getGroups();
    const expected = GROUP_ORDER.filter((g) => groups.includes(g));
    expect(groups).toEqual(expected);
  });
});
