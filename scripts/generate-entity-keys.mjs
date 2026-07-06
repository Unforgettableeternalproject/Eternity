/**
 * generate-entity-keys.mjs — entityKey 候選清單產生器（Epic 2 S7-B）
 *
 * 掃描 Concepts 的 dossier entries / browser profiles / diff entries，
 * 從名稱提取拉丁字符序列，產生 kebab-case 候選 entityKey。
 * chrono periods 不掃（entityKey 選用不強制——設計定案 A）。
 *
 * 保守策略（設計文件 §7-2）：不自動寫入 D1——entityKey 是語意資產，
 * 錯配比缺失更難修復。輸出 scripts/entity-key-map.proposed.json，
 * 由艾斯維爾人工確認後另存為 scripts/entity-key-map.json，
 * 再跑 apply-entity-keys.mjs 批次寫入。
 *
 * 使用方式：
 *   node scripts/generate-entity-keys.mjs [--remote]
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

const USE_REMOTE = process.argv.includes('--remote');
const API_BASE = USE_REMOTE
  ? 'https://eternity-content-api.ptyc4076.workers.dev'
  : 'http://localhost:8788';

const OUT_PATH = join(import.meta.dirname, 'entity-key-map.proposed.json');

/** 從名稱提取拉丁字符部分，轉 kebab-case；無拉丁字符回傳 null */
export function suggestEntityKey(name) {
  // 抓最長的拉丁字符序列（含空格/撇號/連字號，如 "Xavier Colsono"）
  const matches = name.match(/[A-Za-z][A-Za-z' -]*[A-Za-z]|[A-Za-z]/g) || [];
  if (matches.length === 0) return null;
  const longest = matches.reduce((a, b) => (b.length > a.length ? b : a), '');
  const kebab = longest
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return kebab || null;
}

/** 解析頁面的結構化 content block */
function parseStructuredBlock(page) {
  const blocks = Array.isArray(page.content) ? page.content : [];
  const block = blocks.find((b) => b.type !== 'rich_text');
  if (!block?.content) return null;
  try {
    return JSON.parse(block.content);
  } catch {
    return null;
  }
}

/** 收集單頁的候選條目：[{ name, currentKey, location }] */
function collectFromPage(page, stackStyle) {
  const data = parseStructuredBlock(page);
  if (!data) return [];
  const out = [];

  if (stackStyle === 'dossier' && Array.isArray(data.variants)) {
    for (const variant of data.variants) {
      for (const subcat of variant.subcategories ?? []) {
        for (const group of subcat.groups ?? []) {
          for (const entry of group.entries ?? []) {
            if (!entry.name) continue;
            out.push({
              name: entry.name,
              currentKey: entry.entityKey ?? null,
              location: `dossier ${page.id} [variant ${variant.id}] ${subcat.label}/${group.label || '(預設)'}`,
            });
          }
        }
      }
    }
  } else if (stackStyle === 'browser' && Array.isArray(data.profiles)) {
    for (const profile of data.profiles) {
      if (!profile.name) continue;
      out.push({
        name: profile.name,
        currentKey: profile.entityKey ?? null,
        location: `browser ${page.id}`,
      });
    }
  } else if (stackStyle === 'diff' && Array.isArray(data.subcategories)) {
    for (const subcat of data.subcategories) {
      for (const section of subcat.sections ?? []) {
        for (const entry of section.entries ?? []) {
          if (!entry.term) continue;
          out.push({
            name: entry.term,
            currentKey: entry.entityKey ?? null,
            location: `diff ${page.id} ${subcat.label}/${section.label || '(預設)'}`,
          });
        }
      }
    }
  }

  return out;
}

async function main() {
  console.log(`\n⬡ entityKey 候選清單產生器`);
  console.log(`  來源: ${API_BASE}\n`);

  const listRes = await fetch(`${API_BASE}/api/content/concepts`);
  const listJson = await listRes.json();
  if (!listJson.ok) {
    console.error(`❌ 無法取得頁面清單: ${listJson.error}`);
    process.exit(1);
  }

  /** name → { suggested, currentKeys: Set, occurrences: [] } */
  const candidates = new Map();
  let scannedPages = 0;

  for (const summary of listJson.data ?? []) {
    // 清單端點不含 metadata——抓單頁後再判 stack_style
    if (summary.pageType === 'homepage') continue;

    const pageRes = await fetch(`${API_BASE}/api/content/${summary.id}`);
    const pageJson = await pageRes.json();
    if (!pageJson.ok) {
      console.warn(`⚠ 跳過 ${summary.id}: ${pageJson.error}`);
      continue;
    }
    const stackStyle = pageJson.data.metadata?.stack_style;
    if (!['dossier', 'browser', 'diff'].includes(stackStyle)) continue;
    scannedPages++;

    for (const item of collectFromPage(pageJson.data, stackStyle)) {
      if (!candidates.has(item.name)) {
        candidates.set(item.name, {
          suggested: suggestEntityKey(item.name),
          currentKeys: new Set(),
          occurrences: [],
        });
      }
      const c = candidates.get(item.name);
      if (item.currentKey) c.currentKeys.add(item.currentKey);
      c.occurrences.push(item.location);
    }
  }

  // 組輸出：map（人工編輯區）+ occurrences（參考資訊）
  const map = {};
  const occurrences = {};
  const conflicts = [];
  for (const [name, c] of [...candidates.entries()].sort()) {
    // 已有 entityKey 的條目沿用現值（不建議改——旗標已可能引用）
    if (c.currentKeys.size === 1) {
      map[name] = [...c.currentKeys][0];
    } else if (c.currentKeys.size > 1) {
      map[name] = null;
      conflicts.push(`${name}: ${[...c.currentKeys].join(' / ')}`);
    } else {
      map[name] = c.suggested; // 可能為 null（無拉丁字符，需人工命名）
    }
    occurrences[name] = c.occurrences;
  }

  const output = {
    $note:
      '人工確認後另存為 scripts/entity-key-map.json 再跑 apply-entity-keys.mjs。' +
      '值為 null 的條目會被 apply 略過（不需要 entityKey 的列表型條目直接留 null）。' +
      'occurrences 僅供參考，apply 只讀 map。',
    $generated: new Date().toISOString(),
    $source: API_BASE,
    map,
    occurrences,
  };

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf-8');

  const total = candidates.size;
  const suggested = Object.values(map).filter(Boolean).length;
  console.log(`✅ 掃描 ${scannedPages} 頁，收集 ${total} 個候選條目`);
  console.log(`   有建議 key: ${suggested}，待人工命名: ${total - suggested}`);
  if (conflicts.length > 0) {
    console.warn(`⚠ 同名條目持有不同 entityKey（需人工裁決）:`);
    for (const c of conflicts) console.warn(`   ${c}`);
  }
  console.log(`   輸出: ${OUT_PATH}\n`);
}

// 直接執行時才跑（suggestEntityKey 可被測試 import）
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
) {
  main().catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
