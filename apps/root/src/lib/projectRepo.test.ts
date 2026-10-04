import { describe, it, expect } from 'vitest';

import { resolveProjectRepo } from './projectRepo';

const GH = 'https://github.com/example/secret-repo';

describe('resolveProjectRepo', () => {
  it('公開專案有 github 時輸出連結', () => {
    expect(
      resolveProjectRepo({ isPrivateRepo: false, links: { github: GH } }, 'en')
    ).toEqual({
      kind: 'link',
      href: GH,
      display: 'github.com/example/secret-repo',
    });
  });

  it('公開專案無 github 時不顯示', () => {
    expect(
      resolveProjectRepo(
        { isPrivateRepo: false, links: { github: null } },
        'en'
      )
    ).toBeNull();
    expect(
      resolveProjectRepo(
        { isPrivateRepo: false, links: { github: '  ' } },
        'en'
      )
    ).toBeNull();
  });

  it('私人專案即使有 github 也不輸出網址', () => {
    const result = resolveProjectRepo(
      { isPrivateRepo: true, links: { github: GH } },
      'zh-tw'
    );
    expect(result).toEqual({ kind: 'private', label: '私人儲存庫' });
    expect(JSON.stringify(result)).not.toContain('secret-repo');
  });

  it('私人專案無 github 時仍顯示私人標示，標籤依語系', () => {
    expect(
      resolveProjectRepo({ isPrivateRepo: true, links: { github: null } }, 'en')
    ).toEqual({ kind: 'private', label: 'Private repository' });
  });

  it('缺少 isPrivateRepo 欄位（舊版 API）視為公開', () => {
    expect(resolveProjectRepo({ links: { github: GH } }, 'en')?.kind).toBe(
      'link'
    );
  });
});
