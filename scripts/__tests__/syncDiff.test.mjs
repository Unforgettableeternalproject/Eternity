/**
 * `diffByTimestamp` — 雙向同步的差異比對（sync-utils.mjs）
 *
 * 這段沒有測試護欄時出過事：軟刪除加進來之前，「單邊不存在」一律被當成
 * 「僅存在另一端」而複製回去，於是刪掉的旗標下一次同步就從對面復活，
 * 真 CRUD 的 delete 在有 sync 的環境等於不可持久。
 *
 * 兩組契約都要守住：帶 `deletedAt` 的表（uep_flags）要能傳播刪除，
 * 沒有那個欄位的表（interlink_keys）行為必須與過去一模一樣。
 */
import { describe, it, expect } from 'vitest';

import { diffByTimestamp } from '../sync-utils.mjs';

const OLD = '2026-07-01T00:00:00.000Z';
const NEW = '2026-07-20T00:00:00.000Z';

const live = (updatedAt = OLD) => ({ updatedAt });
const tomb = (deletedAt, updatedAt = deletedAt) => ({ updatedAt, deletedAt });

/** 這一筆落在哪一個桶（每筆只會進一個） */
function bucket(localMap, remoteMap, id = 'a') {
  const diff = diffByTimestamp(localMap, remoteMap);
  const buckets = [
    'toPush',
    'toPull',
    'deleteOnRemote',
    'deleteOnLocal',
    'inSync',
  ];
  const hits = buckets.filter((key) =>
    diff[key].some(
      (entry) => (typeof entry === 'string' ? entry : entry.id) === id
    )
  );
  expect(hits.length, `落在多個桶：${hits.join(', ')}`).toBe(1);
  return hits[0];
}

describe('沒有 deletedAt 欄位的表（interlink_keys）', () => {
  it('僅存在單邊 → 推送／拉取', () => {
    expect(bucket({ a: live() }, {})).toBe('toPush');
    expect(bucket({}, { a: live() })).toBe('toPull');
  });

  it('兩端都有 → 比 updatedAt', () => {
    expect(bucket({ a: live(NEW) }, { a: live(OLD) })).toBe('toPush');
    expect(bucket({ a: live(OLD) }, { a: live(NEW) })).toBe('toPull');
    expect(bucket({ a: live(OLD) }, { a: live(OLD) })).toBe('inSync');
  });
});

describe('墓碑（軟刪除）的傳播', () => {
  it('一邊建了又刪、另一邊從沒有過 → 不推墓碑', () => {
    expect(bucket({ a: tomb(OLD) }, {})).toBe('inSync');
    expect(bucket({}, { a: tomb(OLD) })).toBe('inSync');
  });

  it('兩端都是墓碑 → 已同步（刪除時間不同也不再互推）', () => {
    expect(bucket({ a: tomb(OLD) }, { a: tomb(NEW) })).toBe('inSync');
  });

  it('一邊刪了、另一邊還活著 → 傳播刪除', () => {
    expect(bucket({ a: tomb(NEW) }, { a: live(OLD) })).toBe('deleteOnRemote');
    expect(bucket({ a: live(OLD) }, { a: tomb(NEW) })).toBe('deleteOnLocal');
  });

  it('刪除之後對面又改過 → 以那次修改為準（撤銷刪除）', () => {
    expect(bucket({ a: tomb(OLD) }, { a: live(NEW) })).toBe('toPull');
    expect(bucket({ a: live(NEW) }, { a: tomb(OLD) })).toBe('toPush');
  });

  it('刪除與對面更新同時 → 刪除優先', () => {
    expect(bucket({ a: tomb(OLD) }, { a: live(OLD) })).toBe('deleteOnRemote');
    expect(bucket({ a: live(OLD) }, { a: tomb(OLD) })).toBe('deleteOnLocal');
  });

  it('deletedAt 為 null 是活著，不是墓碑', () => {
    expect(
      bucket({ a: { updatedAt: NEW, deletedAt: null } }, { a: live(OLD) })
    ).toBe('toPush');
  });

  /** 修補前的病灶：刪掉的東西被對面的活列拉回來 */
  it('刪除不會被對面的活列復原', () => {
    const diff = diffByTimestamp({ a: tomb(NEW) }, { a: live(OLD) });
    expect(diff.toPull).toHaveLength(0);
    expect(diff.deleteOnRemote.map((e) => e.id)).toEqual(['a']);
  });
});
