import { describe, expect, it } from 'vitest';
import worker, {
  buildDiscordProfilePayload,
  mapStatsToDynamicFields,
  syncDiscordWidget,
} from './index';

interface JsonResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const testEnv = {
  STATS_API_URL: 'https://stats.example/api/widget/discord-stats',
  DISCORD_API_BASE: 'https://discord.example/api/v9',
  DISCORD_APP_ID: 'app-123',
  DISCORD_USER_ID: 'user-456',
  DISCORD_IDENTITY_ID: '0',
  DISCORD_WIDGET_USERNAME: 'U.E.P',
  DISCORD_BOT_TOKEN: 'bot-token',
  SYNC_API_TOKEN: 'sync-token',
  DISCORD_WIDGET_SYNC_ENABLED: 'true',
};

const statsPayload = {
  ok: true,
  data: {
    historyTotalWords: 12345,
    echoesSongCount: 12,
    visualsGalleryCount: 34,
    conceptsEntityCount: 56,
    storageExtraCount: 7,
    uepVisitorCount: null,
    generatedAt: '2026-07-07T00:00:00.000Z',
  },
};

function makeCtx(): ExecutionContext {
  return {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    props: {},
  } as ExecutionContext;
}

describe('Discord widget sync — payload mapping', () => {
  it('maps content-api stats into Discord dynamic fields', () => {
    const fields = mapStatsToDynamicFields(statsPayload.data);

    expect(fields).toEqual([
      { type: 2, name: 'history_total_words', value: 12345 },
      { type: 2, name: 'echoes_song_count', value: 12 },
      { type: 2, name: 'visuals_gallery_count', value: 34 },
      { type: 2, name: 'concepts_entity_count', value: 56 },
      { type: 2, name: 'storage_extra_count', value: 7 },
      { type: 2, name: 'uep_visitor_count', value: 0 },
    ]);
  });

  it('wraps dynamic fields in the Discord profile payload shape', () => {
    const payload = buildDiscordProfilePayload(statsPayload.data, 'U.E.P');

    expect(payload.username).toBe('U.E.P');
    expect(payload.data.dynamic[0]).toEqual({
      type: 2,
      name: 'history_total_words',
      value: 12345,
    });
  });
});

describe('Discord widget sync — syncDiscordWidget', () => {
  it('uses service binding for stats when CONTENT_API is available', async () => {
    const contentApiRequests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (
        url ===
        'https://discord.example/api/v9/applications/app-123/users/user-456/identities/0/profile'
      ) {
        return Response.json({ ok: true });
      }
      return new Response('unexpected global fetch', { status: 500 });
    }) as typeof fetch;

    const contentApi = {
      fetch: async (request: Request) => {
        contentApiRequests.push(request.url);
        return Response.json(statsPayload);
      },
    } as Fetcher;

    try {
      const result = await syncDiscordWidget({
        ...testEnv,
        CONTENT_API: contentApi,
      });

      expect(result.ok).toBe(true);
      expect(result.synced).toBe(true);
      expect(contentApiRequests).toEqual([
        'https://content-api.internal/api/widget/discord-stats',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it('fetches stats and PATCHes Discord profile endpoint', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = input.toString();
      calls.push({ input: url, init });
      if (url === 'https://stats.example/api/widget/discord-stats') {
        return Response.json(statsPayload);
      }
      if (
        url ===
        'https://discord.example/api/v9/applications/app-123/users/user-456/identities/0/profile'
      ) {
        expect(init?.method).toBe('PATCH');
        const headers = new Headers(init?.headers);
        expect(headers.get('Authorization')).toBe('Bot bot-token');
        expect(headers.get('Content-Type')).toBe('application/json');
        const payload = JSON.parse(String(init?.body));
        expect(payload.username).toBe('U.E.P');
        expect(payload.data.dynamic).toContainEqual({
          type: 2,
          name: 'history_total_words',
          value: 12345,
        });
        expect(payload.data.dynamic).toHaveLength(6);
        return Response.json({ ok: true });
      }
      return new Response('unexpected url', { status: 500 });
    }) as typeof fetch;

    try {
      const result = await syncDiscordWidget(testEnv);

      expect(result.ok).toBe(true);
      expect(result.synced).toBe(true);
      expect(calls.map((c) => c.input)).toEqual([
        'https://stats.example/api/widget/discord-stats',
        'https://discord.example/api/v9/applications/app-123/users/user-456/identities/0/profile',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns disabled without PATCH when sync flag is not true', async () => {
    const result = await syncDiscordWidget({
      ...testEnv,
      DISCORD_WIDGET_SYNC_ENABLED: 'false',
    });

    expect(result).toEqual({ ok: true, synced: false, reason: 'disabled' });
  });
});

describe('Discord widget sync — manual endpoint', () => {
  it('rejects POST /api/sync without bearer token', async () => {
    const res = await worker.fetch(
      new Request('https://worker.example/api/sync', { method: 'POST' }),
      testEnv,
      makeCtx()
    );

    expect(res.status).toBe(401);
  });

  it('returns protected stats fetch diagnostics from POST /api/debug', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === 'https://stats.example/api/widget/discord-stats') {
        return Response.json(statsPayload);
      }
      return new Response('unexpected url', { status: 500 });
    }) as typeof fetch;

    try {
      const res = await worker.fetch(
        new Request('https://worker.example/api/debug', {
          method: 'POST',
          headers: { Authorization: 'Bearer sync-token' },
        }),
        testEnv,
        makeCtx()
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as JsonResponse<{
        statsUrl: string;
        status: number;
        ok: boolean;
      }>;
      expect(json.ok).toBe(true);
      expect(json.data).toMatchObject({
        statsUrl: 'https://stats.example/api/widget/discord-stats',
        status: 200,
        ok: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it('runs sync from POST /api/sync with bearer token', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === 'https://stats.example/api/widget/discord-stats') {
        return Response.json(statsPayload);
      }
      return Response.json({ ok: true });
    }) as typeof fetch;

    try {
      const res = await worker.fetch(
        new Request('https://worker.example/api/sync', {
          method: 'POST',
          headers: { Authorization: 'Bearer sync-token' },
        }),
        testEnv,
        makeCtx()
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as JsonResponse<{ synced: boolean }>;
      expect(json.ok).toBe(true);
      expect(json.data?.synced).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('forces manual sync even when scheduled sync is disabled', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      calls.push(url);
      if (url === 'https://stats.example/api/widget/discord-stats') {
        return Response.json(statsPayload);
      }
      return Response.json({ ok: true });
    }) as typeof fetch;

    try {
      const res = await worker.fetch(
        new Request('https://worker.example/api/sync', {
          method: 'POST',
          headers: { Authorization: 'Bearer sync-token' },
        }),
        { ...testEnv, DISCORD_WIDGET_SYNC_ENABLED: 'false' },
        makeCtx()
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as JsonResponse<{ synced: boolean }>;
      expect(json.ok).toBe(true);
      expect(json.data?.synced).toBe(true);
      expect(calls).toContain(
        'https://discord.example/api/v9/applications/app-123/users/user-456/identities/0/profile'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
