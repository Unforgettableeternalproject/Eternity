/**
 * Echoes 收藏池 DevTools actions 測試（S10-1 補測試缺口）
 *
 * 這組 action 是 `deriveSongUnlockFlag` 的第三類呼叫端，卻是**唯一沒有
 * 自動測試保護**的一組——旗標命名規則在 S10-1 從 `song:{songId}` 改成
 * `{storyKey|entityKey}:song` 時，前兩類（echoesVisibility / useEchoSpots）
 * 都有測試會擋，這裡改壞了只能靠手動點才發現。補上。
 *
 * 測的是「問到的 key 有沒有被正確轉成旗標、有沒有正確授予／撤銷」，
 * 不測 prompt 的 UI 行為（那是瀏覽器的事）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRegistry } from '../../actionRegistry';
import { GROUPS } from '../../groups';
import { registerEchoesActions } from '../echoesActions';

const progressMock = {
  grantFlags: vi.fn(),
  revokeFlags: vi.fn(),
  getState: vi.fn(() => ({ flags: [] as string[] })),
};

/** 依序回答 prompt（分類 → key）；undefined = 使用者按取消 */
function answerPrompts(...answers: (string | null)[]): void {
  let i = 0;
  vi.stubGlobal(
    'prompt',
    vi.fn(() => answers[i++] ?? null)
  );
}

async function run(id: string): Promise<void> {
  const result = await getRegistry().dispatch(id);
  expect(result.ok).toBe(true);
}

beforeEach(() => {
  progressMock.grantFlags.mockReset();
  progressMock.revokeFlags.mockReset();
  progressMock.getState.mockReset().mockReturnValue({ flags: [] });
  window.__uepProgress = progressMock as never;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  registerEchoesActions();
});

afterEach(() => {
  getRegistry().unregister([
    'echoes:grant-song-collected',
    'echoes:relock-song-collected',
    'echoes:derive-unlock-flag',
    'echoes:dump-collected-flags',
  ]);
  delete window.__uepProgress;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registerEchoesActions', () => {
  it('註冊四個 action 到旗標與收藏群組', () => {
    const ids = getRegistry()
      .getAll()
      // 2026-08-03 起與 flagActions 同組，所以還要看 id 前綴才分得出
      // 這四個是不是都在（同組的 flags:* 由 flagActions.test 顧）
      .filter((a) => a.group === GROUPS.FLAGS && a.id.startsWith('echoes:'))
      .map((a) => a.id)
      // registry 是模組級 singleton，跨測試 unregister/register 後
      // Map 的插入順序會變——這裡在意的是「哪四個」不是「什麼順序」
      .sort();
    expect(ids).toEqual([
      'echoes:derive-unlock-flag',
      'echoes:dump-collected-flags',
      'echoes:grant-song-collected',
      'echoes:relock-song-collected',
    ]);
  });
});

describe('echoes:grant-song-collected', () => {
  it('角色歌用 entityKey 推導旗標', async () => {
    answerPrompts('character', 'xavier-colsono');
    await run('echoes:grant-song-collected');
    expect(progressMock.grantFlags).toHaveBeenCalledWith([
      'xavier-colsono:song',
    ]);
  });

  it('區域歌同樣走 entityKey', async () => {
    answerPrompts('area', 'rain-sea-tower');
    await run('echoes:grant-song-collected');
    expect(progressMock.grantFlags).toHaveBeenCalledWith([
      'rain-sea-tower:song',
    ]);
  });

  it('劇情歌改問 storyKey（問錯欄位會推出 null）', async () => {
    answerPrompts('story', 'rain-sea-finale');
    await run('echoes:grant-song-collected');
    expect(progressMock.grantFlags).toHaveBeenCalledWith([
      'rain-sea-finale:song',
    ]);
  });

  it('劇情歌沒填 storyKey → 不授旗，改成警告', async () => {
    answerPrompts('story', '');
    await run('echoes:grant-song-collected');
    expect(progressMock.grantFlags).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('key 前後空白會被 trim 掉', async () => {
    answerPrompts('character', '  xavier-colsono  ');
    await run('echoes:grant-song-collected');
    expect(progressMock.grantFlags).toHaveBeenCalledWith([
      'xavier-colsono:song',
    ]);
  });

  it('分類 prompt 按取消 → 什麼都不做', async () => {
    answerPrompts(null);
    await run('echoes:grant-song-collected');
    expect(progressMock.grantFlags).not.toHaveBeenCalled();
  });
});

describe('echoes:relock-song-collected', () => {
  it('撤銷用的是同一套命名規則', async () => {
    answerPrompts('story', 'rain-sea-finale');
    await run('echoes:relock-song-collected');
    expect(progressMock.revokeFlags).toHaveBeenCalledWith([
      'rain-sea-finale:song',
    ]);
  });

  it('推導不出旗標時不撤銷（避免誤撤空字串）', async () => {
    answerPrompts('character', '   ');
    await run('echoes:relock-song-collected');
    expect(progressMock.revokeFlags).not.toHaveBeenCalled();
  });
});

describe('echoes:derive-unlock-flag', () => {
  it('純查詢：不寫進度，只印出並嘗試複製', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    answerPrompts('character', 'xavier-colsono');
    await run('echoes:derive-unlock-flag');
    expect(progressMock.grantFlags).not.toHaveBeenCalled();
    expect(progressMock.revokeFlags).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('xavier-colsono:song');
  });

  it('剪貼簿權限被拒也不讓 action 失敗', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    });
    answerPrompts('character', 'xavier-colsono');
    await run('echoes:derive-unlock-flag');
  });

  it('推導不出旗標時不碰剪貼簿', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    answerPrompts('story', '');
    await run('echoes:derive-unlock-flag');
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('echoes:dump-collected-flags', () => {
  it('過濾出收藏旗標（新命名 `*:song` 與舊命名 `song:*` 都收）', async () => {
    progressMock.getState.mockReturnValue({
      flags: [
        'xavier-colsono:song',
        'song:legacy-id',
        'xavier-colsono:01',
        'met:someone',
      ],
    });
    await run('echoes:dump-collected-flags');
    expect(console.log).toHaveBeenCalledWith(
      '[Echoes DevTools] 目前收藏旗標:',
      ['xavier-colsono:song', 'song:legacy-id']
    );
  });

  it('progress store 尚未就緒時警告而不是丟例外', async () => {
    delete window.__uepProgress;
    await run('echoes:dump-collected-flags');
    expect(console.warn).toHaveBeenCalled();
  });
});
