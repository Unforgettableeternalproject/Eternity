export interface Env {
  VISITOR_STATS: KVNamespace;
  ALLOWED_ORIGINS: string;
  /** 管理用靜態 Token（腳本用，wrangler secret put API_TOKEN） */
  API_TOKEN?: string;
  /** JWT Secret（與 content-api 共用，讓 admin 編輯器的 JWT 也能驗證） */
  JWT_SECRET?: string;
}

interface VisitorData {
  totalVisitors: number;
  lastVisitTimestamp: number;
}

/** 支援的分站。無參數視同 root，讓舊 KV key（visitor-data）保持相容。 */
type SiteKey = 'root' | 'uep';

/**
 * 從 query 解析分站；未指定或非法值 → 'root'。
 * 這個預設值讓所有舊 client（不帶 ?site）直接落到 root 桶，與升級前一致。
 */
function parseSite(url: URL): SiteKey {
  const raw = url.searchParams.get('site');
  if (raw === 'uep') return 'uep';
  return 'root';
}

/**
 * 統計資料的 KV key。
 * - root（含無參數）：'visitor-data' — 沿用舊 key，繼承歷史計數
 * - uep：'visitor-data:uep' — 全新獨立桶
 */
function statsKey(site: SiteKey): string {
  return site === 'root' ? 'visitor-data' : `visitor-data:${site}`;
}

/**
 * 訪客指紋 KV key。
 * - root（含無參數）：'visitor:{fp}' — 沿用舊 key
 * - uep：'visitor:uep:{fp}' — 獨立命名空間，避免與 root 撞 fingerprint 造成互相封鎖
 */
function fingerprintKey(site: SiteKey, fingerprint: string): string {
  return site === 'root'
    ? `visitor:${fingerprint}`
    : `visitor:${site}:${fingerprint}`;
}

/** 簡易 JWT 驗證（只驗簽章，不檢查 exp 等 claims） */
async function verifyJwt(token: string, secret: string): Promise<boolean> {
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    if (!headerB64 || !payloadB64 || !sigB64) return false;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Base64url → Uint8Array
    const sig = Uint8Array.from(
      atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0)
    );

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    return await crypto.subtle.verify('HMAC', key, sig, data);
  } catch {
    return false;
  }
}

// 簡單的指紋識別（基於 IP + User Agent）
function generateFingerprint(request: Request): string {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';
  return `${ip}-${userAgent}`;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // CORS 處理 - 支援通配符匹配
    const allowedOrigins = env.ALLOWED_ORIGINS?.split(',') || [];
    const origin = request.headers.get('Origin') || '';

    const corsHeaders: Record<string, string> = {};

    // 檢查來源是否允許（支援 *.pages.dev 通配符）
    const isAllowed = allowedOrigins.some((allowed) => {
      // 去除空白
      allowed = allowed.trim();

      // 完全匹配
      if (allowed === origin) return true;

      // 通配符匹配：https://*.eternity-8v7.pages.dev
      if (allowed.includes('*.')) {
        // 提取 *.之後的部分，例如：eternity-8v7.pages.dev
        const domain = allowed.split('*.')[1];
        // 檢查 origin 是否以這個域名結尾
        return origin.endsWith(domain);
      }

      return false;
    });

    if (isAllowed) {
      corsHeaders['Access-Control-Allow-Origin'] = origin;
      corsHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type';
    }

    // 處理 OPTIONS 預檢請求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 路由處理
    if (url.pathname === '/api/visitor/count' && request.method === 'GET') {
      // 獲取總訪客數（依 site 分桶；無參數=root，沿用舊 key）
      const site = parseSite(url);
      const data = await env.VISITOR_STATS.get<VisitorData>(
        statsKey(site),
        'json'
      );
      const totalVisitors = data?.totalVisitors || 0;

      return new Response(JSON.stringify({ site, totalVisitors }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    if (url.pathname === '/api/visitor/track' && request.method === 'POST') {
      // 追蹤新訪客（使用簡單指紋識別，依 site 分桶）
      const site = parseSite(url);
      const fingerprint = generateFingerprint(request);
      const visitorKey = fingerprintKey(site, fingerprint);
      const dataKey = statsKey(site);

      // 檢查這個訪客是否已經訪問過（24小時內）
      const lastVisit = await env.VISITOR_STATS.get(visitorKey);
      const now = Date.now();

      let shouldCount = false;

      if (!lastVisit) {
        // 新訪客
        shouldCount = true;
      } else {
        // 檢查上次訪問時間，超過 24 小時才重新計數
        const lastVisitTime = parseInt(lastVisit);
        const hoursSinceLastVisit = (now - lastVisitTime) / (1000 * 60 * 60);

        if (hoursSinceLastVisit >= 24) {
          shouldCount = true;
        }
      }

      if (shouldCount) {
        // 更新總訪客數
        const data = (await env.VISITOR_STATS.get<VisitorData>(
          dataKey,
          'json'
        )) || {
          totalVisitors: 0,
          lastVisitTimestamp: now,
        };

        data.totalVisitors += 1;
        data.lastVisitTimestamp = now;

        // 儲存更新後的數據
        await env.VISITOR_STATS.put(dataKey, JSON.stringify(data));

        // 記錄訪客指紋（保存 30 天）
        await env.VISITOR_STATS.put(visitorKey, now.toString(), {
          expirationTtl: 60 * 60 * 24 * 30, // 30 天
        });

        return new Response(
          JSON.stringify({
            site,
            totalVisitors: data.totalVisitors,
            tracked: true,
          }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      } else {
        // 已經計數過的訪客
        const data = await env.VISITOR_STATS.get<VisitorData>(dataKey, 'json');
        return new Response(
          JSON.stringify({
            site,
            totalVisitors: data?.totalVisitors || 0,
            tracked: false,
          }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      }
    }

    // ── 重置計數器（需要驗證：API_TOKEN 或 JWT） ──
    if (url.pathname === '/api/visitor/reset' && request.method === 'POST') {
      // dev mode：兩個 secret 都沒設 → 跳過驗證
      const hasAuth = env.API_TOKEN || env.JWT_SECRET;
      if (hasAuth) {
        const authHeader = request.headers.get('Authorization') || '';
        const bearerToken = authHeader.replace('Bearer ', '');
        let authorized = false;

        // 方式 1：靜態 API_TOKEN（腳本用）
        if (env.API_TOKEN && bearerToken === env.API_TOKEN) {
          authorized = true;
        }

        // 方式 2：JWT 簽章驗證（admin 編輯器用）
        if (!authorized && env.JWT_SECRET && bearerToken) {
          authorized = await verifyJwt(bearerToken, env.JWT_SECRET);
        }

        if (!authorized) {
          return new Response(
            JSON.stringify({ ok: false, error: '驗證失敗' }),
            {
              status: 401,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
              },
            }
          );
        }
      }

      // 依 site 分桶重置（無參數=root，沿用舊行為）
      const site = parseSite(url);
      const dataKey = statsKey(site);

      // 讀取請求 body，支援指定重置值
      let resetTo = 0;
      try {
        const body = (await request.json()) as { value?: number };
        if (typeof body.value === 'number' && body.value >= 0) {
          resetTo = Math.floor(body.value);
        }
      } catch {
        // 沒有 body 或解析失敗 → 重置為 0
      }

      // 重置計數
      const now = Date.now();
      await env.VISITOR_STATS.put(
        dataKey,
        JSON.stringify({
          totalVisitors: resetTo,
          lastVisitTimestamp: now,
        })
      );

      return new Response(
        JSON.stringify({ ok: true, site, totalVisitors: resetTo }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 404
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
