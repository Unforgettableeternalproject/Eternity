#!/usr/bin/env node
/**
 * 主站（apps/root）內容遷移腳本
 * 從 Keystatic YAML/mdoc 檔案遷移到 content-api D1
 *
 * 用法：
 *   node scripts/migrate-root-content.mjs                    # 本地 (http://localhost:8788)
 *   node scripts/migrate-root-content.mjs --remote           # 遠端
 *   node scripts/migrate-root-content.mjs --dry-run          # 預覽不寫入
 *   node scripts/migrate-root-content.mjs --collection=projects  # 只遷移特定 collection
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== 設定 =====

const ROOT_CONTENT = path.resolve(__dirname, '../apps/root/src/content');
const LOCAL_API = 'http://localhost:8788';
const REMOTE_API =
  process.env.CONTENT_API_URL ||
  'https://eternity-content-api.unforgettableeternalproject.workers.dev';

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const isDryRun = args.includes('--dry-run');
const collectionFilter = args
  .find((a) => a.startsWith('--collection='))
  ?.split('=')[1];
const API_BASE = isRemote ? REMOTE_API : LOCAL_API;

// 認證
let authToken = process.env.API_TOKEN || '';

// ===== Slug 對照表 =====

const PROJECT_SLUG_MAP = {
  'FacePI - Azure 人臉辨識應用': 'facepi',
  'GDG-Portal - 校園開發者社群平台': 'gdg-portal',
  'LBN 大巨巢系統模擬': 'lbn-simulation',
  'Omniimagainer - 多功能圖像處理應用': 'omniimagainer',
  'Ranza - 萬用隨機器': 'ranza',
  'SparkBoard - AWS 無伺服器任務協作平台': 'sparkboard',
  'StegoApollo - 圖像隱寫術工具': 'stegoapollo',
  'U.E.P 個人虛擬桌面助理': 'uep-desktop-assistant',
  'U.E.P 的心智 - Discord 機器人': 'uep-discord-bot',
  'Wyrm 資料庫檢索工具': 'wyrm',
  '一添綠意 - 茶飲電子商務平台': 'green-tea-shop',
  學校資訊自動推送系統: 'school-info-push',
  '數字潛流 - 倉庫番推箱遊戲': 'sokoban-game',
  '普爾小鎮 - 文字冒險 RPG 遊戲': 'pool-town-rpg',
  端到端區網區控系統: 'lan-control-system',
};

const LINK_SLUG_MAP = {
  'U.E.P 的幻想空間': 'uep-imaginary-space',
  使命小隊工作室: 'discord-server',
  我的bandlab: 'bandlab',
  我的Github: 'github',
  我的Line: 'line',
  我的pixiv: 'pixiv',
  我的Steam帳號: 'steam',
  我的小說平台: 'novelstar',
  我的工作履歷: 'linkedin',
  我的推特: 'twitter',
  我的臉書: 'facebook',
  我的頻道: 'youtube',
};

const UPDATE_SLUG_MAP = {
  '第一次更新 (網站正式部署)': 'first-update-site-launch',
};

// ===== 簡易 YAML 解析（只處理主站的 Keystatic YAML 格式） =====

function parseSimpleYaml(raw) {
  const result = {};
  const lines = raw.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 跳過空行和註解
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    // 頂層 key: value
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!kvMatch) {
      i++;
      continue;
    }

    const key = kvMatch[1];
    let value = kvMatch[2].trim();

    // 多行字串 >- 或 >
    if (value === '>-' || value === '>') {
      const parts = [];
      i++;
      while (
        i < lines.length &&
        (lines[i].startsWith('  ') || lines[i].trim() === '')
      ) {
        if (lines[i].trim() === '') {
          // >- 模式中空行分段
          parts.push('');
        } else {
          parts.push(lines[i].trim());
        }
        i++;
      }
      result[key] = parts.filter((p) => p !== '').join(' ');
      continue;
    }

    // 陣列值
    if (value === '') {
      // 可能是陣列或巢狀物件
      const nextLine = lines[i + 1];
      if (nextLine && nextLine.match(/^\s+-\s/)) {
        // 陣列
        const arr = [];
        i++;
        while (i < lines.length && lines[i].match(/^\s+-\s/)) {
          arr.push(lines[i].replace(/^\s+-\s+/, '').trim());
          i++;
        }
        result[key] = arr;
        continue;
      } else if (nextLine && nextLine.match(/^\s+\w+:/)) {
        // 巢狀物件（一層深）
        const obj = {};
        i++;
        while (i < lines.length && lines[i].match(/^\s+\w+/)) {
          const subMatch = lines[i].match(
            /^\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/
          );
          if (subMatch) {
            obj[subMatch[1]] = castValue(subMatch[2].trim());
          }
          i++;
        }
        result[key] = obj;
        continue;
      }
    }

    result[key] = castValue(value);
    i++;
  }

  return result;
}

function castValue(v) {
  if (v === '' || v === undefined) return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  // 移除引號
  if (
    (v.startsWith("'") && v.endsWith("'")) ||
    (v.startsWith('"') && v.endsWith('"'))
  ) {
    return v.slice(1, -1);
  }
  // 純數字
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  // ISO 日期（保持字串）
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return v;
}

// ===== 工具函式 =====

function readYaml(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseSimpleYaml(raw);
}

function readMdoc(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function apiPut(endpoint, body) {
  if (isDryRun) {
    console.log(`  [DRY-RUN] PUT ${endpoint}`);
    return { ok: true };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error(`  ❌ PUT ${endpoint} failed:`, data.error);
  }
  return data;
}

// ===== JWT 登入 =====

async function login() {
  if (authToken) return; // 已有 API_TOKEN

  // 開發模式不需要登入
  if (!isRemote) {
    console.log('📝 本地模式，跳過認證');
    return;
  }

  const username = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASS;
  if (!username || !password) {
    console.error(
      '❌ 遠端模式需要 ADMIN_USER 和 ADMIN_PASS 環境變數，或設定 API_TOKEN'
    );
    process.exit(1);
  }

  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error('❌ 登入失敗:', data.error);
    process.exit(1);
  }
  authToken = data.data.token;
  console.log('✅ 登入成功');
}

// ===== Projects 遷移 =====

async function migrateProjects() {
  console.log('\n📦 遷移 Projects...');
  const projectsDir = path.join(ROOT_CONTENT, 'projects');
  const yamlFiles = fs
    .readdirSync(projectsDir)
    .filter((f) => f.endsWith('.yaml'));

  let success = 0;
  let failed = 0;

  for (const yamlFile of yamlFiles) {
    const dirName = yamlFile.replace('.yaml', '');
    const slug = PROJECT_SLUG_MAP[dirName];
    if (!slug) {
      console.warn(`  ⚠️  找不到 slug 對照：${dirName}`);
      failed++;
      continue;
    }

    const data = readYaml(path.join(projectsDir, yamlFile));
    const contentZh = readMdoc(
      path.join(projectsDir, dirName, 'content_zh.mdoc')
    );
    const contentEn = readMdoc(
      path.join(projectsDir, dirName, 'content_en.mdoc')
    );

    const body = {
      titleZh: data.title_zh || '',
      titleEn: data.title_en || '',
      descZh: data.description_zh || '',
      descEn: data.description_en || '',
      contentZh,
      contentEn,
      tags: data.tags || [],
      featured: data.featured || false,
      sortOrder: data.order || 0,
      status: data.status || 'active',
      image: data.image || null,
      links: {
        demo: data.links?.demo || null,
        github: data.links?.github || null,
        website: data.links?.website || null,
      },
      startDate: data.startDate || null,
      endDate: data.endDate || null,
    };

    console.log(`  📄 ${dirName} → ${slug}`);
    const result = await apiPut(`/api/root/projects/${slug}`, body);
    if (result.ok) success++;
    else failed++;
  }

  console.log(`  ✅ Projects: ${success} 成功, ${failed} 失敗`);
}

// ===== Links 遷移 =====

async function migrateLinks() {
  console.log('\n🔗 遷移 Links...');
  const linksDir = path.join(ROOT_CONTENT, 'links');
  const yamlFiles = fs.readdirSync(linksDir).filter((f) => f.endsWith('.yaml'));

  let success = 0;
  let failed = 0;

  for (const yamlFile of yamlFiles) {
    const dirName = yamlFile.replace('.yaml', '');
    const slug = LINK_SLUG_MAP[dirName];
    if (!slug) {
      console.warn(`  ⚠️  找不到 slug 對照：${dirName}`);
      failed++;
      continue;
    }

    const data = readYaml(path.join(linksDir, yamlFile));

    const body = {
      titleZh: data.title_zh || '',
      titleEn: data.title_en || '',
      descZh: data.description_zh || '',
      descEn: data.description_en || '',
      url: data.url || '',
      category: data.category || 'other',
      status: data.status || 'normal',
      icon: data.icon || null,
      featured: data.featured || false,
      sortOrder: data.order || 0,
    };

    console.log(`  🔗 ${dirName} → ${slug}`);
    const result = await apiPut(`/api/root/links/${slug}`, body);
    if (result.ok) success++;
    else failed++;
  }

  console.log(`  ✅ Links: ${success} 成功, ${failed} 失敗`);
}

// ===== Updates 遷移 =====

async function migrateUpdates() {
  console.log('\n📰 遷移 Updates...');
  const updatesDir = path.join(ROOT_CONTENT, 'updates');
  const yamlFiles = fs
    .readdirSync(updatesDir)
    .filter((f) => f.endsWith('.yaml'));

  let success = 0;
  let failed = 0;

  for (const yamlFile of yamlFiles) {
    const dirName = yamlFile.replace('.yaml', '');
    const slug = UPDATE_SLUG_MAP[dirName];
    if (!slug) {
      console.warn(`  ⚠️  找不到 slug 對照：${dirName}`);
      failed++;
      continue;
    }

    const data = readYaml(path.join(updatesDir, yamlFile));
    const contentZh = readMdoc(
      path.join(updatesDir, dirName, 'content_zh.mdoc')
    );
    const contentEn = readMdoc(
      path.join(updatesDir, dirName, 'content_en.mdoc')
    );

    const body = {
      titleZh: data.title_zh || dirName,
      titleEn: data.title_en || '',
      descZh: data.description_zh || '',
      descEn: data.description_en || '',
      contentZh,
      contentEn,
      date: data.date || new Date().toISOString().split('T')[0],
      category: data.category || 'other',
      featured: data.featured || false,
    };

    console.log(`  📰 ${dirName} → ${slug}`);
    const result = await apiPut(`/api/root/updates/${slug}`, body);
    if (result.ok) success++;
    else failed++;
  }

  console.log(`  ✅ Updates: ${success} 成功, ${failed} 失敗`);
}

// ===== Singletons 遷移 =====

async function migrateSingletons() {
  console.log('\n🏠 遷移 Singletons...');
  const singletons = ['homepage-zh', 'homepage-en', 'about-zh', 'about-en'];

  let success = 0;
  let failed = 0;

  for (const key of singletons) {
    const jsonPath = path.join(ROOT_CONTENT, key, 'index.json');
    const content = readJson(jsonPath);
    if (!content) {
      console.warn(`  ⚠️  找不到 ${jsonPath}`);
      failed++;
      continue;
    }

    console.log(`  🏠 ${key}`);
    const result = await apiPut(`/api/root/singletons/${key}`, { content });
    if (result.ok) success++;
    else failed++;
  }

  console.log(`  ✅ Singletons: ${success} 成功, ${failed} 失敗`);
}

// ===== Cards 遷移 =====

async function migrateCards() {
  console.log('\n🃏 遷移 Cards...');
  const cardKeys = [
    'card-quote',
    'card-music',
    'card-visitor-counter',
    'card-latest-update',
    'card-quick-stats',
    'card-table-of-contents',
    'card-portal',
    'card-status',
    'card-uep',
  ];

  let success = 0;
  let failed = 0;

  for (const key of cardKeys) {
    // 先嘗試從 Keystatic singleton 路徑讀取
    const singletonPath = path.join(ROOT_CONTENT, key, 'index.json');
    let content = readJson(singletonPath);

    // 如果不存在，嘗試從 cards/ 子目錄讀取
    if (!content) {
      // card-quote → quote, card-music → music
      const shortKey = key.replace('card-', '');
      const cardsPath = path.join(ROOT_CONTENT, 'cards', `${shortKey}.json`);
      content = readJson(cardsPath);
    }

    if (!content) {
      // 有些 card 只有 base schema (enabled/order/position)，建立預設值
      console.log(`  🃏 ${key} → 使用預設值`);
      content = defaultCardContent(key);
    } else {
      console.log(`  🃏 ${key}`);
    }

    const result = await apiPut(`/api/root/cards/${key}`, { content });
    if (result.ok) success++;
    else failed++;
  }

  console.log(`  ✅ Cards: ${success} 成功, ${failed} 失敗`);
}

function defaultCardContent(key) {
  const defaults = {
    'card-portal': { enabled: false, order: 4, position: 'left' },
    'card-status': {
      enabled: false,
      order: 5,
      position: 'left',
      items: [
        { key: 'STATUS', value: 'Online', color: 'green' },
        { key: 'VERSION', value: 'v0.9.8', color: 'navy' },
      ],
    },
    'card-uep': {
      enabled: false,
      order: 6,
      position: 'left',
      image: '/uep/Show.webp',
    },
  };

  return defaults[key] || { enabled: false, order: 0, position: 'left' };
}

// ===== 主流程 =====

async function main() {
  console.log('🚀 主站內容遷移');
  console.log(`   API: ${API_BASE}`);
  console.log(`   模式: ${isDryRun ? 'DRY-RUN' : isRemote ? '遠端' : '本地'}`);
  if (collectionFilter) console.log(`   篩選: ${collectionFilter}`);
  console.log('');

  await login();

  const all = !collectionFilter;

  if (all || collectionFilter === 'projects') await migrateProjects();
  if (all || collectionFilter === 'links') await migrateLinks();
  if (all || collectionFilter === 'updates') await migrateUpdates();
  if (all || collectionFilter === 'singletons') await migrateSingletons();
  if (all || collectionFilter === 'cards') await migrateCards();

  console.log('\n🏁 遷移完成！');

  if (!isDryRun) {
    // 驗證
    console.log('\n📊 驗證結果...');
    try {
      const [projects, links, updates] = await Promise.all([
        fetch(`${API_BASE}/api/root/projects`).then((r) => r.json()),
        fetch(`${API_BASE}/api/root/links`).then((r) => r.json()),
        fetch(`${API_BASE}/api/root/updates`).then((r) => r.json()),
      ]);
      console.log(`   Projects: ${projects.data?.length || 0} 筆`);
      console.log(`   Links:    ${links.data?.length || 0} 筆`);
      console.log(`   Updates:  ${updates.data?.length || 0} 筆`);
    } catch (e) {
      console.log('   ⚠️  驗證失敗（API 可能未運行）');
    }
  }
}

main().catch((err) => {
  console.error('💥 遷移失敗:', err);
  process.exit(1);
});
