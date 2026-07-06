/**
 * apply-entity-keys.mjs — entityKey 批次寫入（Epic 2 S7-B）
 *
 * 讀取人工確認過的 scripts/entity-key-map.json（name → entityKey），
 * 對 Concepts 的 dossier entries / browser profiles / diff entries
 * 依名稱精確比對後寫入 entityKey 欄位。
 *
 * 防護：
 * - kebab-case 格式驗證，不合法者跳過並警告
 * - 同範圍（dossier=同 variant、其他=同頁）collision 偵測，衝突跳過
 * - 條目已有不同 entityKey 時預設跳過（旗標可能已引用），--force 覆寫
 * - --dry-run 只列出將變更的項目，不寫入
 *
 * 使用方式：
 *   node scripts/apply-entity-keys.mjs [--remote] [--dry-run] [--force]
 *                                      [--stacks=dossier,browser]
 *   API_TOKEN=xxx node scripts/apply-entity-keys.mjs --remote
 *
 * 預設範圍 dossier,browser——diff/translation 不掛 entityKey
 * （名詞翻譯對照不需要 revision）；要含入時 --stacks=dossier,browser,diff
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const USE_REMOTE = process.argv.includes('--remote');
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const API_BASE = USE_REMOTE
  ? 'https://eternity-content-api.ptyc4076.workers.dev'
  : 'http://localhost:8788';
const API_TOKEN = process.env.API_TOKEN ?? '';

// 目標 stack 過濾：預設排除 diff——translation 對照表不掛 entityKey
// （2026-07-06 艾斯維爾定案：名詞翻譯對照不需要 revision）。
// map 是名稱全域比對，不過濾的話同名條目會同時寫進 dossier 和 diff。
// 要含 diff 時：--stacks=dossier,browser,diff
const stacksArg = process.argv.find((a) => a.startsWith('--stacks='));
const TARGET_STACKS = stacksArg
  ? stacksArg
      .slice('--stacks='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : ['dossier', 'browser'];

const MAP_PATH = join(import.meta.dirname, 'entity-key-map.json');
const ENTITY_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

console.log(`\n⬡ entityKey 批次寫入`);
console.log(`  目標: ${API_BASE}`);
console.log(`  範圍: ${TARGET_STACKS.join(', ')}`);
console.log(
  `  模式: ${DRY_RUN ? 'dry-run（不寫入）' : '寫入'}${FORCE ? ' + force 覆寫' : ''}\n`
);

function loadMap() {
  if (!existsSync(MAP_PATH)) {
    console.error(
      `❌ 找不到 ${MAP_PATH}\n   先跑 generate-entity-keys.mjs 產生候選，人工確認後另存為 entity-key-map.json`
    );
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(MAP_PATH, 'utf-8'));
  // 相容兩種形狀：{ map: {name:key} } 或平鋪 {name:key}
  const map = raw.map && typeof raw.map === 'object' ? raw.map : raw;
  const entries = Object.entries(map).filter(
    ([k, v]) => !k.startsWith('$') && typeof v === 'string' && v.length > 0
  );

  const invalid = entries.filter(([, v]) => !ENTITY_KEY_PATTERN.test(v));
  for (const [name, key] of invalid) {
    console.warn(`⚠ 非法 entityKey 格式，跳過: ${name} → ${key}`);
  }
  return new Map(entries.filter(([, v]) => ENTITY_KEY_PATTERN.test(v)));
}

function parseStructuredBlock(page) {
  const blocks = Array.isArray(page.content) ? page.content : [];
  const idx = blocks.findIndex((b) => b.type !== 'rich_text');
  if (idx === -1 || !blocks[idx].content) return null;
  try {
    return { blocks, idx, data: JSON.parse(blocks[idx].content) };
  } catch {
    return null;
  }
}

/**
 * 對條目套用 map：names 命中且通過防護 → 設 entityKey。
 * scopeKeys = 該唯一性範圍內既有的 entityKey 集合（同步更新）。
 * 回傳變更筆數。
 */
function applyToEntries(entries, nameField, map, scopeKeys, log, changes) {
  let changed = 0;
  for (const entry of entries) {
    const name = entry[nameField];
    if (!name || !map.has(name)) continue;
    const key = map.get(name);

    if (entry.entityKey === key) continue;
    if (entry.entityKey && entry.entityKey !== key && !FORCE) {
      log(
        `⚠ 已有不同 entityKey，跳過（--force 可覆寫）: ${name}（${entry.entityKey} ≠ ${key}）`
      );
      continue;
    }
    if (scopeKeys.has(key) && !FORCE) {
      log(`⚠ 同範圍 entityKey 衝突，跳過: ${name} → ${key}`);
      continue;
    }

    changes.push(`${name} → ${key}`);
    if (!DRY_RUN) entry.entityKey = key;
    scopeKeys.add(key);
    changed++;
  }
  return changed;
}

function applyToPage(data, stackStyle, map, log, changes) {
  let changed = 0;

  if (stackStyle === 'dossier' && Array.isArray(data.variants)) {
    for (const variant of data.variants) {
      // dossier 唯一性範圍 = 同 variant
      const scopeKeys = new Set();
      const allEntries = [];
      for (const subcat of variant.subcategories ?? [])
        for (const group of subcat.groups ?? [])
          allEntries.push(...(group.entries ?? []));
      for (const e of allEntries) if (e.entityKey) scopeKeys.add(e.entityKey);
      changed += applyToEntries(
        allEntries,
        'name',
        map,
        scopeKeys,
        log,
        changes
      );
    }
  } else if (stackStyle === 'browser' && Array.isArray(data.profiles)) {
    const scopeKeys = new Set(
      data.profiles.filter((p) => p.entityKey).map((p) => p.entityKey)
    );
    changed += applyToEntries(
      data.profiles,
      'name',
      map,
      scopeKeys,
      log,
      changes
    );
  } else if (stackStyle === 'diff' && Array.isArray(data.subcategories)) {
    const allEntries = [];
    for (const subcat of data.subcategories)
      for (const section of subcat.sections ?? [])
        allEntries.push(...(section.entries ?? []));
    const scopeKeys = new Set(
      allEntries.filter((e) => e.entityKey).map((e) => e.entityKey)
    );
    changed += applyToEntries(allEntries, 'term', map, scopeKeys, log, changes);
  }

  return changed;
}

async function main() {
  const map = loadMap();
  console.log(`📋 讀入 ${map.size} 筆 name → entityKey 對應\n`);

  const listRes = await fetch(`${API_BASE}/api/content/concepts`);
  const listJson = await listRes.json();
  if (!listJson.ok) {
    console.error(`❌ 無法取得頁面清單: ${listJson.error}`);
    process.exit(1);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

  let totalChanged = 0;
  let pagesUpdated = 0;

  for (const summary of listJson.data ?? []) {
    // 清單端點不含 metadata——抓單頁後再判 stack_style
    if (summary.pageType === 'homepage') continue;

    const pageRes = await fetch(`${API_BASE}/api/content/${summary.id}`);
    const pageJson = await pageRes.json();
    if (!pageJson.ok) continue;
    const stackStyle = pageJson.data.metadata?.stack_style;
    if (!TARGET_STACKS.includes(stackStyle)) continue;

    const parsed = parseStructuredBlock(pageJson.data);
    if (!parsed) continue;

    const changes = [];
    const changed = applyToPage(
      parsed.data,
      stackStyle,
      map,
      (msg) => console.warn(`   ${msg}`),
      changes
    );
    if (changed === 0) continue;

    console.log(`📄 ${summary.id}（${stackStyle}）: ${changed} 筆`);
    for (const c of changes) console.log(`   ${DRY_RUN ? '[dry] ' : ''}${c}`);

    totalChanged += changed;
    if (DRY_RUN) continue;

    // 寫回：只更新 content（PUT 支援部分更新）
    parsed.blocks[parsed.idx] = {
      ...parsed.blocks[parsed.idx],
      content: JSON.stringify(parsed.data),
    };
    const putRes = await fetch(`${API_BASE}/api/content/${summary.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content: parsed.blocks }),
    });
    const putJson = await putRes.json();
    if (putJson.ok) {
      pagesUpdated++;
    } else {
      console.error(`❌ 寫入失敗 ${summary.id}: ${putJson.error}`);
    }
  }

  console.log(
    `\n✅ ${DRY_RUN ? '預覽' : '完成'}: ${totalChanged} 筆 entityKey${DRY_RUN ? '' : `，更新 ${pagesUpdated} 頁`}\n`
  );
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
