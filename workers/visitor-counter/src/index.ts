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
      // 獲取總訪客數
      const data = await env.VISITOR_STATS.get<VisitorData>(
        'visitor-data',
        'json'
      );
      const totalVisitors = data?.totalVisitors || 0;

      return new Response(JSON.stringify({ totalVisitors }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    if (url.pathname === '/api/visitor/track' && request.method === 'POST') {
      // 追蹤新訪客（使用簡單指紋識別）
      const fingerprint = generateFingerprint(request);
      const visitorKey = `visitor:${fingerprint}`;

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
          'visitor-data',
          'json'
        )) || {
          totalVisitors: 0,
          lastVisitTimestamp: now,
        };

        data.totalVisitors += 1;
        data.lastVisitTimestamp = now;

        // 儲存更新後的數據
        await env.VISITOR_STATS.put('visitor-data', JSON.stringify(data));

        // 記錄訪客指紋（保存 30 天）
        await env.VISITOR_STATS.put(visitorKey, now.toString(), {
          expirationTtl: 60 * 60 * 24 * 30, // 30 天
        });

        return new Response(
          JSON.stringify({
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
        const data = await env.VISITOR_STATS.get<VisitorData>(
          'visitor-data',
          'json'
        );
        return new Response(
          JSON.stringify({
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
        'visitor-data',
        JSON.stringify({
          totalVisitors: resetTo,
          lastVisitTimestamp: now,
        })
      );

      return new Response(
        JSON.stringify({ ok: true, totalVisitors: resetTo }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 404
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
