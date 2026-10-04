import { describe, expect, it } from 'vitest';
import { pickHomepageUpdates } from './featuredUpdates';

const u = (id: string, date: string, featured = false, createdAt?: string) => ({
  id,
  date,
  featured,
  createdAt,
});

const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe('pickHomepageUpdates', () => {
  it('全部非精選時與原本相同：取最新 limit 筆，依日期新到舊', () => {
    const list = [
      u('a', '2026-01-01'),
      u('b', '2026-03-01'),
      u('c', '2026-02-01'),
      u('d', '2026-05-01'),
      u('e', '2026-04-01'),
      u('f', '2025-12-01'),
    ];
    expect(ids(pickHomepageUpdates(list, 5))).toEqual([
      'd',
      'e',
      'b',
      'c',
      'a',
    ]);
  });

  it('精選優先，其餘以最新非精選補滿', () => {
    const list = [
      u('new1', '2026-06-01'),
      u('new2', '2026-05-01'),
      u('old-f', '2025-01-01', true),
      u('new3', '2026-04-01'),
      u('mid-f', '2025-06-01', true),
      u('new4', '2026-03-01'),
      u('new5', '2026-02-01'),
    ];
    expect(ids(pickHomepageUpdates(list, 5))).toEqual([
      'mid-f',
      'old-f',
      'new1',
      'new2',
      'new3',
    ]);
  });

  it('精選超過 limit 時只取最新的精選', () => {
    const list = Array.from({ length: 7 }, (_, i) =>
      u(`f${i}`, `2026-0${i + 1}-01`, true)
    );
    list.push(u('plain', '2026-09-01'));
    expect(ids(pickHomepageUpdates(list, 5))).toEqual([
      'f6',
      'f5',
      'f4',
      'f3',
      'f2',
    ]);
  });

  it('同一篇不會出現兩次', () => {
    const list = [
      u('x', '2026-05-01', true),
      u('x', '2026-05-01', true),
      u('y', '2026-04-01'),
      u('y', '2026-04-01'),
      u('z', '2026-03-01'),
    ];
    const picked = pickHomepageUpdates(list, 5);
    expect(ids(picked)).toEqual(['x', 'y', 'z']);
    expect(new Set(ids(picked)).size).toBe(picked.length);
  });

  it('總數不足 limit 時全部回傳', () => {
    const list = [u('a', '2026-01-01', true), u('b', '2026-02-01')];
    expect(ids(pickHomepageUpdates(list, 5))).toEqual(['a', 'b']);
  });

  it('同日期以 createdAt 新到舊排序', () => {
    const list = [
      u('early', '2026-05-01', false, '2026-05-01T01:00:00Z'),
      u('late', '2026-05-01', false, '2026-05-01T09:00:00Z'),
    ];
    expect(ids(pickHomepageUpdates(list, 5))).toEqual(['late', 'early']);
  });

  it('不改動輸入陣列', () => {
    const list = [u('a', '2026-01-01'), u('b', '2026-02-01', true)];
    const snapshot = [...list];
    pickHomepageUpdates(list, 5);
    expect(list).toEqual(snapshot);
  });
});
