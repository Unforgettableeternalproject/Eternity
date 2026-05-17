/**
 * 一次性合併腳本：把 records stack 下帶 era 後綴的 dossier 頁面
 * 合併為單一頁面（slug 去後綴，內含 variants 結構）。
 *
 * 範例：
 *   character_list_u  →  character_list  (variants: [{id:'u', label:'U', subcategories:[...]}])
 *   inversa_u         →  inversa         (variants: [{id:'u', ...}])
 *
 * 使用方式：
 *   node scripts/merge-dossier-variants.mjs            # 本地（dry-run）
 *   node scripts/merge-dossier-variants.mjs --remote   # 遠端（dry-run）
 *   node scripts/merge-dossier-variants.mjs --apply    # 本地實際執行
 *   node scripts/merge-dossier-variants.mjs --remote --apply
 *
 * 預設 dry-run，列出將執行的操作；加 --apply 才會真正寫入/刪除。
 *
 * 規則：
 * - 只處理 parent_id = 'concepts/server/records' 的 type 頁面
 * - slug 結尾若匹配 /_([a-z]+)$/ 視為 era 後綴，去掉後得到新 slug
 * - 多個來源 page 合併為一個 page，依 metadata.era（或 slug 後綴）建立 variant
 * - 新 page 的 intro_html / metadata 取第一個 variant 的
 * - 完成後刪除舊頁面
 */

import { createHash } from 'crypto';

const USE_REMOTE = process.argv.includes('--remote');
const APPLY = process.argv.includes('--apply');
const API_BASE = USE_REMOTE
  ? 'https://eternity-content-api.ptyc4076.workers.dev'
  : 'http://localhost:8788';
const API_TOKEN = process.env.API_TOKEN ?? '';

const RECORDS_PARENT = 'concepts/server/records';
const ERA_SUFFIX_RE = /_([a-z]+)$/;

const headers = { 'Content-Type': 'application/json' };
if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

console.log(`\n⬡ Dossier variant 合併工具`);
console.log(`  目標: ${API_BASE}`);
console.log(`  模式: ${APPLY ? '✓ 實際執行' : '🅓 dry-run（不寫入）'}\n`);

// ── 取得現有 records 子頁面 ────────────────────────────────────────
async function fetchRecordsPages() {
  const res = await fetch(`${API_BASE}/api/content/concepts`);
  const json = await res.json();
  if (!json.ok) {
    console.error(`❌ 取得頁面清單失敗: ${json.error}`);
    process.exit(1);
  }
  return (json.data || []).filter((p) => p.parentId === RECORDS_PARENT);
}

// ── 取得單一頁面完整內容 ──────────────────────────────────────────
async function fetchPage(id) {
  const slug = id.replace(/^concepts\//, '');
  const res = await fetch(`${API_BASE}/api/content/concepts/${slug}`);
  const json = await res.json();
  if (!json.ok) {
    console.error(`  ⚠ 取得頁面內容失敗 ${id}: ${json.error}`);
    return null;
  }
  return json.data;
}

// ── 從 slug 抽出 era 後綴 ─────────────────────────────────────────
function extractEra(slug, metadata) {
  // 優先用 metadata.era，否則從 slug 後綴
  if (metadata?.era && typeof metadata.era === 'string')
    return metadata.era.toLowerCase();
  const lastSeg = slug.split('/').pop() || '';
  const m = lastSeg.match(ERA_SUFFIX_RE);
  return m ? m[1] : null;
}

function stripEraSuffix(slug) {
  return slug.replace(ERA_SUFFIX_RE, '');
}

function contentHash(content) {
  return createHash('sha256')
    .update(content, 'utf-8')
    .digest('hex')
    .slice(0, 16);
}

// ── 主要合併邏輯 ──────────────────────────────────────────────────
async function main() {
  const pages = await fetchRecordsPages();
  console.log(`📄 records 區共找到 ${pages.length} 個 type 頁面\n`);

  // 依「去掉 era 後綴」的 slug 分組
  const groups = new Map(); // newSlug -> [page, page, ...]
  for (const p of pages) {
    const slugTail = p.slug.split('/').pop() || '';
    const eraSuffix = slugTail.match(ERA_SUFFIX_RE);
    const newSlugTail = eraSuffix ? stripEraSuffix(slugTail) : slugTail;
    const slugPrefix = p.slug.replace(/\/[^/]+$/, '');
    const newSlug = `${slugPrefix}/${newSlugTail}`;
    if (!groups.has(newSlug)) groups.set(newSlug, []);
    groups.get(newSlug).push(p);
  }

  const operations = [];

  for (const [newSlug, group] of groups) {
    console.log(`▸ ${newSlug}  (${group.length} 個來源頁面)`);

    // 載入每個來源頁面的完整內容
    const variants = [];
    let firstIntroHtml = '';
    let firstMeta = null;
    let firstTitle = '';
    const oldIds = [];
    const sourceFiles = [];

    for (const p of group) {
      const full = await fetchPage(p.id);
      if (!full) continue;

      const era = extractEra(full.slug, full.metadata) || 'u';
      const content = Array.isArray(full.content) ? full.content : [];
      const introBlock = content.find((b) => b.type === 'rich_text');
      const structBlock =
        content.find((b) => b.type === 'dossier') ||
        content.find((b) => b.type !== 'rich_text');

      let structData = null;
      if (structBlock?.content) {
        try {
          structData = JSON.parse(structBlock.content);
        } catch {
          structData = null;
        }
      }

      let subcategories = [];
      if (structData) {
        if (
          Array.isArray(structData.variants) &&
          structData.variants.length > 0
        ) {
          // 已是新格式（罕見，但有可能是重複跑此腳本）— 合併 variants
          for (const v of structData.variants) {
            variants.push({
              id: v.id || era,
              label: v.label || (v.id || era).toUpperCase(),
              subcategories: Array.isArray(v.subcategories)
                ? v.subcategories
                : [],
            });
          }
          subcategories = null; // 已處理完
        } else if (Array.isArray(structData.subcategories)) {
          subcategories = structData.subcategories;
        }
      }

      if (subcategories !== null) {
        variants.push({
          id: era,
          label: era.toUpperCase(),
          subcategories,
        });
      }

      if (!firstIntroHtml && introBlock?.content)
        firstIntroHtml = introBlock.content;
      if (!firstMeta) firstMeta = { ...(full.metadata || {}) };
      if (!firstTitle) firstTitle = full.title || '';
      oldIds.push(full.id);
      if (full.sourceFile) sourceFiles.push(full.sourceFile);

      console.log(
        `    ↳ 載入 ${full.slug}  (variant: ${era})  → ${countEntries(subcategories || [])} 筆條目`
      );
    }

    if (variants.length === 0) {
      console.log(`    ⚠ 無有效資料，跳過`);
      continue;
    }

    // 組裝新 page
    const newId = `concepts/${newSlug}`;
    const structData = { variants };
    const contentBlocks = [];
    if (firstIntroHtml)
      contentBlocks.push({
        id: 'intro',
        type: 'rich_text',
        content: firstIntroHtml,
      });
    contentBlocks.push({
      id: 'content',
      type: 'dossier',
      content: JSON.stringify(structData),
    });

    const newMeta = { ...(firstMeta || {}) };
    delete newMeta.era; // era 已移至 variant 層
    if (!newMeta.stack_style) newMeta.stack_style = 'dossier';

    // 清掉標題中的「(X)」後綴
    const title =
      (firstTitle || newSlug.split('/').pop() || '')
        .replace(/\s*[（(][A-Za-z]+[)）]\s*$/, '')
        .trim() || firstTitle;

    const newPage = {
      id: newId,
      area: 'concepts',
      title,
      slug: newSlug,
      content: contentBlocks,
      sourceFile: sourceFiles.join(',') || undefined,
      contentHash: contentHash(JSON.stringify(structData)),
      parentId: RECORDS_PARENT,
      depth: 2,
      pageType: 'type',
      metadata: newMeta,
    };

    // 收集操作
    const idsToDelete = oldIds.filter((id) => id !== newId);
    operations.push({ newPage, idsToDelete });

    console.log(
      `    ✓ 將建立 / 更新: ${newId}  (variants: ${variants.map((v) => v.id).join('/')})`
    );
    if (idsToDelete.length > 0) {
      console.log(`    ✓ 將刪除舊頁面: ${idsToDelete.join(', ')}`);
    }
    console.log();
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`即將執行 ${operations.length} 個合併操作`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (!APPLY) {
    console.log(`🅓 dry-run 結束。確認上述計畫無誤後，加 --apply 實際執行：`);
    console.log(
      `   node scripts/merge-dossier-variants.mjs ${USE_REMOTE ? '--remote ' : ''}--apply\n`
    );
    return;
  }

  // 實際執行
  for (const op of operations) {
    console.log(`▸ 寫入 ${op.newPage.id}`);
    const res = await fetch(
      `${API_BASE}/api/content/concepts/${op.newPage.slug}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          title: op.newPage.title,
          content: op.newPage.content,
          parentId: op.newPage.parentId,
          depth: op.newPage.depth,
          pageType: op.newPage.pageType,
          metadata: op.newPage.metadata,
          sourceFile: op.newPage.sourceFile,
        }),
      }
    );
    const json = await res.json();
    if (!json.ok) {
      console.error(`  ❌ 寫入失敗: ${json.error}`);
      continue;
    }
    console.log(`  ✓ 寫入成功`);

    for (const oldId of op.idsToDelete) {
      const res2 = await fetch(`${API_BASE}/api/content/${oldId}`, {
        method: 'DELETE',
        headers,
      });
      const json2 = await res2.json().catch(() => ({}));
      if (res2.ok || json2.ok) {
        console.log(`  ✓ 已刪除舊頁面 ${oldId}`);
      } else {
        console.log(
          `  ⚠ 刪除舊頁面失敗 ${oldId}: ${json2.error || res2.status}`
        );
      }
    }
    console.log();
  }

  console.log(`⬡ 合併完成`);
}

function countEntries(subcats) {
  return subcats.reduce(
    (s, sc) =>
      s + (sc.groups || []).reduce((g, gr) => g + (gr.entries || []).length, 0),
    0
  );
}

main().catch((e) => {
  console.error(`\n❌ 執行失敗: ${e.message}`);
  process.exit(1);
});
