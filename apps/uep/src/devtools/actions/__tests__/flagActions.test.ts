/**
 * 旗標 DevTools actions 測試（S10-3 T-A8）
 *
 * 重點在三個會靜默造成傷害的行為：
 * - 分組一律取 audit 的 `source`，前端不自己判形狀
 * - 「清空自訂旗標」必須放過 derived 旗標，否則會連閱讀進度一起清掉
 * - 讀不到 audit 時該中止而不是猜
 *
 * 以及 gate 求值要逐項報告（完成依賴走遞迴驗證、pristineOnly 不受觀測者
 * bypass）。不測 prompt 的 UI 行為，那是瀏覽器的事。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRegistry } from '../../actionRegistry';
import { GROUPS } from '../../groups';
import { registerFlagActions } from '../flagActions';

const ACTION_IDS = [
  'flags:clear-custom',
  'flags:dump-held',
  'flags:evaluate-gate',
  'flags:grant-all-registered',
  'flags:grant-from-registry',
  'flags:revoke-held',
];

const REGISTRY = [
  { name: 'ended-s8-b', label: 'S8 結局 B', category: 'story' },
  { name: 'pure-observer', label: null, category: null },
];

const AUDIT = [
  { name: 'ended-s8-b', source: 'registered', label: 'S8 結局 B' },
  { name: 'pure-observer', source: 'registered', label: null },
  { name: 'completed:history/s1', source: 'derived', label: null },
  { name: 'test-story:song', source: 'derived', label: null },
];

/** 三層樹：s2 靠 s1 完成解鎖，s3 是手動 gate（自訂旗標 + 純潔者限定） */
function node(
  id: string,
  pageType: string,
  depth: number,
  metadata: Record<string, unknown>,
  children: unknown[] = []
) {
  return {
    id,
    title: id,
    slug: id.replace('history/', ''),
    sortOrder: 0,
    pageType,
    depth,
    status: 'published',
    metadata,
    children,
  };
}

const TREE = [
  node('history/vol-u', 'zone', 0, {}, [
    node('history/ch1', 'chapter', 1, {}, [
      node('history/s1', 'section', 2, { progressPage: true }),
      node('history/s2', 'section', 2, { progressPage: true }),
      node('history/s3', 'section', 2, {
        gate: { requiresFlags: ['ended-s8-b'], pristineOnly: true },
      }),
    ]),
  ]),
];

vi.mock(
  '../../../islands/history/historyIslandData',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../../islands/history/historyIslandData')
      >();
    return {
      ...actual,
      fetchHistoryTree: () => Promise.resolve(TREE as never),
    };
  }
);

const progressMock = {
  grantFlags: vi.fn(),
  revokeFlags: vi.fn(),
  getState: vi.fn(),
};

function setState(overrides: Record<string, unknown> = {}) {
  progressMock.getState.mockReturnValue({
    flags: [] as string[],
    view: 'explorer',
    observerEver: false,
    completedPageIds: [] as string[],
    pageMarkers: {},
    lastVisitedPageId: null,
    ...overrides,
  });
}

/** `/api/flags` 與 `/api/flags/audit` 的回應；status 可覆寫成 401 等 */
function mockFlagsApi(opts: { status?: number } = {}) {
  const status = opts.status ?? 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      status,
      json: async () =>
        status === 200
          ? {
              ok: true,
              data: {
                flags: url.endsWith('/audit') ? AUDIT : REGISTRY,
              },
            }
          : { ok: false, error: 'Unauthorized' },
    }))
  );
}

function answerPrompt(answer: string | null) {
  vi.stubGlobal(
    'prompt',
    vi.fn(() => answer)
  );
}

async function run(id: string): Promise<void> {
  const result = await getRegistry().dispatch(id);
  expect(result.ok).toBe(true);
}

/** console.log／warn 的全部輸出併成一段，方便比對關鍵字 */
function logged(spy: ReturnType<typeof vi.spyOn>): string {
  return (spy.mock.calls as unknown[][])
    .map((args) => args.map(String).join(' '))
    .join('\n');
}

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  progressMock.grantFlags.mockReset();
  progressMock.revokeFlags.mockReset();
  progressMock.getState.mockReset();
  setState();
  window.__uepProgress = progressMock as never;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockFlagsApi();
  registerFlagActions();
});

afterEach(() => {
  getRegistry().unregister(ACTION_IDS);
  delete window.__uepProgress;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registerFlagActions', () => {
  it('註冊六個 action 到旗標與收藏群組', () => {
    const ids = getRegistry()
      .getAll()
      // 同組還有 echoesActions 的 echoes:*，用前綴分開（見 echoesActions.test）
      .filter((a) => a.group === GROUPS.FLAGS && a.id.startsWith('flags:'))
      .map((a) => a.id)
      .sort();
    expect(ids).toEqual(ACTION_IDS);
  });

  it('傾印依 audit 的 source 分成三組', async () => {
    setState({ flags: ['ended-s8-b', 'completed:history/s1', 'never-seen'] });
    await run('flags:dump-held');
    const out = logged(logSpy);
    expect(out).toMatch(/自動生成（derived）（1）/);
    expect(out).toMatch(/自訂・已註冊（1）/);
    // audit 查不到的歸未註冊——audit 已把註冊表整份併入，查不到就是兩邊都沒有
    expect(out).toMatch(/未註冊（1）/);
  });

  it('註冊表讀不到時傾印仍印出原始清單', async () => {
    mockFlagsApi({ status: 401 });
    setState({ flags: ['ended-s8-b'] });
    await run('flags:dump-held');
    expect(logged(logSpy)).toMatch(/無法分組/);
    // 401 要明講是權限問題，否則只會看到一個沒頭沒尾的失敗
    expect(logged(warnSpy)).toMatch(/admin only/);
  });

  it('從註冊表選：吃編號也吃完整名稱', async () => {
    answerPrompt('2');
    await run('flags:grant-from-registry');
    expect(progressMock.grantFlags).toHaveBeenCalledWith(['pure-observer']);

    progressMock.grantFlags.mockReset();
    answerPrompt('ended-s8-b');
    await run('flags:grant-from-registry');
    expect(progressMock.grantFlags).toHaveBeenCalledWith(['ended-s8-b']);
  });

  it('不在清單裡的輸入不授予', async () => {
    answerPrompt('nonexistent-flag');
    await run('flags:grant-from-registry');
    expect(progressMock.grantFlags).not.toHaveBeenCalled();
    expect(logged(warnSpy)).toMatch(/不在清單裡/);
  });

  it('模擬持有全部註冊旗標只授予註冊表內容', async () => {
    await run('flags:grant-all-registered');
    expect(progressMock.grantFlags).toHaveBeenCalledWith([
      'ended-s8-b',
      'pure-observer',
    ]);
  });

  it('清空自訂旗標放過 derived，閱讀進度不受影響', async () => {
    setState({
      flags: [
        'ended-s8-b',
        'completed:history/s1',
        'test-story:song',
        'stray-flag',
      ],
    });
    await run('flags:clear-custom');
    expect(progressMock.revokeFlags).toHaveBeenCalledWith([
      'ended-s8-b',
      'stray-flag',
    ]);
  });

  /**
   * 讀不到分類時「全部撤銷」會把 completed:* 一起清掉——使用者按的是
   * 「清空自訂旗標」，結果整份閱讀進度消失。寧可不動。
   */
  it('讀不到 audit 時清空動作中止', async () => {
    mockFlagsApi({ status: 401 });
    setState({ flags: ['ended-s8-b', 'completed:history/s1'] });
    await run('flags:clear-custom');
    expect(progressMock.revokeFlags).not.toHaveBeenCalled();
    expect(logged(warnSpy)).toMatch(/中止/);
  });

  it('progress store 未就緒時不炸，只警告', async () => {
    delete window.__uepProgress;
    await run('flags:dump-held');
    expect(logged(warnSpy)).toMatch(/尚未就緒/);
  });
});

describe('flags:evaluate-gate', () => {
  it('完成依賴未滿足 → 逐項標記未過且結論鎖住', async () => {
    answerPrompt('history/s2');
    await run('flags:evaluate-gate');
    const out = logged(logSpy);
    expect(out).toMatch(/✗ completed:history\/s1/);
    expect(out).toMatch(/結論: 鎖住/);
  });

  it('完成依賴滿足 → 可讀', async () => {
    setState({
      flags: ['completed:history/s1'],
      completedPageIds: ['history/s1'],
    });
    answerPrompt('history/s2');
    await run('flags:evaluate-gate');
    expect(logged(logSpy)).toMatch(/結論: 可讀/);
  });

  it('自訂旗標與 pristineOnly 分別列出', async () => {
    answerPrompt('history/s3');
    await run('flags:evaluate-gate');
    const out = logged(logSpy);
    expect(out).toMatch(/✗ ended-s8-b（自訂旗標｜未持有）/);
    expect(out).toMatch(/pristineOnly（純潔者限定/);
  });

  /**
   * 觀測者 bypass 旗標條件但**不** bypass pristineOnly——那是觀測者印記的
   * 代價。結論要照實說鎖住，並標明 bypass 只作用在旗標上。
   */
  it('觀測者仍被 pristineOnly 擋住', async () => {
    setState({ view: 'observer', observerEver: true });
    answerPrompt('history/s3');
    await run('flags:evaluate-gate');
    const out = logged(logSpy);
    expect(out).toMatch(/結論: 鎖住/);
    expect(out).toMatch(/pristineOnly 不受 bypass/);
  });

  it('tree 裡沒有的 pageId 給明確警告', async () => {
    answerPrompt('history/does-not-exist');
    await run('flags:evaluate-gate');
    expect(logged(warnSpy)).toMatch(/tree 裡沒有/);
  });
});
