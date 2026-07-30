/**
 * KeysManager 測試
 *
 * 涵蓋三欄互動的資料契約：
 * - 左欄分組（entity／story／旗標的 source 三分組）與搜尋／篩選
 * - 中欄 entity 標題唯讀（權威名稱在 Concepts dossier）
 * - 右欄反查（key 走 /usage 請求、flag 直接用 audit 的引用清單）
 * - 「跳到該頁編輯」連到 /admin/edit/{pageId}
 * - 儲存與註冊打的是同源 proxy 路徑（httpOnly JWT 讀不到，必須走 proxy）
 */
/* global RequestInit */
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import KeysManager from '../KeysManager';

const KEYS = [
  {
    keyType: 'entity',
    keyValue: 'xavier-colsono',
    title: null,
    description: '主角',
    updatedAt: '2026-07-29T00:00:00.000Z',
    derivedName: '艾斯維爾·科索諾',
    definitionCount: 4,
    anchorCount: 2,
  },
  {
    keyType: 'story',
    keyValue: 'test-story',
    title: '測試劇情點',
    description: null,
    updatedAt: null,
    definitionCount: 1,
    anchorCount: 0,
  },
];

/**
 * 四個自訂旗標各佔一種使用狀態（used／no-demand／no-grant／orphan）＋
 * 四個 derived（usage 恆為 null，不參與這個維度）。
 * `usage` 由 worker 算，fixture 只是照抄它會回什麼。
 */
const AUDIT = [
  {
    name: 'completed:history/chapter-1',
    source: 'derived',
    label: null,
    grantedBy: [],
    requiredBy: [
      { pageId: 'history/chapter-2', pageTitle: '第二章', area: 'history' },
    ],
    usage: null,
  },
  {
    name: 'ch1-cleared',
    source: 'registered',
    label: '第一章讀通',
    grantedBy: [
      { pageId: 'history/chapter-1', pageTitle: '第一章', area: 'history' },
    ],
    requiredBy: [
      { pageId: 'history/chapter-2', pageTitle: '第二章', area: 'history' },
    ],
    usage: 'used',
  },
  {
    name: 'met-mistina',
    source: 'registered',
    label: '見過米絲媞',
    grantedBy: [
      { pageId: 'history/chapter-1', pageTitle: '第一章', area: 'history' },
    ],
    requiredBy: [],
    usage: 'no-demand',
  },
  {
    name: 'lost-signal',
    source: 'unregistered',
    label: null,
    grantedBy: [],
    requiredBy: [
      { pageId: 'echoes/song-1', pageTitle: '某首歌', area: 'echoes' },
    ],
    usage: 'no-grant',
  },
  // 兩端都沒有引用，只剩註冊表這一列
  {
    name: 'stale-flag',
    source: 'registered',
    label: '舊旗標',
    grantedBy: [],
    requiredBy: [],
    usage: 'orphan',
  },
  // 已退役的形狀（S7-C 起停增不刪），巡查清單仍會列出
  {
    name: 'met:entity:novia',
    source: 'derived',
    label: null,
    grantedBy: [],
    requiredBy: [],
    usage: null,
  },
  // deriveImageUnlockFlag 的實際形狀：image:{encoded pageId}:{imageId}
  {
    name: 'image:visuals%2Fgallery-a:img-01',
    source: 'derived',
    label: null,
    grantedBy: [],
    requiredBy: [],
    usage: null,
  },
  {
    name: 'test-story:song',
    source: 'derived',
    label: null,
    grantedBy: [],
    requiredBy: [],
    usage: null,
  },
];

const REGISTRY = [
  {
    name: 'met-mistina',
    label: '見過米絲媞',
    description: '第一章結尾授予',
    category: 'story',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
];

const USAGE = {
  definitions: [
    {
      area: 'concepts',
      pageId: 'concepts/characters',
      pageTitle: '角色',
      scope: 'characters',
    },
  ],
  anchors: [
    {
      pageId: 'history/chapter-1',
      pageTitle: '第一章',
      anchorKind: 'entity-mention',
      anchorId: 'a1',
      label: '初次登場',
    },
  ],
};

/** 依 URL 回應對應的 fixture，並記錄所有請求供斷言 */
function mockApi(audit: unknown[] = AUDIT) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = (data: unknown) => ({
      ok: true,
      json: async () => ({ ok: true, data }),
    });
    if (url === '/api/interlink/keys') return body({ keys: KEYS });
    if (url === '/api/flags/audit') return body({ flags: audit });
    if (url === '/api/flags') {
      if (init?.method === 'POST') return body({ flag: REGISTRY[0] });
      return body({ flags: REGISTRY });
    }
    if (url.startsWith('/api/interlink/usage')) return body(USAGE);
    if (url.endsWith('/rename')) {
      const payload = JSON.parse(String(init?.body)) as {
        to: string;
        dryRun?: boolean;
      };
      return body({
        from: 'met-mistina',
        to: payload.to,
        dryRun: payload.dryRun === true,
        totalHits: 3,
        pages: [
          {
            pageId: 'history/chapter-1',
            area: 'history',
            title: '第一章',
            contentHits: 2,
            metadataHits: 1,
          },
        ],
      });
    }
    // derived 旗標的衍生來源頁標題
    if (url === '/api/content/history/chapter-1') {
      return body({ id: 'history/chapter-1', title: '第一章內文' });
    }
    if (url === '/api/content/visuals/gallery-a') {
      return body({ id: 'visuals/gallery-a', title: 'A 展廊' });
    }
    // 進度分頁（ProgressOverview）的兩個資料來源
    if (url === '/api/content/history/tree') return body([]);
    if (url === '/api/interlink/anchors-summary') return body({ pages: {} });
    // 站台分頁（SiteSettingsPanel）
    if (url === '/api/settings') {
      return body({
        settings: {
          'protection.mode': 'env',
          'bookmark.baseChancePct': 20,
          'note.max': 30,
          'note.textMax': 200,
        },
      });
    }
    return body({});
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { calls, fetchMock };
}

/** 規則生成那一組預設收合（筆數最多又動不了），要點裡面的列得先展開 */
function expandDerived() {
  fireEvent.click(screen.getByText(/規則生成/));
}

describe('KeysManager', () => {
  let calls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    ({ calls } = mockApi());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('掛載時只透過同源 proxy 載入三份清單', async () => {
    render(<KeysManager />);
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(3));
    const urls = calls.map((c) => c.url);
    expect(urls).toContain('/api/interlink/keys');
    expect(urls).toContain('/api/flags/audit');
    expect(urls).toContain('/api/flags');
    // 直打 worker 會因為讀不到 httpOnly JWT 而 401
    expect(urls.every((u) => u.startsWith('/api/'))).toBe(true);
  });

  it('左欄依 keyType 分組，entity 顯示 dossier 名稱', async () => {
    const { container } = render(<KeysManager />);
    expect(await screen.findByText('xavier-colsono')).toBeInTheDocument();
    expect(screen.getByText('艾斯維爾·科索諾')).toBeInTheDocument();
    expect(screen.getByText('test-story')).toBeInTheDocument();
    // 分組標題（篩選 chip 也叫 entity／story，用容器區分）
    const groups = [...container.querySelectorAll('.km-group-title')].map(
      (el) => el.textContent
    );
    expect(groups.some((t) => t?.startsWith('entity'))).toBe(true);
    expect(groups.some((t) => t?.startsWith('story'))).toBe(true);
  });

  it('搜尋過濾 key 值與名稱', async () => {
    render(<KeysManager />);
    await screen.findByText('xavier-colsono');
    fireEvent.change(screen.getByPlaceholderText('搜尋 key、名稱…'), {
      target: { value: 'story' },
    });
    expect(screen.getByText('test-story')).toBeInTheDocument();
    expect(screen.queryByText('xavier-colsono')).not.toBeInTheDocument();
  });

  it('選 entity key：標題欄唯讀並標註來源，說明可編輯', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('xavier-colsono'));
    const title = screen.getByLabelText('標題') as HTMLInputElement;
    expect(title).toBeDisabled();
    expect(title.value).toBe('艾斯維爾·科索諾');
    expect(screen.getByText(/Concepts dossier/)).toBeInTheDocument();
    expect(screen.getByLabelText('說明')).not.toBeDisabled();
  });

  it('選 story key：標題可編輯，儲存打 key 說明 proxy', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('test-story'));
    const title = screen.getByLabelText('標題') as HTMLInputElement;
    expect(title).not.toBeDisabled();
    fireEvent.change(title, { target: { value: '改過的名字' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === '/api/interlink/keys/story/test-story')
      ).toBe(true)
    );
    const put = calls.find(
      (c) => c.url === '/api/interlink/keys/story/test-story'
    );
    expect(put?.init?.method).toBe('PUT');
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      title: '改過的名字',
      description: '',
    });
  });

  it('選 key 後右欄載入定義端與錨點端，連結指向該頁編輯', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('xavier-colsono'));
    expect(await screen.findByText('角色')).toBeInTheDocument();
    expect(screen.getByText('concepts · characters')).toBeInTheDocument();
    expect(screen.getByText('第一章')).toBeInTheDocument();
    const links = screen.getAllByText('跳到該頁編輯 →');
    expect(links[0]).toHaveAttribute('href', '/admin/edit/concepts/characters');
  });

  it('flag 分頁依 source 三分組，未使用的三種成因各自標示', async () => {
    const { container } = render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    expect(screen.getByText('未註冊')).toBeInTheDocument();
    expect(screen.getByText('已註冊')).toBeInTheDocument();
    expect(screen.getByText(/規則生成/)).toBeInTheDocument();
    // 三個 badge 文字與 chip 文字同名，所以限定在 badge 容器內比對
    const badges = [...container.querySelectorAll('.km-badge')].map(
      (badge) => badge.textContent
    );
    expect(badges).toEqual(
      expect.arrayContaining(['無授予', '無引用', '孤兒'])
    );
    // 已使用與 derived 都不掛 badge
    expect(badges).not.toContain('已使用');
    expect(badges.length).toBe(3);
  });

  /** 只有 no-grant 會讓頁面永久打不開，所以只有它是警示色 */
  it('無授予用警示色，另兩種是中性色', async () => {
    const { container } = render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    const tone = (label: string) =>
      [...container.querySelectorAll('.km-badge')].find(
        (badge) => badge.textContent === label
      )?.className;
    expect(tone('無授予')).toMatch(/km-badge--warn/);
    expect(tone('無引用')).toMatch(/km-badge--mute/);
    expect(tone('孤兒')).toMatch(/km-badge--mute/);
  });

  /**
   * 自動註冊（0.9.16.8）之後未註冊只剩 force 刪除與繞過 API 寫入兩條產生
   * 路徑，常態是 0。一直畫著一個印「（無）」的分組會被讀成常設分類。
   */
  it('沒有未註冊旗標時整組不畫', async () => {
    mockApi(AUDIT.filter((flag) => flag.source !== 'unregistered'));
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    await waitFor(() => expect(screen.getByText('已註冊')).toBeInTheDocument());
    expect(screen.queryByText('未註冊')).not.toBeInTheDocument();
  });

  /** 已使用 = 兩端都有；其餘三種都算未使用 */
  it('總覽 chip 篩已使用／未使用', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    const chips = screen.getByRole('group', { name: '旗標使用狀態篩選' });

    fireEvent.click(within(chips).getByText('已使用'));
    expect(screen.getByText('ch1-cleared')).toBeInTheDocument();
    expect(screen.queryByText('met-mistina')).not.toBeInTheDocument();
    expect(screen.queryByText('lost-signal')).not.toBeInTheDocument();
    expect(screen.queryByText('stale-flag')).not.toBeInTheDocument();

    fireEvent.click(within(chips).getByText('未使用'));
    expect(screen.getByText('met-mistina')).toBeInTheDocument();
    expect(screen.getByText('lost-signal')).toBeInTheDocument();
    expect(screen.getByText('stale-flag')).toBeInTheDocument();
    expect(screen.queryByText('ch1-cleared')).not.toBeInTheDocument();
  });

  /** 第二層是「未使用」的下一層，沒選它的時候不該佔位 */
  it('次級 chip 只在選了未使用時出現，離開就收掉', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    const chips = screen.getByRole('group', { name: '旗標使用狀態篩選' });
    const sub = () => screen.queryByRole('group', { name: '未使用成因篩選' });

    expect(sub()).not.toBeInTheDocument();
    fireEvent.click(within(chips).getByText('未使用'));
    expect(sub()).toBeInTheDocument();
    fireEvent.click(within(chips).getByText('已使用'));
    expect(sub()).not.toBeInTheDocument();
  });

  it('次級 chip 可單獨篩三種成因，再點一次取消', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    const chips = screen.getByRole('group', { name: '旗標使用狀態篩選' });
    fireEvent.click(within(chips).getByText('未使用'));
    const sub = () => screen.getByRole('group', { name: '未使用成因篩選' });

    for (const [label, expected, excluded] of [
      ['無授予', 'lost-signal', 'met-mistina'],
      ['無引用', 'met-mistina', 'stale-flag'],
      ['孤兒', 'stale-flag', 'lost-signal'],
    ]) {
      fireEvent.click(within(sub()).getByText(label));
      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(screen.queryByText(excluded)).not.toBeInTheDocument();
      // 已使用的一律不在未使用的任何細分裡
      expect(screen.queryByText('ch1-cleared')).not.toBeInTheDocument();
      // 再點一次回到三種成因全看
      fireEvent.click(within(sub()).getByText(label));
      expect(screen.getByText(excluded)).toBeInTheDocument();
    }
  });

  /**
   * 離開「未使用」時第二層的選擇要清掉。不可見的篩選還生效的話，回到
   * 「未使用」會莫名只剩一兩筆，而且畫面上沒有任何東西解釋為什麼。
   */
  it('離開未使用會清掉成因選擇', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    const chips = screen.getByRole('group', { name: '旗標使用狀態篩選' });

    fireEvent.click(within(chips).getByText('未使用'));
    const sub = screen.getByRole('group', { name: '未使用成因篩選' });
    fireEvent.click(within(sub).getByText('孤兒'));
    expect(screen.queryByText('lost-signal')).not.toBeInTheDocument();

    fireEvent.click(within(chips).getByText('全部'));
    fireEvent.click(within(chips).getByText('未使用'));
    expect(screen.getByText('lost-signal')).toBeInTheDocument();
    expect(screen.getByText('stale-flag')).toBeInTheDocument();
  });

  /**
   * derived 沒有使用狀態這個維度（唯讀參考、授予端在程式裡），所以那一組
   * 不參與篩選也不計入 chip 筆數——否則 5 筆 completed:* 會把自訂旗標淹掉。
   */
  it('規則生成組不受使用狀態篩選影響，也不計入 chip 筆數', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    const chips = screen.getByRole('group', { name: '旗標使用狀態篩選' });

    // 自訂旗標 4 筆（used 1 / no-demand 1 / no-grant 1 / orphan 1）
    expect(within(chips).getByText('全部').textContent).toMatch(/4/);
    expect(within(chips).getByText('已使用').textContent).toMatch(/1/);
    expect(within(chips).getByText('未使用').textContent).toMatch(/3/);

    fireEvent.click(within(chips).getByText('已使用'));
    expandDerived();
    expect(screen.getByText('test-story:song')).toBeInTheDocument();
    expect(
      screen.getByText('image:visuals%2Fgallery-a:img-01')
    ).toBeInTheDocument();
  });

  /** 這一組筆數最多又動不了，展開著會一直搶注意力（艾斯維爾 2026-07-30） */
  it('規則生成組預設收合，展開後才列出內容', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    expect(screen.getByText(/規則生成/)).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    // 收合時連 hint 都不畫——那段字本身就是主要的視覺干擾
    expect(
      screen.queryByText(/只在被當成前置條件時出現/)
    ).not.toBeInTheDocument();
    expect(screen.queryByText('test-story:song')).not.toBeInTheDocument();
    // 標題的筆數仍看得到，不必展開才知道有幾筆
    expect(screen.getByText(/規則生成/).textContent).toMatch(/4/);

    expandDerived();
    expect(screen.getByText(/規則生成/)).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByText('test-story:song')).toBeInTheDocument();
  });

  /**
   * 筆數不加說明會被讀成「系統裡只有這幾個 completed 旗標」。實際上每一頁
   * 都能產生一個，這一組只收「被當成前置條件」的那些，而且與讀者進度無關。
   */
  it('derived 分組講明收錄條件與進度無關', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    expect(screen.getByText(/規則生成（內容裡有引用）/)).toBeInTheDocument();
    expandDerived();
    const hint = screen.getByText(/只在被當成前置條件時出現/);
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toMatch(/與讀者進度無關/);
    expect(hint.textContent).toMatch(/admin\/behavior/);
  });

  /**
   * 原本的「只顯示有問題的」checkbox 已被次級 chip 取代（它篩的正是
   * no-grant），留著會是兩個入口做同一件事。
   */
  it('不再有「只顯示有問題的」checkbox', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    expect(screen.queryByLabelText('只顯示有問題的')).not.toBeInTheDocument();
  });

  it('derived 旗標不放空的可寫欄位，改顯示衍生來源', async () => {
    const { container } = render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    expandDerived();
    fireEvent.click(screen.getByText('completed:history/chapter-1'));
    // 空的 disabled 欄位看起來像「還沒填」而不是「不能填」，一律不出現
    expect(screen.queryByLabelText('標籤')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('類別')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('說明')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '刪除註冊' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('衍生來源')).toBeInTheDocument();
    expect(screen.getByText('頁面完成標記')).toBeInTheDocument();
    // 旗標名裡只有 pageId，標題現查
    expect(await screen.findByText('第一章內文')).toBeInTheDocument();
    expect(container.querySelector('.km-source a')).toHaveAttribute(
      'href',
      '/admin/edit/history/chapter-1'
    );
  });

  it('已退役的 derived 形狀標明狀態而不是查來源', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    expandDerived();
    fireEvent.click(screen.getByText('met:entity:novia'));
    expect(screen.getByText('entity 認識標記')).toBeInTheDocument();
    expect(screen.getByText(/已退役/)).toBeInTheDocument();
    // 退役形狀不該去查頁面
    expect(calls.some((c) => c.url.startsWith('/api/content/'))).toBe(false);
  });

  it('image 旗標解出 gallery 頁與圖片 id（galleryId 是編碼過的 pageId）', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    expandDerived();
    fireEvent.click(screen.getByText('image:visuals%2Fgallery-a:img-01'));
    expect(screen.getByText('單張圖片解鎖')).toBeInTheDocument();
    expect(screen.getByText('visuals/gallery-a')).toBeInTheDocument();
    expect(screen.getByText('img-01')).toBeInTheDocument();
  });

  it('尾碼型 derived 旗標指回來源 key，可一鍵跳去編輯說明', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    expandDerived();
    fireEvent.click(screen.getByText('test-story:song'));
    expect(screen.getByText('曲目解鎖')).toBeInTheDocument();
    expect(screen.getByText('測試劇情點')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: '去編輯這個 key 的說明 →' })
    );
    // 跳過去之後是 story key 的可編輯面板
    expect(screen.getByLabelText('標題')).not.toBeDisabled();
    expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe(
      '測試劇情點'
    );
  });

  it('key 分頁的類型篩選可單獨看 story', async () => {
    render(<KeysManager />);
    expect(await screen.findByText('xavier-colsono')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^story/ }));
    expect(screen.getByText('test-story')).toBeInTheDocument();
    expect(screen.queryByText('xavier-colsono')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^entity/ }));
    expect(screen.getByText('xavier-colsono')).toBeInTheDocument();
    expect(screen.queryByText('test-story')).not.toBeInTheDocument();
  });

  it('未註冊旗標提供補註冊，POST 帶名稱與草稿欄位', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    fireEvent.click(screen.getByText('lost-signal'));
    fireEvent.change(screen.getByLabelText('標籤'), {
      target: { value: '失落的訊號' },
    });
    fireEvent.click(screen.getByRole('button', { name: '註冊這個旗標' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === '/api/flags' && c.init?.method === 'POST')
      ).toBe(true)
    );
    const post = calls.find(
      (c) => c.url === '/api/flags' && c.init?.method === 'POST'
    );
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({
      name: 'lost-signal',
      label: '失落的訊號',
    });
  });

  it('已註冊旗標的說明來自註冊表，右欄反查不另外請求 usage', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    const before = calls.filter((c) =>
      c.url.startsWith('/api/interlink/usage')
    ).length;
    fireEvent.click(screen.getByText('met-mistina'));
    expect((screen.getByLabelText('說明') as HTMLTextAreaElement).value).toBe(
      '第一章結尾授予'
    );
    expect(screen.getByText('授予端')).toBeInTheDocument();
    expect(screen.getByText('需求端')).toBeInTheDocument();
    expect(screen.getByText('（沒有任何頁面要求）')).toBeInTheDocument();
    expect(
      calls.filter((c) => c.url.startsWith('/api/interlink/usage')).length
    ).toBe(before);
  });

  it('改名要先預覽才能確認，預覽走 dryRun', async () => {
    const { container } = render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    fireEvent.click(screen.getByText('met-mistina'));
    fireEvent.click(screen.getByRole('button', { name: '改名' }));

    // 還沒預覽 → 確認鈕不可按
    expect(screen.getByRole('button', { name: '確認改名' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('新的旗標名稱'), {
      target: { value: 'mistina-met' },
    });
    fireEvent.click(screen.getByRole('button', { name: '預覽影響' }));

    expect(await screen.findByText(/將把 1 頁的 3 處引用/)).toBeInTheDocument();
    // 「第一章」在右欄的授予端引用也出現一次，限定在預覽清單裡看
    const previewBox = container.querySelector('.km-rename-preview');
    expect(previewBox?.textContent).toContain('第一章');
    expect(previewBox?.textContent).toContain('history · 授予 2 · 需求 1');

    const preview = calls.find((c) => c.url.endsWith('/rename'));
    expect(preview?.url).toBe('/api/flags/met-mistina/rename');
    expect(JSON.parse(String(preview?.init?.body))).toEqual({
      to: 'mistina-met',
      dryRun: true,
    });
    // 預覽階段絕不寫入
    expect(calls.filter((c) => c.url.endsWith('/rename')).length).toBe(1);
  });

  it('改名會提示同步狀態被標 modified', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    fireEvent.click(screen.getByText('met-mistina'));
    fireEvent.click(screen.getByRole('button', { name: '改名' }));
    expect(screen.getByText(/modified/)).toBeInTheDocument();
  });

  it('預覽後改動名稱會讓預覽失效，必須重新預覽', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    fireEvent.click(screen.getByText('met-mistina'));
    fireEvent.click(screen.getByRole('button', { name: '改名' }));
    fireEvent.change(screen.getByLabelText('新的旗標名稱'), {
      target: { value: 'first-name' },
    });
    fireEvent.click(screen.getByRole('button', { name: '預覽影響' }));
    await screen.findByText(/將把 1 頁的 3 處引用/);

    // 換成另一個名字——舊預覽不可以被拿去確認
    fireEvent.change(screen.getByLabelText('新的旗標名稱'), {
      target: { value: 'second-name' },
    });
    expect(screen.getByRole('button', { name: '確認改名' })).toBeDisabled();
    expect(screen.queryByText(/將把 1 頁的 3 處引用/)).not.toBeInTheDocument();
  });

  it('確認改名後選取移到新名字上', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    fireEvent.click(screen.getByText('met-mistina'));
    fireEvent.click(screen.getByRole('button', { name: '改名' }));
    fireEvent.change(screen.getByLabelText('新的旗標名稱'), {
      target: { value: 'mistina-met' },
    });
    fireEvent.click(screen.getByRole('button', { name: '預覽影響' }));
    await screen.findByText(/將把 1 頁的 3 處引用/);
    fireEvent.click(screen.getByRole('button', { name: '確認改名' }));

    await waitFor(() => {
      const write = calls.find(
        (c) =>
          c.url.endsWith('/rename') &&
          JSON.parse(String(c.init?.body)).dryRun === undefined
      );
      expect(write).toBeTruthy();
    });
    // 面板收起、選取換到新名字上（audit fixture 仍是舊的，所以中欄會顯示
    // 找不到——那正表示選取已經不指向舊名了）
    await waitFor(() =>
      expect(screen.queryByLabelText('新的旗標名稱')).not.toBeInTheDocument()
    );
    expect(screen.getAllByText('找不到這個旗標').length).toBeGreaterThan(0);
  });

  it('derived 旗標沒有改名入口', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('flag'));
    expandDerived();
    fireEvent.click(screen.getByText('completed:history/chapter-1'));
    expect(
      screen.queryByRole('button', { name: '改名' })
    ).not.toBeInTheDocument();
  });

  it('切換分頁清掉選取，避免中欄顯示左欄看不到的項目', async () => {
    render(<KeysManager />);
    fireEvent.click(await screen.findByText('xavier-colsono'));
    expect(screen.getByLabelText('標題')).toBeInTheDocument();
    fireEvent.click(screen.getByText('flag'));
    expect(screen.getByText('從左欄選一個項目')).toBeInTheDocument();
  });

  it('進度分頁換成全寬總覽，三欄收走', async () => {
    render(<KeysManager />);
    await screen.findByText('xavier-colsono');
    fireEvent.click(screen.getByText('進度'));

    await waitFor(() =>
      expect(calls.map((c) => c.url)).toContain('/api/content/history/tree')
    );
    // 三欄（右欄的「用在哪」）不在了，全寬視圖接手
    expect(screen.queryByText('用在哪')).not.toBeInTheDocument();
    expect(screen.getByText('History 還沒有任何頁面')).toBeInTheDocument();
  });

  it('站台分頁載入設定表單', async () => {
    render(<KeysManager />);
    await screen.findByText('xavier-colsono');
    fireEvent.click(screen.getByText('站台'));

    await waitFor(() =>
      expect(calls.map((c) => c.url)).toContain('/api/settings')
    );
    expect(screen.queryByText('用在哪')).not.toBeInTheDocument();
  });
});
