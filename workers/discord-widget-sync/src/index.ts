export interface Env {
  STATS_API_URL?: string;
  DISCORD_API_BASE?: string;
  DISCORD_APP_ID?: string;
  DISCORD_USER_ID?: string;
  DISCORD_IDENTITY_ID?: string;
  DISCORD_WIDGET_USERNAME?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_WIDGET_SYNC_ENABLED?: string;
  SYNC_API_TOKEN?: string;
  CONTENT_API?: Fetcher;
}

export interface DiscordWidgetStats {
  historyTotalWords: number;
  echoesSongCount: number;
  visualsGalleryCount: number;
  conceptsEntityCount: number;
  storageExtraCount: number;
  uepVisitorCount: number | null;
  generatedAt: string;
}

export interface DiscordDynamicNumberField {
  type: 2;
  name: string;
  value: number;
}

export interface DiscordProfilePayload {
  username: string;
  data: {
    dynamic: DiscordDynamicNumberField[];
  };
}

export interface SyncResult {
  ok: boolean;
  synced: boolean;
  reason?: string;
  discordStatus?: number;
  generatedAt?: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cleanBaseUrl(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/\/+$/, '');
}

function requireEnv(env: Env, key: keyof Env): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

function asNonNegativeInteger(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function mapStatsToDynamicFields(
  stats: DiscordWidgetStats
): DiscordDynamicNumberField[] {
  return [
    {
      type: 2,
      name: 'history_total_words',
      value: asNonNegativeInteger(stats.historyTotalWords),
    },
    {
      type: 2,
      name: 'echoes_song_count',
      value: asNonNegativeInteger(stats.echoesSongCount),
    },
    {
      type: 2,
      name: 'visuals_gallery_count',
      value: asNonNegativeInteger(stats.visualsGalleryCount),
    },
    {
      type: 2,
      name: 'concepts_entity_count',
      value: asNonNegativeInteger(stats.conceptsEntityCount),
    },
    {
      type: 2,
      name: 'storage_extra_count',
      value: asNonNegativeInteger(stats.storageExtraCount),
    },
    {
      type: 2,
      name: 'uep_visitor_count',
      value: asNonNegativeInteger(stats.uepVisitorCount),
    },
  ];
}

function statsRequest(): Request {
  return new Request('https://content-api.internal/api/widget/discord-stats', {
    headers: { Accept: 'application/json' },
  });
}

async function fetchStatsResponse(env: Env): Promise<Response> {
  if (env.CONTENT_API) {
    return env.CONTENT_API.fetch(statsRequest());
  }

  const statsUrl = requireEnv(env, 'STATS_API_URL');
  return fetch(statsUrl, {
    headers: { Accept: 'application/json' },
  });
}
export function buildDiscordProfilePayload(
  stats: DiscordWidgetStats,
  username = 'U.E.P'
): DiscordProfilePayload {
  return {
    username,
    data: {
      dynamic: mapStatsToDynamicFields(stats),
    },
  };
}

async function fetchStats(env: Env): Promise<DiscordWidgetStats> {
  const res = await fetchStatsResponse(env);
  if (!res.ok) {
    throw new Error(`Stats API failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as {
    ok?: boolean;
    data?: DiscordWidgetStats;
    error?: string;
  };
  if (!json.ok || !json.data) {
    throw new Error(json.error || 'Stats API returned an invalid payload');
  }
  return json.data;
}

async function debugStatsFetch(env: Env): Promise<unknown> {
  const statsUrl = env.STATS_API_URL || '/api/widget/discord-stats';
  const source = env.CONTENT_API ? 'service-binding' : 'fetch';
  const res = await fetchStatsResponse(env);
  const body = await res.text();

  return {
    statsUrl,
    source,
    status: res.status,
    ok: res.ok,
    bodyPreview: body.slice(0, 500),
  };
}
async function patchDiscordProfile(
  env: Env,
  payload: DiscordProfilePayload
): Promise<number> {
  const appId = requireEnv(env, 'DISCORD_APP_ID');
  const userId = requireEnv(env, 'DISCORD_USER_ID');
  const token = requireEnv(env, 'DISCORD_BOT_TOKEN');
  const identityId = env.DISCORD_IDENTITY_ID || '0';
  const apiBase = cleanBaseUrl(
    env.DISCORD_API_BASE,
    'https://discord.com/api/v9'
  );
  const url = `${apiBase}/applications/${appId}/users/${userId}/identities/${identityId}/profile`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      'User-Agent':
        'DiscordBot (https://unforgettableeternalproject.com, 1.0.0)',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Discord PATCH failed: ${res.status} ${await res.text()}`);
  }
  return res.status;
}

export async function syncDiscordWidget(
  env: Env,
  options: { force?: boolean } = {}
): Promise<SyncResult> {
  if (!options.force && env.DISCORD_WIDGET_SYNC_ENABLED !== 'true') {
    return { ok: true, synced: false, reason: 'disabled' };
  }

  const stats = await fetchStats(env);
  const payload = buildDiscordProfilePayload(
    stats,
    env.DISCORD_WIDGET_USERNAME || 'U.E.P'
  );
  const discordStatus = await patchDiscordProfile(env, payload);

  return {
    ok: true,
    synced: true,
    discordStatus,
    generatedAt: stats.generatedAt,
  };
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.SYNC_API_TOKEN) return false;
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.SYNC_API_TOKEN}`;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx?: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        },
      });
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return jsonResponse({
        ok: true,
        data: { service: 'discord-widget-sync' },
      });
    }

    if (url.pathname === '/api/debug' && request.method === 'POST') {
      if (!isAuthorized(request, env)) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
      }
      try {
        const result = await debugStatsFetch(env);
        return jsonResponse({ ok: true, data: result });
      } catch (err) {
        return jsonResponse(
          {
            ok: false,
            error: err instanceof Error ? err.message : 'Debug failed',
          },
          500
        );
      }
    }

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      if (!isAuthorized(request, env)) {
        return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
      }
      try {
        const result = await syncDiscordWidget(env, { force: true });
        return jsonResponse({ ok: true, data: result });
      } catch (err) {
        return jsonResponse(
          {
            ok: false,
            error: err instanceof Error ? err.message : 'Sync failed',
          },
          500
        );
      }
    }

    return jsonResponse({ ok: false, error: 'Not found' }, 404);
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      syncDiscordWidget(env).catch((err) => {
        console.error('[discord-widget-sync] scheduled sync failed', err);
      })
    );
  },
};
