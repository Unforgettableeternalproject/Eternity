export interface Env {
  VISITOR_STATS: KVNamespace;
  ALLOWED_ORIGINS: string;
}

interface VisitorData {
  totalVisitors: number;
  lastVisitTimestamp: number;
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

    // CORS 處理
    const allowedOrigins = env.ALLOWED_ORIGINS?.split(',') || [];
    const origin = request.headers.get('Origin') || '';

    const corsHeaders: Record<string, string> = {};
    if (allowedOrigins.includes(origin)) {
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

    // 404
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
