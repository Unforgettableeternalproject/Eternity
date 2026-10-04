import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';
import { signJwt } from '../auth';
import {
  isExcludedRow,
  isPubliclyListed,
  isStaticallyLocked,
  stubMetadata,
} from '../visibility';

/**
 * 公開讀取端點的靜態可見度（P2）
 *
 * 訪客（無認證／讀者 JWT）：
 * - 軟刪除、草稿不出現；`include_deleted=true` → 401
 * - `metadata.locked === true` → 存根（結構欄位保留，內容剝除）
 * - locked 不沿容器向子孫繼承（對齊前端 effectiveGate）
 * - 依身分或進度可解的條件（requiresFlags／alwaysLocked 等）原樣送出
 * - hidden 維持既有語意
 * 管理員（admin JWT／API_TOKEN）：完整資料、`private, no-store`。
 *
 * 草稿：pages.status 的 CHECK 只允許 synced/modified/local_only，
 * 'draft' 寫不進 D1，只能以單元測試驗證判定函式。
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

const SECRET = 'test-jwt-secret';

async function tokenFor(role: 'super_admin' | 'reader'): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      sub: `cv-${role}`,
      role,
      display_name: role,
      iat: now,
      exp: now + 3600,
      jti: `cv-${role}`,
    },
    SECRET
  );
}

async function get(path: string, token?: string): Promise<Response> {
  const headers = new Headers({ Origin: 'http://localhost:4321' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers }),
    env,
    ctx
  );
}

async function getJson<T>(
  path: string,
  token?: string
): Promise<{ res: Response; data: T }> {
  const res = await get(path, token);
  const json = (await res.json()) as { ok: boolean; data: T };
  return { res, data: json.data };
}

async function insertPage(p: {
  id: string;
  title: string;
  pageType: string;
  parentId?: string | null;
  depth?: number;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
  content?: unknown[];
  deletedAt?: string | null;
}) {
  const [area, ...rest] = p.id.split('/');
  await env.CONTENT_DB.prepare(
    `INSERT INTO pages (id, area, title, slug, sort_order, content, metadata, status, page_type, parent_id, depth, deleted_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, ?, ?)`
  )
    .bind(
      p.id,
      area,
      p.title,
      rest.join('/'),
      p.sortOrder ?? 1,
      JSON.stringify(p.content ?? []),
      JSON.stringify(p.metadata ?? {}),
      p.pageType,
      p.parentId ?? null,
      p.depth ?? 1,
      p.deletedAt ?? null,
      // 讓 recent 排序穩定：測試頁一律排在既有資料之前
      '2099-01-01T00:00:00Z'
    )
    .run();
}

interface TreeNode {
  id: string;
  title: string;
  metadata: Record<string, unknown>;
  children: TreeNode[];
}

function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return undefined;
}

const LOCKED_SONG_META = {
  locked: true,
  entityKey: 'cv-locked-song',
  storyKey: 'cv-locked-story',
  category: 'character',
  audioFile: 'audio/cv-locked.mp3',
  coverImage: 'images/cv-locked.png',
  subtitle: '不該外流的副標',
  spoilerRevisions: [{ sourceLevel: 3, gate: { requiresFlags: ['x'] } }],
  gate: { requiresFlags: ['cv:flag'] },
};

let adminToken = '';
let readerToken = '';

beforeAll(async () => {
  adminToken = await tokenFor('super_admin');
  readerToken = await tokenFor('reader');

  // ---- Echoes：鎖住的 subcategory 底下有一首未鎖的歌（不繼承）----
  await insertPage({
    id: 'echoes/cvc',
    title: 'CV 叢集',
    pageType: 'cluster',
    depth: 1,
  });
  await insertPage({
    id: 'echoes/cvc/locked-sub',
    title: '封存子分類',
    pageType: 'subcategory',
    parentId: 'echoes/cvc',
    depth: 2,
    metadata: { locked: true, description: '子分類說明' },
  });
  await insertPage({
    id: 'echoes/cvc/locked-sub/open-song',
    title: '鎖住容器裡的歌',
    pageType: 'song',
    parentId: 'echoes/cvc/locked-sub',
    depth: 3,
    metadata: { entityKey: 'cv-open-song', audioFile: 'audio/cv-open.mp3' },
  });
  await insertPage({
    id: 'echoes/cvc/locked-song',
    title: '封存的歌',
    pageType: 'song',
    parentId: 'echoes/cvc',
    depth: 2,
    sortOrder: 2,
    metadata: LOCKED_SONG_META,
    content: [{ type: 'rich_text', content: '<p>歌詞</p>' }],
  });
  await insertPage({
    id: 'echoes/cvc/hidden-song',
    title: '隱藏的歌',
    pageType: 'song',
    parentId: 'echoes/cvc',
    depth: 2,
    sortOrder: 3,
    metadata: {
      hidden: true,
      entityKey: 'cv-hidden-song',
      audioFile: 'audio/cv-hidden.mp3',
    },
  });
  await insertPage({
    id: 'echoes/cvc/always-song',
    title: '恆鎖定的歌',
    pageType: 'song',
    parentId: 'echoes/cvc',
    depth: 2,
    sortOrder: 4,
    metadata: {
      entityKey: 'cv-always-song',
      audioFile: 'audio/cv-always.mp3',
      gate: { alwaysLocked: true },
    },
  });
  await insertPage({
    id: 'echoes/cvc/deleted-song',
    title: '刪掉的歌',
    pageType: 'song',
    parentId: 'echoes/cvc',
    depth: 2,
    sortOrder: 5,
    metadata: { entityKey: 'cv-deleted-song' },
    deletedAt: '2026-01-01T00:00:00Z',
  });

  // ---- Visuals ----
  await insertPage({
    id: 'visuals/cvd/locked-gallery',
    title: '封存畫廊',
    pageType: 'gallery',
    depth: 2,
    metadata: {
      locked: true,
      entityKey: 'cv-locked-gallery',
      storyKey: 'cv-locked-ill',
      images: [{ id: 'i1', file: 'images/cv-secret.png', caption: '秘密' }],
    },
  });
  await insertPage({
    id: 'visuals/cvd/open-gallery',
    title: '公開畫廊',
    pageType: 'gallery',
    depth: 2,
    metadata: {
      entityKey: 'cv-open-gallery',
      images: [{ id: 'i1', file: 'images/cv-open.png', caption: '公開' }],
    },
  });

  // ---- History：鎖住的章節（含錨點）與公開章節 ----
  await insertPage({
    id: 'history/cv-locked-arc',
    title: '封存篇章',
    pageType: 'arc',
    metadata: { locked: true, progressPage: true, wordCount: 500 },
    content: [{ type: 'rich_text', content: '<p>封存內文</p>' }],
  });
  await insertPage({
    id: 'history/cv-open-arc',
    title: '公開篇章',
    pageType: 'arc',
    metadata: { wordCount: 100 },
    content: [{ type: 'rich_text', content: '<p>公開內文</p>' }],
  });
  const anchor = env.CONTENT_DB.prepare(
    `INSERT INTO history_interlink_index (page_id, anchor_kind, anchor_id, key_type, key_value, label)
     VALUES (?, 'entity-mark', NULL, 'entity', 'cv-anchor-key', ?)`
  );
  await env.CONTENT_DB.batch([
    anchor.bind('history/cv-locked-arc', '封存標記'),
    anchor.bind('history/cv-open-arc', '公開標記'),
  ]);

  // ---- Concepts：鎖住的 dossier 頁 ----
  await insertPage({
    id: 'concepts/cv-locked-dossier',
    title: '封存檔案',
    pageType: 'type',
    metadata: { locked: true, stack_style: 'browser' },
    content: [
      {
        type: 'structured',
        content: JSON.stringify({
          profiles: [{ name: '秘密人物', entityKey: 'cv-secret-person' }],
        }),
      },
    ],
  });
  await insertPage({
    id: 'concepts/cv-open-dossier',
    title: '公開檔案',
    pageType: 'type',
    metadata: { stack_style: 'browser' },
    content: [
      {
        type: 'structured',
        content: JSON.stringify({
          profiles: [{ name: '公開人物', entityKey: 'cv-open-person' }],
        }),
      },
    ],
  });
});

describe('visibility helpers', () => {
  it('草稿與軟刪除排除', () => {
    expect(isExcludedRow({ status: 'draft' })).toBe(true);
    expect(isExcludedRow({ status: 'synced', deleted_at: '2026-01-01' })).toBe(
      true
    );
    expect(isExcludedRow({ status: 'synced', deleted_at: null })).toBe(false);
  });

  it('靜態鎖只認 metadata.locked === true；alwaysLocked 不算（觀測者可解）', () => {
    expect(isStaticallyLocked({ locked: true })).toBe(true);
    expect(isStaticallyLocked({ locked: 1 })).toBe(false);
    expect(isStaticallyLocked({ gate: { alwaysLocked: true } })).toBe(false);
    expect(isStaticallyLocked({ alwaysLocked: true })).toBe(false);
    expect(isStaticallyLocked({ gate: { requiresFlags: ['a'] } })).toBe(false);
    expect(isStaticallyLocked(null)).toBe(false);
  });

  it('公開清單口徑：草稿／hidden／靜態鎖／壞 metadata 排除', () => {
    expect(isPubliclyListed({ status: 'synced', metadata: '{}' })).toBe(true);
    expect(isPubliclyListed({ status: 'draft', metadata: '{}' })).toBe(false);
    expect(
      isPubliclyListed({ status: 'synced', metadata: '{"hidden":true}' })
    ).toBe(false);
    expect(
      isPubliclyListed({ status: 'synced', metadata: '{"locked":true}' })
    ).toBe(false);
    expect(isPubliclyListed({ status: 'synced', metadata: '{bad' })).toBe(
      false
    );
  });

  it('存根 metadata 只留結構欄位', () => {
    const stub = stubMetadata(LOCKED_SONG_META);
    expect(stub).toEqual({
      locked: true,
      gate: { requiresFlags: ['cv:flag'] },
      category: 'character',
      redacted: true,
    });
  });
});

describe('GET /api/content/:area/tree', () => {
  it('訪客：靜態鎖節點存根、子節點不繼承、hidden 與 alwaysLocked 照送、軟刪除不出', async () => {
    const { res, data } = await getJson<TreeNode[]>('/api/content/echoes/tree');
    expect(res.status).toBe(200);

    const song = findNode(data, 'echoes/cvc/locked-song')!;
    expect(song.title).toBe('');
    expect(song.metadata.redacted).toBe(true);
    expect(song.metadata.locked).toBe(true);
    expect(song.metadata).not.toHaveProperty('audioFile');
    expect(song.metadata).not.toHaveProperty('entityKey');
    expect(song.metadata).not.toHaveProperty('storyKey');
    expect(song.metadata).not.toHaveProperty('spoilerRevisions');
    expect(song.metadata).not.toHaveProperty('coverImage');

    const sub = findNode(data, 'echoes/cvc/locked-sub')!;
    expect(sub.title).toBe('');
    expect(sub.metadata).not.toHaveProperty('description');
    // 鎖住容器的子節點不被存根（locked 不向下繼承）
    const child = findNode(sub.children, 'echoes/cvc/locked-sub/open-song')!;
    expect(child.title).toBe('鎖住容器裡的歌');
    expect(child.metadata.audioFile).toBe('audio/cv-open.mp3');

    const hidden = findNode(data, 'echoes/cvc/hidden-song')!;
    expect(hidden.metadata.audioFile).toBe('audio/cv-hidden.mp3');

    const always = findNode(data, 'echoes/cvc/always-song')!;
    expect(always.title).toBe('恆鎖定的歌');
    expect(always.metadata.audioFile).toBe('audio/cv-always.mp3');

    expect(findNode(data, 'echoes/cvc/deleted-song')).toBeUndefined();
  });

  it('管理員：完整資料，回應不進共用快取', async () => {
    const { res, data } = await getJson<TreeNode[]>(
      '/api/content/echoes/tree',
      adminToken
    );
    const song = findNode(data, 'echoes/cvc/locked-song')!;
    expect(song.title).toBe('封存的歌');
    expect(song.metadata.audioFile).toBe('audio/cv-locked.mp3');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toBe('Authorization');
  });

  it('訪客回應可共用快取但以 Authorization 區分', async () => {
    const res = await get('/api/content/echoes/tree');
    expect(res.headers.get('Cache-Control')).toContain('public');
    expect(res.headers.get('Vary')).toBe('Authorization');
  });

  it('讀者 JWT 仍是訪客視角', async () => {
    const { res, data } = await getJson<TreeNode[]>(
      '/api/content/echoes/tree',
      readerToken
    );
    expect(findNode(data, 'echoes/cvc/locked-song')!.title).toBe('');
    expect(res.headers.get('Cache-Control')).toContain('public');
  });

  it('include_deleted：訪客 401、管理員可見軟刪除', async () => {
    const anon = await get('/api/content/echoes/tree?include_deleted=true');
    expect(anon.status).toBe(401);
    const { data } = await getJson<TreeNode[]>(
      '/api/content/echoes/tree?include_deleted=true',
      adminToken
    );
    expect(findNode(data, 'echoes/cvc/deleted-song')).toBeDefined();
  });
});

describe('GET /api/content/:area（列表）', () => {
  it('訪客：靜態鎖標題清空；管理員完整', async () => {
    type Item = { id: string; title: string };
    const anon = await getJson<Item[]>('/api/content/echoes');
    expect(
      anon.data.find((i) => i.id === 'echoes/cvc/locked-song')!.title
    ).toBe('');
    expect(anon.res.headers.get('Vary')).toBe('Authorization');
    const admin = await getJson<Item[]>('/api/content/echoes', adminToken);
    expect(
      admin.data.find((i) => i.id === 'echoes/cvc/locked-song')!.title
    ).toBe('封存的歌');
    expect(admin.res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('include_deleted：訪客 401、管理員 200', async () => {
    expect((await get('/api/content/echoes?include_deleted=true')).status).toBe(
      401
    );
    expect(
      (await get('/api/content/echoes?include_deleted=true', adminToken)).status
    ).toBe(200);
  });
});

describe('GET /api/content/:area/:slug', () => {
  type PageData = {
    id: string;
    title: string;
    content: unknown[];
    metadata: Record<string, unknown>;
    parentId: string | null;
    pageType: string;
    sourceFile: string | null;
  };

  it('訪客：靜態鎖頁回存根（結構保留、內容剝除）', async () => {
    const { res, data } = await getJson<PageData>(
      '/api/content/history/cv-locked-arc'
    );
    expect(res.status).toBe(200);
    expect(data.id).toBe('history/cv-locked-arc');
    expect(data.pageType).toBe('arc');
    expect(data.title).toBe('');
    expect(data.content).toEqual([]);
    expect(data.metadata).toEqual({
      locked: true,
      progressPage: true,
      redacted: true,
    });
  });

  it('訪客：Concepts 靜態鎖頁的結構化內容整份剝除', async () => {
    const { data } = await getJson<PageData>(
      '/api/content/concepts/cv-locked-dossier'
    );
    expect(JSON.stringify(data)).not.toContain('秘密人物');
    expect(data.metadata.stack_style).toBe('browser');
  });

  it('管理員：完整內容、private', async () => {
    const { res, data } = await getJson<PageData>(
      '/api/content/history/cv-locked-arc',
      adminToken
    );
    expect(data.title).toBe('封存篇章');
    expect(data.content).toHaveLength(1);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('軟刪除：訪客 404；include_deleted 訪客 401', async () => {
    expect((await get('/api/content/echoes/cvc/deleted-song')).status).toBe(
      404
    );
    expect(
      (await get('/api/content/echoes/cvc/deleted-song?include_deleted=true'))
        .status
    ).toBe(401);
  });
});

describe('Echoes 反查', () => {
  type SongResp = {
    found: boolean;
    song?: Record<string, unknown>;
  };

  it('by-id：訪客拿存根，管理員拿完整', async () => {
    const anon = await getJson<SongResp>(
      '/api/echoes/song?id=echoes/cvc/locked-song'
    );
    expect(anon.data.found).toBe(true);
    expect(anon.data.song).toMatchObject({
      id: 'echoes/cvc/locked-song',
      title: '',
      audioFile: null,
      entityKey: null,
      storyKey: null,
      locked: true,
      redacted: true,
      clusterId: 'cvc',
    });
    expect(anon.data.song).not.toHaveProperty('spoilerRevisions');

    const admin = await getJson<SongResp>(
      '/api/echoes/song?id=echoes/cvc/locked-song',
      adminToken
    );
    expect(admin.data.song!.audioFile).toBe('audio/cv-locked.mp3');
    expect(admin.res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('by-id：hidden 照舊回完整資料（echo spot 引用）', async () => {
    const { data } = await getJson<SongResp>(
      '/api/echoes/song?id=echoes/cvc/hidden-song'
    );
    expect(data.song!.audioFile).toBe('audio/cv-hidden.mp3');
  });

  it('by-key：靜態鎖回存根', async () => {
    const { data } = await getJson<SongResp>(
      '/api/echoes/entity-song?key=cv-locked-song'
    );
    expect(data.found).toBe(true);
    expect(data.song!.audioFile).toBeNull();
    expect(data.song!.title).toBe('');
  });
});

describe('Visuals 反查', () => {
  type GalleryResp = { found: boolean; gallery?: Record<string, unknown> };

  it('by-id／by-story／by-key：訪客拿無圖存根', async () => {
    for (const path of [
      '/api/visuals/gallery?id=visuals/cvd/locked-gallery',
      '/api/visuals/gallery?story=cv-locked-ill',
      '/api/visuals/entity-gallery?key=cv-locked-gallery',
    ]) {
      const { data } = await getJson<GalleryResp>(path);
      expect(data.found).toBe(true);
      expect(data.gallery).toMatchObject({
        id: 'visuals/cvd/locked-gallery',
        title: '',
        entityKey: null,
        storyKey: null,
        locked: true,
        images: [],
        redacted: true,
      });
    }
  });

  it('管理員拿完整圖片', async () => {
    const { data } = await getJson<GalleryResp>(
      '/api/visuals/gallery?id=visuals/cvd/locked-gallery',
      adminToken
    );
    expect(data.gallery!.images).toHaveLength(1);
  });

  it('未鎖畫廊不受影響', async () => {
    const { data } = await getJson<GalleryResp>(
      '/api/visuals/gallery?id=visuals/cvd/open-gallery'
    );
    expect((data.gallery!.images as unknown[]).length).toBe(1);
  });
});

describe('/api/concepts/entity-index', () => {
  type Idx = { entries: { entityKey?: string; name: string }[] };

  it('訪客：靜態鎖頁的條目不進索引；管理員照收', async () => {
    const anon = await getJson<Idx>('/api/concepts/entity-index');
    const anonKeys = anon.data.entries.map((e) => e.entityKey);
    expect(anonKeys).not.toContain('cv-secret-person');
    expect(anonKeys).toContain('cv-open-person');

    const admin = await getJson<Idx>('/api/concepts/entity-index', adminToken);
    expect(admin.data.entries.map((e) => e.entityKey)).toContain(
      'cv-secret-person'
    );
    expect(admin.res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

describe('/api/interlink/anchors', () => {
  type Anchors = { anchors: { pageId: string }[] };

  it('訪客：靜態鎖頁的錨點不出現；管理員照收', async () => {
    const path = '/api/interlink/anchors?keyType=entity&key=cv-anchor-key';
    const anon = await getJson<Anchors>(path);
    expect(anon.data.anchors.map((a) => a.pageId)).toEqual([
      'history/cv-open-arc',
    ]);
    expect(anon.data.anchors[0]).not.toHaveProperty('pageMetadata');
    const admin = await getJson<Anchors>(path, adminToken);
    expect(admin.data.anchors.map((a) => a.pageId).sort()).toEqual([
      'history/cv-locked-arc',
      'history/cv-open-arc',
    ]);
  });
});

describe('/api/content/recent', () => {
  it('靜態鎖與 hidden 排除；alwaysLocked 照列（觀測者可解）', async () => {
    type Item = { id: string };
    const { data } = await getJson<Item[]>('/api/content/recent?limit=20');
    const ids = data.map((i) => i.id);
    expect(ids).not.toContain('echoes/cvc/locked-song');
    expect(ids).not.toContain('echoes/cvc/hidden-song');
    expect(ids).not.toContain('echoes/cvc/deleted-song');
    expect(ids).toContain('echoes/cvc/always-song');
  });
});
