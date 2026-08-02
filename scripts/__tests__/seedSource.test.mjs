/**
 * seed 來源分類測試
 *
 * 這一段的存在理由是一個真實事故：所有 fetchSeed* 都 catch 後回 `[]`，
 * 讓「prod 讀取失敗」與「prod 合法為空」不可區分，test 首頁因此空了兩個
 * 多月而腳本一路 exit 0。核心契約就是**錯誤與空資料必須分得開**。
 */
import { describe, it, expect } from 'vitest';

import {
  collectSourceProblems,
  httpStatusOf,
  isMissingRecordError,
  seedExitCode,
} from '../seed-source.mjs';

describe('httpStatusOf', () => {
  it('讀得到掛在錯誤上的狀態碼', () => {
    const err = new Error('boom');
    err.status = 401;
    expect(httpStatusOf(err)).toBe(401);
  });

  it('沒有欄位時從訊息開頭解析', () => {
    expect(httpStatusOf(new Error('HTTP 404 Not Found — /x'))).toBe(404);
  });

  it('網路層失敗沒有狀態碼', () => {
    expect(httpStatusOf(new Error('fetch failed'))).toBeNull();
    expect(httpStatusOf(undefined)).toBeNull();
  });
});

describe('isMissingRecordError', () => {
  it('只有 404 算「這一筆本來就沒有」', () => {
    const notFound = new Error('nope');
    notFound.status = 404;
    expect(isMissingRecordError(notFound)).toBe(true);
  });

  it('401／500／網路失敗都是讀不到，不是不存在', () => {
    for (const status of [401, 403, 500, 502]) {
      const err = new Error('x');
      err.status = status;
      expect(isMissingRecordError(err)).toBe(false);
    }
    expect(isMissingRecordError(new Error('fetch failed'))).toBe(false);
  });
});

describe('collectSourceProblems', () => {
  it('必要骨架都有資料時沒有問題', () => {
    expect(collectSourceProblems({ pages: [{}], site_homepage: [{}] })).toEqual(
      []
    );
  });

  it('site_homepage 空表要擋下——首頁全走 fallback 看起來只是內容比較少', () => {
    const problems = collectSourceProblems({
      pages: [{}],
      site_homepage: [],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('site_homepage');
  });

  it('pages 空表同樣擋下', () => {
    expect(
      collectSourceProblems({ pages: [], site_homepage: [{}] })
    ).toHaveLength(1);
  });

  it('來源根本沒被讀取（undefined／型別錯誤）也算問題', () => {
    expect(collectSourceProblems({ site_homepage: [{}] })).toHaveLength(1);
    expect(
      collectSourceProblems({ pages: null, site_homepage: [{}] })
    ).toHaveLength(1);
  });
});

describe('seedExitCode', () => {
  it('全部成功才是 0', () => {
    expect(seedExitCode({ pages: { ok: 3, fail: 0 } })).toBe(0);
  });

  it('任何一項寫入失敗都非零——「抓到 N 筆寫入 0 筆」不能是成功', () => {
    expect(
      seedExitCode({ pages: { ok: 3, fail: 0 }, homepage: { ok: 0, fail: 9 } })
    ).toBe(1);
  });

  it('缺少計數欄位時當作 0 失敗，不誤報', () => {
    expect(seedExitCode({ pages: undefined })).toBe(0);
  });
});
