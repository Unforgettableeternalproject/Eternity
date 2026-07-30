import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';

/**
 * 自訂旗標註冊表的 CRUD 與全站巡查（/api/flags*）
 *
 * 巡查的重點不在「掃得到」而在**分類正確**：規則生成的旗標沒有內容裡的
 * 授予點（掃描線與 echo spot 是程式授予），若把它們算進使用狀態判定，每一個
 * gate 用的 `completed:*` 都會變成假警報，清單直接失去可讀性。
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

function createRequest(
  path: string,
  options: RequestInit & { token?: string } = {}
) {
  const { token, ...init } = options;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return new Request(`https://example.com${path}`, { ...init, headers });
}

let adminToken: string | undefined;

async function getAdminToken(): Promise<string> {
  if (adminToken) return adminToken;
  await worker.fetch(
    createRequest('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'flags-admin',
        password: 'flags-password',
        display_name: 'Flags Admin',
      }),
    }),
    env,
    ctx
  );
  const res = await worker.fetch(
    createRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'flags-admin',
        password: 'flags-password',
      }),
    }),
    env,
    ctx
  );
  const json = (await res.json()) as { data?: { token?: string } };
  adminToken = json.data?.token as string;
  return adminToken;
}

async function api(
  path: string,
  options: RequestInit & { token?: string } = {}
) {
  const res = await worker.fetch(createRequest(path, options), env, ctx);
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    data?: Record<string, unknown>;
    /** 存檔時自動補進註冊表的旗標；沒有新增時整個欄位不出現 */
    autoRegisteredFlags?: string[];
  };
  return { status: res.status, json };
}

async function authed(
  path: string,
  options: RequestInit & { token?: string } = {}
) {
  return api(path, { ...options, token: await getAdminToken() });
}

async function postJson(path: string, body: unknown) {
  return authed(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 建一頁 History，content 可帶 FlagMarker、metadata 可帶 gate */
async function putPage(
  slug: string,
  opts: { markerFlags?: string[]; requiresFlags?: string[] }
) {
  const html = opts.markerFlags
    ? `<div data-role="progress-marker" data-grants-flags="${opts.markerFlags.join(',')}"></div><p>內文</p>`
    : '<p>內文</p>';
  return authed(`/api/content/history/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: slug,
      pageType: 'section',
      content: [{ type: 'rich_text', content: html }],
      metadata: opts.requiresFlags
        ? { gate: { requiresFlags: opts.requiresFlags } }
        : {},
    }),
  });
}

interface AuditRow {
  name: string;
  source: string;
  grantedBy: { pageId: string }[];
  requiredBy: { pageId: string }[];
  usage: 'used' | 'no-demand' | 'no-grant' | 'orphan' | null;
}

async function audit(): Promise<AuditRow[]> {
  const { json } = await authed('/api/flags/audit');
  return (json.data?.flags as AuditRow[]) || [];
}

describe('/api/flags — 註冊表 CRUD', () => {
  it('POST 註冊新旗標 → 201', async () => {
    const { status, json } = await postJson('/api/flags', {
      name: 'act1-truth-revealed',
      label: '真相揭露',
      category: 'story',
    });
    expect(status).toBe(201);
    expect(json.data?.flag).toMatchObject({
      name: 'act1-truth-revealed',
      label: '真相揭露',
      category: 'story',
      description: null,
    });
  });

  it('POST 重複名稱 → 409', async () => {
    const { status } = await postJson('/api/flags', {
      name: 'act1-truth-revealed',
    });
    expect(status).toBe(409);
  });

  /**
   * 規則生成形狀的名稱由程式依 key 推導，註冊它等於在 key 定義之外
   * 開第二個事實來源。
   */
  it('POST 規則生成形狀 → 400', async () => {
    for (const name of ['completed:history/x', 'foo:song', 'met:novia']) {
      const { status } = await postJson('/api/flags', { name });
      expect(status, name).toBe(400);
    }
  });

  it('POST 缺名稱 → 400', async () => {
    const { status } = await postJson('/api/flags', { label: '沒有名字' });
    expect(status).toBe(400);
  });

  it('GET 清單可依 category 過濾', async () => {
    await postJson('/api/flags', { name: 'debug-skip', category: 'debug' });
    const all = await authed('/api/flags');
    expect((all.json.data?.flags as unknown[]).length).toBeGreaterThanOrEqual(
      2
    );
    const debugOnly = await authed('/api/flags?category=debug');
    expect(debugOnly.json.data?.flags).toEqual([
      expect.objectContaining({ name: 'debug-skip', category: 'debug' }),
    ]);
  });

  it('PUT 更新 label／description／category', async () => {
    const { status, json } = await authed('/api/flags/act1-truth-revealed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: '改過的標籤', description: '說明' }),
    });
    expect(status).toBe(200);
    expect(json.data?.flag).toMatchObject({
      label: '改過的標籤',
      description: '說明',
      // PUT 是整份替換：沒帶的欄位收斂成 NULL，不是保持原值
      category: null,
    });
  });

  it('PUT 不存在的旗標 → 404', async () => {
    const { status } = await authed('/api/flags/never-registered', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'x' }),
    });
    expect(status).toBe(404);
  });

  it('全段未授權 → 401', async () => {
    expect((await api('/api/flags')).status).toBe(401);
    expect((await api('/api/flags/audit')).status).toBe(401);
    expect(
      (
        await api('/api/flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'sneaky' }),
        })
      ).status
    ).toBe(401);
  });

  /**
   * `audit` 若被 `/flags/:name` 的正規式吃掉，就會被當成一個名為 audit
   * 的旗標，PUT/DELETE 打上去會改到不存在的東西。
   */
  it('/flags/audit 不被 /flags/:name 路由吃掉', async () => {
    const { status, json } = await authed('/api/flags/audit');
    expect(status).toBe(200);
    expect(Array.isArray(json.data?.flags)).toBe(true);
  });
});

describe('/api/flags/audit — 全站巡查', () => {
  beforeAll(async () => {
    await postJson('/api/flags', { name: 'audit-registered-both' });
    await postJson('/api/flags', { name: 'audit-no-grant' });
    await postJson('/api/flags', { name: 'audit-no-demand' });
    await postJson('/api/flags', { name: 'audit-never-used' });

    // 授予端 + 需求端都有
    await putPage('audit/grants-both', {
      markerFlags: ['audit-registered-both', 'audit-no-demand'],
    });
    await putPage('audit/requires-both', {
      requiresFlags: ['audit-registered-both', 'audit-no-grant'],
    });
    // 內容裡在用但沒註冊。
    // ⚠️ 這一頁只能直接寫 DB 造：存檔路徑會把未註冊旗標**自動補進註冊表**
    // （D-1 反轉後不再 409），走正常路徑造出來的一律是 registered。巡查要
    // 看得到的是「強制刪除過註冊」或「直接改 DB」產生的，那才是這個分類
    // 存在的理由。
    await env.CONTENT_DB.prepare(
      `INSERT OR REPLACE INTO pages
         (id, area, title, slug, sort_order, content, metadata, status, page_type, depth)
       VALUES (?, 'history', ?, ?, 0, ?, '{}', 'synced', 'section', 3)`
    )
      .bind(
        'history/audit/unregistered',
        'audit/unregistered',
        'audit/unregistered',
        JSON.stringify([
          {
            type: 'rich_text',
            content:
              '<div data-role="progress-marker" data-grants-flags="audit-unregistered"></div>',
          },
        ])
      )
      .run();
    // 規則生成旗標被 gate 要求（授予端在程式裡，內容裡找不到）
    await putPage('audit/derived-required', {
      requiresFlags: ['completed:history/audit/grants-both'],
    });
  });

  it('授予端與需求端都掃到，且分類為 registered', async () => {
    const row = (await audit()).find((f) => f.name === 'audit-registered-both');
    expect(row?.source).toBe('registered');
    expect(row?.grantedBy.map((g) => g.pageId)).toContain(
      'history/audit/grants-both'
    );
    expect(row?.requiredBy.map((r) => r.pageId)).toContain(
      'history/audit/requires-both'
    );
    expect(row?.usage).toBe('used');
  });

  /**
   * ⚠️ 四態裡只有這一種會造成故障：需求端等一個再也不會被授予的旗標，
   * 沒有錯誤訊息，那一頁就是永遠打不開。
   */
  it('有人要求但沒地方授予 → no-grant', async () => {
    const row = (await audit()).find((f) => f.name === 'audit-no-grant');
    expect(row?.usage).toBe('no-grant');
  });

  it('有授予但沒人要求 → no-demand', async () => {
    const row = (await audit()).find((f) => f.name === 'audit-no-demand');
    expect(row?.usage).toBe('no-demand');
  });

  /**
   * derived 不參與使用狀態判定：它們是唯讀參考，授予端在程式裡，沒有
   * 「該不該用」的問題。實際上 audit 收錄 derived 的前提就是被 gate 要求，
   * 所以永遠有需求端——這條斷言鎖的是「就算哪天收錄條件放寬也不會誤標」。
   */
  it('derived 旗標的 usage 為 null', async () => {
    const row = (await audit()).find(
      (f) => f.name === 'completed:history/audit/grants-both'
    );
    expect(row).toMatchObject({ source: 'derived', usage: null });
  });

  it('內容在用但註冊表沒有 → unregistered', async () => {
    const row = (await audit()).find((f) => f.name === 'audit-unregistered');
    expect(row?.source).toBe('unregistered');
  });

  /**
   * 兩端都空 = orphan。會出現在「某頁的 marker 授予過它、後來 marker 被
   * 刪掉」之後——註冊表的列還在，引用歸零。
   */
  it('註冊了但完全沒用到 → 列出且標 orphan', async () => {
    const row = (await audit()).find((f) => f.name === 'audit-never-used');
    expect(row).toMatchObject({ source: 'registered', usage: 'orphan' });
    expect(row?.grantedBy).toEqual([]);
    expect(row?.requiredBy).toEqual([]);
  });

  /**
   * 這是本端點最容易寫錯的地方：`completed:*` 的授予端是掃描線（程式），
   * 內容裡永遠找不到 grants，若照一般規則判定就會全部變成 no-grant 假警報。
   */
  it('規則生成旗標標為 derived，不因無授予端被誤判', async () => {
    const row = (await audit()).find(
      (f) => f.name === 'completed:history/audit/grants-both'
    );
    expect(row?.source).toBe('derived');
    expect(row?.requiredBy.length).toBeGreaterThan(0);
    expect(row?.grantedBy).toEqual([]);
    expect(row?.usage).toBeNull();
  });
});

/**
 * `pnpm sync` 用 updated_at 比對兩端誰較新。若寫入時一律蓋成當下時間，
 * 被推過去的那筆立刻變「較新」，下一次同步就反向覆蓋回來，兩端永遠在
 * 互相推翻。
 */
describe('時間戳保留（同步用）', () => {
  const STAMP = '2020-01-02T03:04:05.000Z';

  async function stampOf(name: string) {
    return env.CONTENT_DB.prepare(
      `SELECT created_at AS createdAt, updated_at AS updatedAt
       FROM uep_flags WHERE name = ?`
    )
      .bind(name)
      .first<{ createdAt: string; updatedAt: string }>();
  }

  it('POST 帶 updatedAt 時 created_at 與 updated_at 都用它', async () => {
    await postJson('/api/flags', { name: 'stamped-new', updatedAt: STAMP });
    expect(await stampOf('stamped-new')).toEqual({
      createdAt: STAMP,
      updatedAt: STAMP,
    });
  });

  it('PUT 帶 updatedAt 時採用該值', async () => {
    const later = '2021-06-07T08:09:10.000Z';
    await authed('/api/flags/stamped-new', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: '更新', updatedAt: later }),
    });
    const row = await stampOf('stamped-new');
    expect(row?.updatedAt).toBe(later);
    // created_at 不因更新而變動
    expect(row?.createdAt).toBe(STAMP);
  });

  it('非法或缺少的時間戳退回當下時間', async () => {
    await postJson('/api/flags', {
      name: 'stamped-bad',
      updatedAt: '不是時間',
    });
    const row = await stampOf('stamped-bad');
    expect(row?.updatedAt).not.toBe('不是時間');
    expect(Number.isNaN(Date.parse(row?.updatedAt ?? ''))).toBe(false);
  });
});

/**
 * 存檔時自動註冊，**不擋**（D-1 反轉，艾斯維爾 2026-07-30 定案）。
 *
 * 與 entityKey／storyKey 同一個模式：自由填 → 存檔時建立註冊列 → 事後補說明。
 * typo 交給巡查抓（打錯的標 no-demand、正確的標 no-grant，一組同時出現），事前擋
 * 的代價是每次多一道手續，而且會連帶關掉 derived 旗標的需求端。
 */
describe('存檔時的旗標自動註冊', () => {
  it('內容帶未註冊自訂旗標 → 照常存檔並補進註冊表', async () => {
    const { status, json } = await putPage('gate/unregistered-grant', {
      markerFlags: ['not-registered-yet'],
    });
    expect(status).toBeLessThan(300);
    expect(json.autoRegisteredFlags).toEqual(['not-registered-yet']);

    const { json: list } = await authed('/api/flags');
    const names = (list.data?.flags as { name: string }[]).map((f) => f.name);
    expect(names).toContain('not-registered-yet');
  });

  it('gate 要求的未註冊旗標同樣自動補上', async () => {
    const { status, json } = await putPage('gate/unregistered-require', {
      requiresFlags: ['also-not-registered'],
    });
    expect(status).toBeLessThan(300);
    expect(json.autoRegisteredFlags).toEqual(['also-not-registered']);
  });

  /**
   * 事前強制註冊會讓這條路永遠走不通：那個旗標依設計不可註冊，
   * 於是 gate 填不進去。
   */
  it('需求端可以要求 derived 旗標（聽過某首歌 / 看過某張圖）', async () => {
    const { status } = await putPage('gate/require-derived', {
      requiresFlags: ['rain-sea-finale:song', 'image:visuals%2Fg-a:img-01'],
    });
    expect(status).toBeLessThan(300);
    // derived 一律豁免，不該被塞進註冊表
    const { json: list } = await authed('/api/flags');
    const names = (list.data?.flags as { name: string }[]).map((f) => f.name);
    expect(names).not.toContain('rain-sea-finale:song');
    expect(names).not.toContain('image:visuals%2Fg-a:img-01');
  });

  it('已註冊的旗標不重複註冊，也不回報', async () => {
    await postJson('/api/flags', { name: 'already-there-flag' });
    const { status, json } = await putPage('gate/already-registered', {
      markerFlags: ['already-there-flag'],
    });
    expect(status).toBeLessThan(300);
    expect(json.autoRegisteredFlags).toBeUndefined();
  });

  /**
   * 「requires completion…」picker 產生的正是 `completed:{pageId}`。
   * 這條路徑若被誤擋，等於整個進度鏈設定功能失效。
   */
  it('只帶 derived 旗標不受影響（回歸）', async () => {
    const { status } = await putPage('gate/derived-only', {
      requiresFlags: ['completed:history/anything', 'foo:song'],
      markerFlags: ['zone:visited:echoes'],
    });
    expect(status).toBeLessThan(300);
  });

  /**
   * PUT 支援部分更新。只改標題時不帶 content／metadata，就不該去掃舊內容——
   * 比照既有 key 唯一性檢查的同一條慣例。反轉後症狀從「被舊旗標擋住」變成
   * 「把舊內容的旗標默默註冊進去」，一樣不該發生。
   */
  it('不帶 content 與 metadata 的部分更新不觸發檢查', async () => {
    await env.CONTENT_DB.prepare(
      `INSERT OR REPLACE INTO pages
         (id, area, title, slug, sort_order, content, metadata, status, page_type, depth)
       VALUES (?, 'history', ?, ?, 0, ?, '{}', 'synced', 'section', 3)`
    )
      .bind(
        'history/gate/legacy',
        'gate/legacy',
        'gate/legacy',
        JSON.stringify([
          {
            type: 'rich_text',
            content:
              '<div data-role="progress-marker" data-grants-flags="legacy-unregistered"></div>',
          },
        ])
      )
      .run();

    const { status, json } = await authed('/api/content/history/gate/legacy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '只改標題' }),
    });
    expect(status).toBeLessThan(300);
    expect(json.autoRegisteredFlags).toBeUndefined();

    const { json: list } = await authed('/api/flags');
    const names = (list.data?.flags as { name: string }[]).map((f) => f.name);
    expect(names).not.toContain('legacy-unregistered');
  });
});

/**
 * 批次匯入刻意與單頁存檔不同調：自動註冊而非 409。
 *
 * `uep_flags` 不在 `pnpm sync` 的同步範圍（只搬 pages 與 root_* 業務表），
 * 本地註冊好的旗標推上遠端時遠端註冊表是空的，一擋就是整個同步流程卡死。
 */
describe('sync/import — 旗標自動註冊', () => {
  it('未註冊旗標不擋，自動補進註冊表並回報', async () => {
    const { status, json } = await authed('/api/content/sync/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: [
          {
            id: 'history/imp/flagged',
            area: 'history',
            title: '匯入的一頁',
            slug: 'imp/flagged',
            sourceFile: 'imp/flagged.md',
            contentHash: 'hash-imp-flagged',
            pageType: 'section',
            depth: 3,
            content: [
              {
                type: 'rich_text',
                content:
                  '<div data-role="progress-marker" data-grants-flags="imported-flag"></div>',
              },
            ],
            metadata: { gate: { requiresFlags: ['imported-required'] } },
          },
        ],
      }),
    });

    expect(status).toBe(200);
    expect(json.data?.imported).toBe(1);
    expect(json.data?.autoRegisteredFlags).toEqual(
      expect.arrayContaining(['imported-flag', 'imported-required'])
    );

    // 補進去之後巡查就不該再顯示 unregistered
    const row = (await audit()).find((f) => f.name === 'imported-flag');
    expect(row?.source).toBe('registered');
  });

  it('derived 旗標不會被自動註冊進表', async () => {
    await authed('/api/content/sync/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: [
          {
            id: 'history/imp/derived-only',
            area: 'history',
            title: '只有 derived 旗標',
            slug: 'imp/derived-only',
            sourceFile: 'imp/derived-only.md',
            contentHash: 'hash-imp-derived',
            pageType: 'section',
            depth: 3,
            content: [],
            metadata: { gate: { requiresFlags: ['completed:history/imp/x'] } },
          },
        ],
      }),
    });
    const { json } = await authed('/api/flags');
    const names = (json.data?.flags as { name: string }[]).map((f) => f.name);
    expect(names).not.toContain('completed:history/imp/x');
  });
});

describe('DELETE /api/flags/:name — 引用檢查', () => {
  beforeAll(async () => {
    await postJson('/api/flags', { name: 'del-referenced' });
    await postJson('/api/flags', { name: 'del-free' });
    await putPage('del/holder', { markerFlags: ['del-referenced'] });
  });

  it('有引用時 → 409 並列出引用清單', async () => {
    const { status, json } = await authed('/api/flags/del-referenced', {
      method: 'DELETE',
    });
    expect(status).toBe(409);
    const refs = json.data?.references as {
      grantedBy: { pageId: string }[];
    };
    expect(refs.grantedBy.map((g) => g.pageId)).toContain('history/del/holder');
  });

  it('無引用時直接刪除', async () => {
    const { status } = await authed('/api/flags/del-free', {
      method: 'DELETE',
    });
    expect(status).toBe(200);
    const { status: again } = await authed('/api/flags/del-free', {
      method: 'DELETE',
    });
    expect(again).toBe(404);
  });

  /**
   * 強制刪除只移除註冊列、不動內容——所以那個旗標會在下次巡查以
   * unregistered 出現，而不是靜默消失。
   */
  it('?force=true 強制刪除後，該旗標於巡查顯示 unregistered', async () => {
    const { status } = await authed('/api/flags/del-referenced?force=true', {
      method: 'DELETE',
    });
    expect(status).toBe(200);
    const row = (await audit()).find((f) => f.name === 'del-referenced');
    expect(row?.source).toBe('unregistered');
    expect(row?.grantedBy.length).toBeGreaterThan(0);
  });
});
