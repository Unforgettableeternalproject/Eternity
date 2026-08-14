/**
 * 讀者認證節流（/api/uep/auth/register、/api/uep/auth/login）
 *
 * 取代原本「失敗時 setTimeout 200ms」的作法——那個延遲只拖慢單一連線，
 * 並行發出的請求各睡各的，字典攻擊完全不受影響；公開註冊更是連上限都沒有。
 *
 * 兩個維度同時生效：
 * - IP 維度：擋單一來源的洪水（含註冊灌庫）
 * - 帳號維度：擋分散 IP 對同一帳號的密碼嘗試，連續失敗達門檻即鎖定
 *
 * ⚠️ **先計數再判斷**，不可改成「先查詢，超限才不寫」。D1 的 read-then-write
 * 在並行下會讓 N 個同時到達的請求各自讀到同一個舊值、全部放行——那正是原本
 * 200ms 延遲失效的同一個原因。這裡的遞增與取值合併成單一 UPSERT ... RETURNING，
 * 由 D1 保證原子性。
 */

import type { Env } from './types';

/** 節流桶的一次計數結果 */
export interface ThrottleBucket {
  count: number;
  windowStart: number;
  lockedUntil: number | null;
}

/** 節流判定結果——`retryAfter` 為建議的 Retry-After 秒數 */
export interface ThrottleVerdict {
  limited: boolean;
  retryAfter: number;
  /** 觸發的桶，寫 log 用（不回給客戶端，避免洩漏是哪個維度擋的） */
  reason?: 'ip' | 'account';
}

/** 登入：同一 IP 的窗口長度與嘗試上限 */
const LOGIN_IP_WINDOW = 900; // 15 分鐘
const LOGIN_IP_LIMIT = 30;

/** 登入：同一帳號的窗口長度、連續失敗上限與鎖定時間 */
const LOGIN_ACCOUNT_WINDOW = 900;
const LOGIN_ACCOUNT_LIMIT = 5;
const LOGIN_ACCOUNT_LOCK = 900;

/** 註冊：同一 IP 的窗口長度與上限（比登入嚴，正常人不會連開帳號） */
const REGISTER_IP_WINDOW = 3600; // 1 小時
const REGISTER_IP_LIMIT = 5;

/** 過期桶的保留時間——cron 清理超過此秒數未更新的紀錄 */
const BUCKET_TTL = 24 * 3600;

/**
 * 取得請求來源 IP。
 *
 * 正式環境一定有 `CF-Connecting-IP`（Cloudflare 自己蓋的，客戶端偽造不了）。
 * 本機 wrangler dev 沒有——此時回 null，IP 維度整個跳過，否則本機所有請求
 * 會共用同一個桶，開發時試幾次就被自己鎖住。帳號維度不受影響。
 */
export function clientIp(request: Request): string | null {
  const ip = request.headers.get('CF-Connecting-IP');
  return ip && ip.trim() ? ip.trim() : null;
}

/** 節流表可能還沒 migrate（0027）——缺表時一律放行，不讓認證整個掛掉 */
function isMissingTable(err: unknown): boolean {
  return (
    err instanceof Error &&
    /no such table: uep_auth_throttle/i.test(err.message)
  );
}

/**
 * 原子地遞增一個桶並回傳遞增後的狀態。
 * 窗口過期時 count 重置為 1、window_start 換新，鎖定則一併解除。
 */
async function bump(
  db: D1Database,
  key: string,
  windowSec: number,
  now: number
): Promise<ThrottleBucket | null> {
  const expiry = now - windowSec;
  try {
    const row = await db
      .prepare(
        `INSERT INTO uep_auth_throttle (bucket_key, count, window_start, locked_until)
         VALUES (?1, 1, ?2, NULL)
         ON CONFLICT(bucket_key) DO UPDATE SET
           count = CASE WHEN window_start < ?3 THEN 1 ELSE count + 1 END,
           window_start = CASE WHEN window_start < ?3 THEN ?2 ELSE window_start END,
           locked_until = CASE
             WHEN locked_until IS NOT NULL AND locked_until > ?2 THEN locked_until
             ELSE NULL
           END
         RETURNING count, window_start, locked_until`
      )
      .bind(key, now, expiry)
      .first<{
        count: number;
        window_start: number;
        locked_until: number | null;
      }>();
    if (!row) return null;
    return {
      count: row.count,
      windowStart: row.window_start,
      lockedUntil: row.locked_until,
    };
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** 鎖定一個桶到指定時間 */
async function lock(db: D1Database, key: string, until: number): Promise<void> {
  try {
    await db
      .prepare(
        'UPDATE uep_auth_throttle SET locked_until = ? WHERE bucket_key = ?'
      )
      .bind(until, key)
      .run();
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
}

/** 清除一個桶（登入成功後解除該帳號的失敗累計） */
export async function clearBucket(db: D1Database, key: string): Promise<void> {
  try {
    await db
      .prepare('DELETE FROM uep_auth_throttle WHERE bucket_key = ?')
      .bind(key)
      .run();
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
}

/** 帳號維度的桶鍵——大小寫不敏感，與 username 的 COLLATE NOCASE 對齊 */
export function accountKey(identifier: string): string {
  return `user:${identifier.trim().toLowerCase()}`;
}

/**
 * 登入前的節流檢查。呼叫即計入一次嘗試。
 *
 * 帳號維度在超過上限時直接鎖定，鎖定期間即使密碼正確也不放行——這是刻意的：
 * 攻擊進行中時，正確密碼多半也代表攻擊者已經猜到了。
 */
export async function checkLoginThrottle(
  db: D1Database,
  ip: string | null,
  identifier: string,
  now = Math.floor(Date.now() / 1000)
): Promise<ThrottleVerdict> {
  if (ip) {
    const bucket = await bump(db, `ip:${ip}:login`, LOGIN_IP_WINDOW, now);
    if (bucket && bucket.count > LOGIN_IP_LIMIT) {
      return {
        limited: true,
        retryAfter: Math.max(1, bucket.windowStart + LOGIN_IP_WINDOW - now),
        reason: 'ip',
      };
    }
  }

  if (!identifier) return { limited: false, retryAfter: 0 };

  const key = accountKey(identifier);
  const bucket = await bump(db, key, LOGIN_ACCOUNT_WINDOW, now);
  if (!bucket) return { limited: false, retryAfter: 0 };

  if (bucket.lockedUntil && bucket.lockedUntil > now) {
    return {
      limited: true,
      retryAfter: bucket.lockedUntil - now,
      reason: 'account',
    };
  }
  if (bucket.count > LOGIN_ACCOUNT_LIMIT) {
    const until = now + LOGIN_ACCOUNT_LOCK;
    await lock(db, key, until);
    return { limited: true, retryAfter: LOGIN_ACCOUNT_LOCK, reason: 'account' };
  }
  return { limited: false, retryAfter: 0 };
}

/** 註冊前的節流檢查（只有 IP 維度——帳號還不存在） */
export async function checkRegisterThrottle(
  db: D1Database,
  ip: string | null,
  now = Math.floor(Date.now() / 1000)
): Promise<ThrottleVerdict> {
  if (!ip) return { limited: false, retryAfter: 0 };
  const bucket = await bump(db, `ip:${ip}:register`, REGISTER_IP_WINDOW, now);
  if (bucket && bucket.count > REGISTER_IP_LIMIT) {
    return {
      limited: true,
      retryAfter: Math.max(1, bucket.windowStart + REGISTER_IP_WINDOW - now),
      reason: 'ip',
    };
  }
  return { limited: false, retryAfter: 0 };
}

/** cron 清理：移除窗口早已過期的桶（鎖定中的保留） */
export async function purgeExpiredThrottleBuckets(
  env: Env,
  now = Math.floor(Date.now() / 1000)
): Promise<number> {
  try {
    const result = await env.CONTENT_DB.prepare(
      `DELETE FROM uep_auth_throttle
       WHERE window_start < ?1 AND (locked_until IS NULL OR locked_until < ?2)`
    )
      .bind(now - BUCKET_TTL, now)
      .run();
    return result.meta?.changes ?? 0;
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}
