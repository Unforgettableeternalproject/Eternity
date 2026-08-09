import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../index';
import {
  accountKey,
  checkLoginThrottle,
  purgeExpiredThrottleBuckets,
} from '../uep-throttle';

/**
 * 讀者認證節流（register / login）
 *
 * 原本只有「失敗時 setTimeout 200ms」，並行請求各睡各的，形同虛設。
 * 這組測試鎖住兩件事：計數是原子的（並行也擋得住），以及 IP／帳號兩個
 * 維度各自獨立生效。
 */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as ExecutionContext;

function authRequest(path: string, body: unknown, ip?: string): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Origin: 'http://localhost:4321',
  });
  if (ip) headers.set('CF-Connecting-IP', ip);
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function login(username: string, password: string, ip?: string) {
  return worker.fetch(
    authRequest('/api/uep/auth/login', { username, password }, ip),
    env,
    ctx
  );
}

function register(username: string, ip?: string) {
  return worker.fetch(
    authRequest(
      '/api/uep/auth/register',
      { username, password: 'test-password-123' },
      ip
    ),
    env,
    ctx
  );
}

beforeEach(async () => {
  await env.CONTENT_DB.prepare('DELETE FROM uep_auth_throttle').run();
});

describe('登入節流：帳號維度', () => {
  it('連續失敗達上限後鎖定，回 429 並帶 Retry-After', async () => {
    const user = 'throttle-victim';
    // 前 5 次是正常的憑證錯誤
    for (let i = 0; i < 5; i++) {
      const res = await login(user, 'wrong-password');
      expect(res.status).toBe(401);
    }
    const blocked = await login(user, 'wrong-password');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('鎖定期間即使密碼正確也不放行', async () => {
    const user = 'throttle-locked';
    const password = 'test-password-123';
    expect((await register(user)).status).toBe(201);

    for (let i = 0; i < 6; i++) await login(user, 'wrong-password');

    const res = await login(user, password);
    expect(res.status).toBe(429);
  });

  it('帳號桶大小寫不敏感——換大小寫繞不過去', async () => {
    for (let i = 0; i < 6; i++) await login('CaseUser', 'wrong-password');
    const res = await login('caseuser', 'wrong-password');
    expect(res.status).toBe(429);
  });

  it('不同帳號各自計數，不會互相牽連', async () => {
    for (let i = 0; i < 6; i++) await login('victim-a', 'wrong-password');
    const other = await login('victim-b', 'wrong-password');
    expect(other.status).toBe(401);
  });

  it('登入成功會清掉該帳號的失敗累計', async () => {
    const user = 'throttle-recover';
    const password = 'test-password-123';
    expect((await register(user)).status).toBe(201);

    for (let i = 0; i < 3; i++) await login(user, 'wrong-password');
    expect((await login(user, password)).status).toBe(200);

    const row = await env.CONTENT_DB.prepare(
      'SELECT count FROM uep_auth_throttle WHERE bucket_key = ?'
    )
      .bind(accountKey(user))
      .first<{ count: number }>();
    expect(row).toBeNull();
  });

  it('並行請求也擋得住——計數先寫再判斷，不是 read-then-write', async () => {
    const user = 'throttle-parallel';
    const results = await Promise.all(
      Array.from({ length: 12 }, () => login(user, 'wrong-password'))
    );
    const limited = results.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
  });
});

describe('登入節流：IP 維度', () => {
  /* 這兩個案例都要打滿 30 次以上才碰得到 IP 上限。序列跑的話每次失敗登入
     都有一段固定延遲（防 timing 洩漏帳號存在性），加起來會超過測試逾時，
     所以改用並行——那也正是這道防線真正要擋的形狀。 */
  it('同一 IP 打不同帳號一樣會被擋', async () => {
    const ip = '203_0_113_7';
    // 每次換帳號，帳號維度永遠不會觸發，只剩 IP 維度擋
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        login(`ip-probe-${i}`, 'wrong-password', ip)
      )
    );
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThan(0);
  });

  it('沒有 CF-Connecting-IP 時跳過 IP 維度（本機 dev 不會鎖死自己）', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        login(`local-probe-${i}`, 'wrong-password')
      )
    );
    expect(results.every((r) => r.status === 401)).toBe(true);
  });
});

describe('註冊節流', () => {
  it('同一 IP 超過上限後回 429', async () => {
    const ip = '198_51_100_9';
    for (let i = 0; i < 5; i++) {
      expect((await register(`flood-${i}`, ip)).status).toBe(201);
    }
    const res = await register('flood-blocked', ip);
    expect(res.status).toBe(429);
  });

  it('不同 IP 各自計數', async () => {
    for (let i = 0; i < 6; i++) await register(`flood-a-${i}`, '198_51_100_1');
    const res = await register('flood-b-1', '198_51_100_2');
    expect(res.status).toBe(201);
  });
});

describe('節流桶清理', () => {
  it('窗口過期且未鎖定的桶會被 cron 清掉，鎖定中的保留', async () => {
    const now = Math.floor(Date.now() / 1000);
    const stale = now - 48 * 3600;
    await env.CONTENT_DB.prepare(
      'INSERT INTO uep_auth_throttle (bucket_key, count, window_start, locked_until) VALUES (?, 1, ?, NULL)'
    )
      .bind('user:stale', stale)
      .run();
    await env.CONTENT_DB.prepare(
      'INSERT INTO uep_auth_throttle (bucket_key, count, window_start, locked_until) VALUES (?, 9, ?, ?)'
    )
      .bind('user:still-locked', stale, now + 600)
      .run();

    const purged = await purgeExpiredThrottleBuckets(env, now);
    expect(purged).toBe(1);

    const remaining = await env.CONTENT_DB.prepare(
      'SELECT bucket_key FROM uep_auth_throttle'
    ).all<{ bucket_key: string }>();
    expect(remaining.results?.map((r) => r.bucket_key)).toEqual([
      'user:still-locked',
    ]);
  });

  it('窗口過期後計數重置，鎖定一併解除', async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.CONTENT_DB.prepare(
      'INSERT INTO uep_auth_throttle (bucket_key, count, window_start, locked_until) VALUES (?, 99, ?, ?)'
    )
      .bind(accountKey('expired-lock'), now - 5000, now - 100)
      .run();

    const verdict = await checkLoginThrottle(
      env.CONTENT_DB,
      null,
      'expired-lock',
      now
    );
    expect(verdict.limited).toBe(false);
  });
});
