/**
 * migrate-illustration-id-to-story-key.mjs — illustrationId → storyKey（Epic 2 S10-1 段 C）
 *
 * S10-1 引入第二套命名空間 storyKey（Echoes 劇情歌／Visuals 插圖／History
 * echo spot·visual clue 共用），把原本只服務 Visuals 鑲框室的 illustrationId
 * 整個吃掉——不並存、不留相容讀取分支（設計文件 §5-2）。
 *
 * 本腳本負責資料端，與程式碼變更同批次落地，避免「欄位名稱認知空窗」。
 *
 * 兩件事：
 * 1. Visuals gallery 頁 `metadata.illustrationId` → `metadata.storyKey`（值不變）
 * 2. History 頁內容中 visual clue 的 `data-target-type="illustration"` → `"story"`
 *    （`data-target-key` 值不變）
 *
 * 使用方式：
 *   node scripts/archive/migrate-illustration-id-to-story-key.mjs            # dry-run（本地）
 *   node scripts/archive/migrate-illustration-id-to-story-key.mjs --write    # 實際寫入（本地）
 *   node scripts/archive/migrate-illustration-id-to-story-key.mjs --remote --write
 *   node scripts/archive/migrate-illustration-id-to-story-key.mjs --test --write
 *   API_TOKEN=xxx node scripts/archive/migrate-illustration-id-to-story-key.mjs --remote --write
 *
 * 對 remote／test 寫入需要授權：未設 `API_TOKEN` 環境變數時會互動式登入
 * 取 admin JWT（同 `pnpm sync`，見 sync-auth.mjs 的 resolveWriteToken）。
 * 本地 dev worker 無需授權，不會問。
 *
 * **預設 dry-run**——寫入需明確帶 `--write`。比照 reset-test-env.mjs 的
 * `--confirm` 精神：資料改寫類腳本不該因為手滑執行就動到東西。
 *
 * 2026-07-26 實測範圍：正式 D1 有 0 筆 gallery 帶 illustrationId、
 * 測試 D1 有 1 筆（`visuals/illustrations/era_u/測試畫廊` → `test-id`）。
 * History clue 視各環境當下的測試資料而定。
 */

import { resolveWriteToken } from '../sync-auth.mjs';

const USE_REMOTE = process.argv.includes('--remote');
const USE_TEST = process.argv.includes('--test');
const WRITE = process.argv.includes('--write');

// 登入取得 admin JWT 的對象。test D1 沒有 admin_users，只能向正式登入——
// 兩邊共用同一組 JWT_SECRET，正式簽發的 token 打 test worker 驗得過。
const PROD_API_BASE = 'https://eternity-content-api.ptyc4076.workers.dev';

const API_BASE = USE_TEST
  ? 'https://eternity-content-api-test.ptyc4076.workers.dev'
  : USE_REMOTE
    ? PROD_API_BASE
    : 'http://localhost:8788';

const LABEL = USE_TEST ? '測試' : USE_REMOTE ? '正式' : '本地';

console.log(`\n⬡ illustrationId → storyKey 遷移`);
console.log(`  目標: ${API_BASE}（${LABEL}）`);
console.log(
  `  模式: ${WRITE ? '寫入' : 'dry-run（不寫入，加 --write 才動）'}\n`
);

const headers = { 'Content-Type': 'application/json' };

/**
 * 取得寫入授權並填進共用 headers。
 *
 * 只在真的要寫、且目標是 remote／test 時才問——dry-run 全程唯讀，
 * 本地 dev worker（無 JWT_SECRET 無 API_TOKEN）走 dev bypass 也不需要。
 */
async function ensureWriteAuth() {
  if (!WRITE) return true;
  if (!USE_REMOTE && !USE_TEST) return true;
  const token = await resolveWriteToken({
    loginApiUrl: PROD_API_BASE,
    purpose: `寫入${LABEL}環境`,
  });
  if (!token) return false;
  headers['Authorization'] = `Bearer ${token}`;
  return true;
}

async function listPages(area) {
  const res = await fetch(`${API_BASE}/api/content/${area}`);
  const json = await res.json();
  if (!json.ok) {
    console.error(`❌ 無法取得 ${area} 頁面清單: ${json.error}`);
    process.exit(1);
  }
  return json.data ?? [];
}

async function getPage(id) {
  const res = await fetch(`${API_BASE}/api/content/${id}`);
  const json = await res.json();
  return json.ok ? json.data : null;
}

async function putPage(id, body) {
  const res = await fetch(`${API_BASE}/api/content/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    console.error(`❌ 寫入失敗 ${id}: ${json.error}`);
    return false;
  }
  return true;
}

/** Visuals：metadata.illustrationId → metadata.storyKey */
async function migrateGalleries() {
  const summaries = await listPages('visuals');
  let found = 0;
  let written = 0;

  for (const summary of summaries) {
    if (summary.pageType !== 'gallery') continue;
    const page = await getPage(summary.id);
    if (!page) continue;

    const metadata = page.metadata ?? {};
    const legacy = metadata.illustrationId;
    if (typeof legacy !== 'string' || !legacy.trim()) continue;

    found++;
    const existing = metadata.storyKey;
    if (
      typeof existing === 'string' &&
      existing.trim() &&
      existing !== legacy
    ) {
      // 兩個欄位都有值且不同——不猜，交給人工判斷
      console.warn(
        `⚠ ${summary.id}: storyKey「${existing}」與 illustrationId「${legacy}」並存且不同，跳過`
      );
      continue;
    }

    console.log(`📄 ${summary.id}: illustrationId「${legacy}」→ storyKey`);
    if (!WRITE) continue;

    const nextMetadata = { ...metadata, storyKey: legacy };
    delete nextMetadata.illustrationId;
    if (await putPage(summary.id, { metadata: nextMetadata })) written++;
  }

  return { found, written };
}

/**
 * History：visual clue 的 data-target-type="illustration" → "story"
 *
 * content 是 ContentBlock[]，rich_text block 的 content 是序列化後的 HTML
 * 字串。屬性值本身不含跳脫字元（targetType 只有兩個字面值），直接字串
 * 取代即可，不需要 DOM 解析。
 */
const CLUE_TYPE_PATTERN = /data-target-type="illustration"/g;

async function migrateHistoryClues() {
  const summaries = await listPages('history');
  let found = 0;
  let written = 0;

  for (const summary of summaries) {
    const page = await getPage(summary.id);
    if (!page || !Array.isArray(page.content)) continue;

    let hits = 0;
    const nextContent = page.content.map((block) => {
      if (typeof block?.content !== 'string') return block;
      const matches = block.content.match(CLUE_TYPE_PATTERN);
      if (!matches) return block;
      hits += matches.length;
      return {
        ...block,
        content: block.content.replace(
          CLUE_TYPE_PATTERN,
          'data-target-type="story"'
        ),
      };
    });

    if (hits === 0) continue;
    found += hits;
    console.log(`📄 ${summary.id}: ${hits} 個 visual clue 錨點`);
    if (!WRITE) continue;

    if (await putPage(summary.id, { content: nextContent })) written += hits;
  }

  return { found, written };
}

async function main() {
  if (!(await ensureWriteAuth())) {
    console.error('❌ 未取得寫入授權，中止（沒有動到任何資料）\n');
    process.exit(1);
  }

  console.log('── Visuals gallery ──');
  const galleries = await migrateGalleries();
  if (galleries.found === 0) console.log('   （無候選）');

  console.log('\n── History visual clue ──');
  const clues = await migrateHistoryClues();
  if (clues.found === 0) console.log('   （無候選）');

  console.log(
    `\n✅ ${WRITE ? '完成' : '預覽'}: gallery ${galleries.found} 筆` +
      `${WRITE ? `（寫入 ${galleries.written}）` : ''}、` +
      `clue 錨點 ${clues.found} 個${WRITE ? `（寫入 ${clues.written}）` : ''}\n`
  );

  if (!WRITE && (galleries.found > 0 || clues.found > 0)) {
    console.log('   加 --write 實際執行\n');
  }
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
