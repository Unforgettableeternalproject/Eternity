/**
 * reshape-dossier-groups.mjs — dossier「群組=實體名」整形（S7-B 資料修正）
 *
 * 問題形狀（hostile_creatures）：魔獸名稱被放在群組層，底下只有
 * 一個「敘述:」條目裝內容——entityKey/revision 都掛在 entry 層，
 * 這種形狀的實體吃不到條目級進度閘。
 *
 * 整形規則（2026-07-06 艾斯維爾定案）：
 * - 命中條件：群組只有一個條目，且條目名稱為「敘述」「敘述:」「敘述：」
 * - 轉換：條目改名為群組名稱（content_html/spoiler/entityKey/revisions
 *   原樣保留），併入該分類的預設群組（label ''，放最前）
 * - 群組分類之後由艾斯維爾手動再分
 * - 不命中的群組原樣保留（如 ◼︎◼︎ 遮蔽區）
 *
 * 使用方式：
 *   node scripts/reshape-dossier-groups.mjs [--remote] [--dry-run]
 *                                           [--page=server/records/hostile_creatures]
 */

import { argv, exit } from 'process';

const USE_REMOTE = argv.includes('--remote');
const DRY_RUN = argv.includes('--dry-run');
const API_BASE = USE_REMOTE
  ? 'https://eternity-content-api.ptyc4076.workers.dev'
  : 'http://localhost:8788';
const API_TOKEN = process.env.API_TOKEN ?? '';

const pageArg = argv.find((a) => a.startsWith('--page='));
const PAGE_SLUG = pageArg
  ? pageArg.slice('--page='.length)
  : 'server/records/hostile_creatures';

const NARRATIVE_ENTRY = /^敘述[:：]?$/;

console.log(`\n⬡ dossier 群組整形`);
console.log(`  目標: ${API_BASE}`);
console.log(`  頁面: concepts/${PAGE_SLUG}`);
console.log(`  模式: ${DRY_RUN ? 'dry-run（不寫入）' : '寫入'}\n`);

async function main() {
  const res = await fetch(`${API_BASE}/api/content/concepts/${PAGE_SLUG}`);
  const json = await res.json();
  if (!json.ok) {
    console.error(`❌ 無法取得頁面: ${json.error}`);
    exit(1);
  }

  const blocks = json.data.content;
  const idx = blocks.findIndex((b) => b.type !== 'rich_text');
  if (idx === -1) {
    console.error('❌ 找不到結構化 content block');
    exit(1);
  }
  const data = JSON.parse(blocks[idx].content);
  if (!Array.isArray(data.variants)) {
    console.error('❌ 不是 dossier 格式（無 variants）');
    exit(1);
  }

  let converted = 0;
  for (const variant of data.variants) {
    for (const subcat of variant.subcategories ?? []) {
      const matched = [];
      const kept = [];
      for (const group of subcat.groups ?? []) {
        const only = group.entries?.length === 1 ? group.entries[0] : null;
        if (only && NARRATIVE_ENTRY.test((only.name || '').trim())) {
          matched.push(group);
        } else {
          kept.push(group);
        }
      }
      if (matched.length === 0) continue;

      // 敘述條目升格為實體條目：名稱=群組名，其餘欄位原樣保留
      const promoted = matched.map((group) => ({
        ...group.entries[0],
        name: (group.label || '').trim(),
      }));

      // 併入預設群組（label ''）——已存在就 append，否則建立並放最前
      const defaultGroup = kept.find((g) => !g.label);
      if (defaultGroup) {
        defaultGroup.entries = [...defaultGroup.entries, ...promoted];
      } else {
        kept.unshift({ label: '', entries: promoted });
      }
      subcat.groups = kept;
      converted += matched.length;

      console.log(
        `  variant ${variant.id} / ${subcat.label || '(未命名分類)'}：`
      );
      for (const entry of promoted) {
        console.log(`    群組 → 條目：${entry.name || '(空名稱，待補)'}`);
      }
    }
  }

  if (converted === 0) {
    console.log('沒有命中的群組，無事可做。\n');
    return;
  }

  console.log(`\n${DRY_RUN ? '[dry] 將' : ''}轉換 ${converted} 個群組為條目`);
  if (DRY_RUN) return;

  blocks[idx] = { ...blocks[idx], content: JSON.stringify(data) };
  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;
  const putRes = await fetch(`${API_BASE}/api/content/concepts/${PAGE_SLUG}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ content: blocks }),
  });
  const putJson = await putRes.json();
  if (putJson.ok) {
    console.log('✅ 已寫回\n');
  } else {
    console.error(`❌ 寫入失敗: ${putJson.error}`);
    exit(1);
  }
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  exit(1);
});
