import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  countPlainTextChars,
  countVisiblePages,
  computeHistoryTotalWords,
  extractPlainTextFromBlocks,
  fetchUepVisitorCount,
  buildDiscordStats,
} from '../widget-stats';
import type { ContentBlock } from '../types';

/**
 * widget-stats 純函式與整合測試。
 *
 * 測試策略：
 * - countPlainTextChars / extractPlainTextFromBlocks 純函式直接測
 * - countVisiblePages / computeHistoryTotalWords 用 D1 fixture 驗證 hidden/locked/deleted 排除
 * - fetchUepVisitorCount 用 monkey-patch globalThis.fetch 模擬
 * - buildDiscordStats 整合上述所有邏輯
 */

async function insertPage(row: {
  id: string;
  area: string;
  slug: string;
  pageType: string;
  content?: ContentBlock[];
  metadata?: Record<string, unknown>;
  deleted?: boolean;
}) {
  await env.CONTENT_DB.prepare(
    `INSERT INTO pages
       (id, area, title, slug, sort_order, content, metadata, status, page_type, depth, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      row.area,
      row.slug,
      row.slug,
      0,
      JSON.stringify(row.content ?? []),
      JSON.stringify(row.metadata ?? {}),
      'synced',
      row.pageType,
      0,
      row.deleted ? new Date().toISOString() : null
    )
    .run();
}

async function clearPages(area: string) {
  await env.CONTENT_DB.prepare('DELETE FROM pages WHERE area = ?')
    .bind(area)
    .run();
}

describe('widget-stats — countPlainTextChars', () => {
  it('去空白後計字元數（對齊編輯器 ThoughtStream 口徑）', () => {
    expect(countPlainTextChars('你好 世界')).toBe(4);
    expect(countPlainTextChars('  hello  world  ')).toBe(10);
    expect(countPlainTextChars('')).toBe(0);
    expect(countPlainTextChars('\n\t\r ')).toBe(0);
  });
});

describe('widget-stats — extractPlainTextFromBlocks', () => {
  it('rich_text 去 HTML tag 後保留文字', () => {
    const blocks: ContentBlock[] = [
      { id: 'a', type: 'rich_text', content: '<p>諾薇亞</p><p>行動中</p>' },
    ];
    const text = extractPlainTextFromBlocks(blocks);
    expect(countPlainTextChars(text)).toBe(6); // 諾薇亞行動中
  });

  it('paragraph/heading/blockquote/list 都計入', () => {
    const blocks: ContentBlock[] = [
      { id: '1', type: 'heading', content: '<h2>標題</h2>' },
      { id: '2', type: 'paragraph', content: '<p>段落</p>' },
      { id: '3', type: 'blockquote', content: '<blockquote>引用</blockquote>' },
      { id: '4', type: 'list', content: '<li>清單</li>' },
    ];
    expect(countPlainTextChars(extractPlainTextFromBlocks(blocks))).toBe(8);
  });

  it('image/audio/divider/code 不計入字數', () => {
    const blocks: ContentBlock[] = [
      { id: '1', type: 'image', content: '/img/x.png' },
      { id: '2', type: 'audio', content: '/audio/x.mp3' },
      { id: '3', type: 'divider', content: '---' },
      { id: '4', type: 'code', content: 'const x = 1;' },
    ];
    expect(countPlainTextChars(extractPlainTextFromBlocks(blocks))).toBe(0);
  });
});

describe('widget-stats — countVisiblePages（D1 整合）', () => {
  beforeEach(async () => {
    await clearPages('echoes');
  });

  it('只算符合 area/page_type 且未 deleted/hidden/locked 的頁', async () => {
    await insertPage({
      id: 'echoes/song-a',
      area: 'echoes',
      slug: 'song-a',
      pageType: 'song',
    });
    await insertPage({
      id: 'echoes/song-b',
      area: 'echoes',
      slug: 'song-b',
      pageType: 'song',
    });
    await insertPage({
      id: 'echoes/song-hidden',
      area: 'echoes',
      slug: 'song-hidden',
      pageType: 'song',
      metadata: { hidden: true },
    });
    await insertPage({
      id: 'echoes/song-locked',
      area: 'echoes',
      slug: 'song-locked',
      pageType: 'song',
      metadata: { locked: true },
    });
    await insertPage({
      id: 'echoes/song-deleted',
      area: 'echoes',
      slug: 'song-deleted',
      pageType: 'song',
      deleted: true,
    });
    await insertPage({
      id: 'echoes/cluster-x',
      area: 'echoes',
      slug: 'cluster-x',
      pageType: 'cluster', // 非 song，不應計入
    });

    const n = await countVisiblePages(env.CONTENT_DB, 'echoes', 'song');
    expect(n).toBe(2);
  });
});

describe('widget-stats — computeHistoryTotalWords（D1 整合）', () => {
  beforeEach(async () => {
    await clearPages('history');
  });

  it('metadata.wordCount 存在時走 fast path', async () => {
    await insertPage({
      id: 'history/page-a',
      area: 'history',
      slug: 'page-a',
      pageType: 'page',
      content: [
        { id: 'c', type: 'rich_text', content: '<p>這段文字不會被算</p>' },
      ],
      metadata: { wordCount: 999 },
    });

    const total = await computeHistoryTotalWords(env.CONTENT_DB);
    expect(total).toBe(999);
  });

  it('無 metadata.wordCount 時 fallback 到解析 content', async () => {
    await insertPage({
      id: 'history/page-b',
      area: 'history',
      slug: 'page-b',
      pageType: 'page',
      content: [
        { id: 'c1', type: 'rich_text', content: '<p>諾薇亞</p>' },
        { id: 'c2', type: 'paragraph', content: '<p>行動中</p>' },
      ],
    });

    const total = await computeHistoryTotalWords(env.CONTENT_DB);
    expect(total).toBe(6); // 諾薇亞 + 行動中
  });

  it('hidden/locked/deleted 頁不計入', async () => {
    await insertPage({
      id: 'history/page-c',
      area: 'history',
      slug: 'page-c',
      pageType: 'page',
      metadata: { wordCount: 100, hidden: true },
    });
    await insertPage({
      id: 'history/page-d',
      area: 'history',
      slug: 'page-d',
      pageType: 'page',
      metadata: { wordCount: 200, locked: true },
    });
    await insertPage({
      id: 'history/page-e',
      area: 'history',
      slug: 'page-e',
      pageType: 'page',
      metadata: { wordCount: 300 },
      deleted: true,
    });
    await insertPage({
      id: 'history/page-f',
      area: 'history',
      slug: 'page-f',
      pageType: 'page',
      metadata: { wordCount: 42 },
    });

    const total = await computeHistoryTotalWords(env.CONTENT_DB);
    expect(total).toBe(42);
  });

  it('chapter/section 等非 page 頁面不計入', async () => {
    await insertPage({
      id: 'history/chapter-x',
      area: 'history',
      slug: 'chapter-x',
      pageType: 'chapter',
      metadata: { wordCount: 500 },
    });

    const total = await computeHistoryTotalWords(env.CONTENT_DB);
    expect(total).toBe(0);
  });
});

describe('widget-stats — fetchUepVisitorCount', () => {
  it('無 URL 直接回 null', async () => {
    const n = await fetchUepVisitorCount(undefined);
    expect(n).toBeNull();
  });

  it('成功回應解析 totalVisitors', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      expect(urlStr).toContain('/api/visitor/count?site=uep');
      return new Response(JSON.stringify({ totalVisitors: 42, site: 'uep' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const n = await fetchUepVisitorCount('https://visitor.example');
      expect(n).toBe(42);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('非 200 回應時回 null（stats 端點不應炸）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500 })) as typeof fetch;
    try {
      const n = await fetchUepVisitorCount('https://visitor.example');
      expect(n).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('網路錯誤時回 null', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    try {
      const n = await fetchUepVisitorCount('https://visitor.example');
      expect(n).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('totalVisitors 非數字時回 null', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ totalVisitors: 'lots' }), {
        status: 200,
      })) as typeof fetch;
    try {
      const n = await fetchUepVisitorCount('https://visitor.example');
      expect(n).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('widget-stats — buildDiscordStats（整合）', () => {
  beforeEach(async () => {
    await clearPages('history');
    await clearPages('echoes');
    await clearPages('visuals');
    await clearPages('storage');
    await clearPages('concepts');
  });

  it('聚合五 zone 統計 + visitor（成功情境）', async () => {
    // Fixtures
    await insertPage({
      id: 'history/hp-1',
      area: 'history',
      slug: 'hp-1',
      pageType: 'page',
      metadata: { wordCount: 1000 },
    });
    await insertPage({
      id: 'echoes/song-1',
      area: 'echoes',
      slug: 'song-1',
      pageType: 'song',
    });
    await insertPage({
      id: 'echoes/song-2',
      area: 'echoes',
      slug: 'song-2',
      pageType: 'song',
    });
    await insertPage({
      id: 'visuals/gal-1',
      area: 'visuals',
      slug: 'gal-1',
      pageType: 'gallery',
    });
    await insertPage({
      id: 'storage/stuff-1',
      area: 'storage',
      slug: 'stuff-1',
      pageType: 'stuff',
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ totalVisitors: 88 }), {
        status: 200,
      })) as typeof fetch;

    try {
      const stats = await buildDiscordStats(
        env.CONTENT_DB,
        'https://visitor.example'
      );
      expect(stats.historyTotalWords).toBe(1000);
      expect(stats.echoesSongCount).toBe(2);
      expect(stats.visualsGalleryCount).toBe(1);
      expect(stats.storageExtraCount).toBe(1);
      expect(typeof stats.conceptsEntityCount).toBe('number');
      expect(stats.uepVisitorCount).toBe(88);
      expect(stats.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('visitor fetch 失敗時 uepVisitorCount=null 但整體仍正常', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('gone');
    }) as typeof fetch;

    try {
      const stats = await buildDiscordStats(env.CONTENT_DB, undefined);
      expect(stats.uepVisitorCount).toBeNull();
      expect(stats.historyTotalWords).toBe(0);
      expect(stats.echoesSongCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Content API — GET /api/widget/discord-stats（端點）', () => {
  it('回傳 200 + Cache-Control max-age=300 + 完整 stats payload', async () => {
    const worker = (await import('../index')).default;

    // 用 monkey-patch fetch 避免真的打 visitor Worker
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      if (urlStr.includes('/api/visitor/count')) {
        return new Response(JSON.stringify({ totalVisitors: 7 }), {
          status: 200,
        });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const req = new Request('http://localhost/api/widget/discord-stats', {
        method: 'GET',
        headers: { Origin: 'http://localhost:4321' },
      });
      const res = await worker.fetch(req, env, {
        waitUntil: () => {},
        passThroughOnException: () => {},
        props: {},
      } as ExecutionContext);

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toContain('max-age=300');
      const json = (await res.json()) as {
        ok: boolean;
        data: {
          historyTotalWords: number;
          echoesSongCount: number;
          visualsGalleryCount: number;
          conceptsEntityCount: number;
          storageExtraCount: number;
          uepVisitorCount: number | null;
          generatedAt: string;
        };
      };
      expect(json.ok).toBe(true);
      expect(typeof json.data.historyTotalWords).toBe('number');
      expect(typeof json.data.echoesSongCount).toBe('number');
      expect(typeof json.data.visualsGalleryCount).toBe('number');
      expect(typeof json.data.conceptsEntityCount).toBe('number');
      expect(typeof json.data.storageExtraCount).toBe('number');
      expect(json.data.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
