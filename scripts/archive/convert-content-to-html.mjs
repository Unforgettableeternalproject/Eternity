#!/usr/bin/env node
/**
 * convert-content-to-html.mjs
 *
 * 將 root_projects 和 root_updates 的 content 欄位
 * 從 markdown 原始字串轉換為 HTML。
 *
 * 用法：
 *   node scripts/convert-content-to-html.mjs           # 本地 D1（dry-run）
 *   node scripts/convert-content-to-html.mjs --write    # 本地 D1（實際寫入）
 *   node scripts/convert-content-to-html.mjs --remote   # 遠端 D1（dry-run）
 *   node scripts/convert-content-to-html.mjs --remote --write  # 遠端 D1（實際寫入）
 */

import { execSync } from 'child_process';
import { marked } from 'marked';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const isWrite = args.includes('--write');

const WORKER_DIR = 'workers/content-api';

// ─── Configure marked ───
marked.setOptions({
  breaks: false,
  gfm: true,
});

// ─── D1 helpers ───

function d1Execute(sql, remote = false) {
  const remoteFlag = remote ? ' --remote' : ' --local';
  const cmd = `npx wrangler d1 execute eternity-content${remoteFlag} --command "${sql.replace(/"/g, '\\"')}"`;
  try {
    const output = execSync(cmd, {
      cwd: WORKER_DIR,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Parse JSON from wrangler output
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed[0]?.results || [];
  } catch (e) {
    // wrangler sometimes exits 1 but still returns data
    const output = e.stdout || '';
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed[0]?.results || [];
    }
    console.error('D1 execute failed:', e.message);
    return [];
  }
}

function d1ExecuteFile(sqlFile, remote = false) {
  const remoteFlag = remote ? ' --remote' : ' --local';
  const cmd = `npx wrangler d1 execute eternity-content${remoteFlag} --file="${sqlFile}"`;
  try {
    execSync(cmd, {
      cwd: WORKER_DIR,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch (e) {
    console.error('D1 file execute failed:', e.message);
    return false;
  }
}

// ─── Check if content looks like markdown (not already HTML) ───

function isMarkdown(text) {
  if (!text || text.trim().length === 0) return false;
  // If it starts with an HTML tag, it's probably already HTML
  if (/^\s*<[a-zA-Z]/.test(text)) return false;
  // Look for markdown indicators
  const mdPatterns = [
    /^#{1,6}\s/m, // headings
    /\*\*[^*]+\*\*/, // bold
    /^[-*+]\s/m, // unordered list
    /^\d+\.\s/m, // ordered list
    /^```/m, // code block
    /^>\s/m, // blockquote
    /\[([^\]]+)\]\(([^)]+)\)/, // links
  ];
  return mdPatterns.some((p) => p.test(text));
}

// ─── Main ───

console.log(`\n📋 Root Content → HTML Converter`);
console.log(`   Mode: ${isRemote ? '🌐 Remote' : '💻 Local'} D1`);
console.log(
  `   Action: ${isWrite ? '✏️  WRITE' : '👁️  Dry-run (add --write to apply)'}\n`
);

// 1. Fetch all projects
console.log('── Projects ──');
const projects = d1Execute(
  'SELECT id, content_zh, content_en FROM root_projects',
  isRemote
);
console.log(`   Found ${projects.length} projects\n`);

let convertedCount = 0;
const updateStatements = [];

for (const p of projects) {
  const zhIsMd = isMarkdown(p.content_zh);
  const enIsMd = isMarkdown(p.content_en);

  if (!zhIsMd && !enIsMd) {
    console.log(`   ⏭️  ${p.id} — already HTML or empty`);
    continue;
  }

  console.log(`   🔄 ${p.id}`);

  if (zhIsMd) {
    const html = marked.parse(p.content_zh);
    const escaped = html.replace(/'/g, "''");
    updateStatements.push(
      `UPDATE root_projects SET content_zh = '${escaped}' WHERE id = '${p.id}';`
    );
    console.log(
      `      zh: ${p.content_zh.length} chars md → ${html.length} chars html`
    );
  }

  if (enIsMd) {
    const html = marked.parse(p.content_en);
    const escaped = html.replace(/'/g, "''");
    updateStatements.push(
      `UPDATE root_projects SET content_en = '${escaped}' WHERE id = '${p.id}';`
    );
    console.log(
      `      en: ${p.content_en.length} chars md → ${html.length} chars html`
    );
  }

  convertedCount++;
}

// 2. Fetch all updates
console.log('\n── Updates ──');
const updates = d1Execute(
  'SELECT id, content_zh, content_en FROM root_updates',
  isRemote
);
console.log(`   Found ${updates.length} updates\n`);

for (const u of updates) {
  const zhIsMd = isMarkdown(u.content_zh);
  const enIsMd = isMarkdown(u.content_en);

  if (!zhIsMd && !enIsMd) {
    console.log(`   ⏭️  ${u.id} — already HTML or empty`);
    continue;
  }

  console.log(`   🔄 ${u.id}`);

  if (zhIsMd) {
    const html = marked.parse(u.content_zh);
    const escaped = html.replace(/'/g, "''");
    updateStatements.push(
      `UPDATE root_updates SET content_zh = '${escaped}' WHERE id = '${u.id}';`
    );
    console.log(
      `      zh: ${u.content_zh.length} chars md → ${html.length} chars html`
    );
  }

  if (enIsMd) {
    const html = marked.parse(u.content_en);
    const escaped = html.replace(/'/g, "''");
    updateStatements.push(
      `UPDATE root_updates SET content_en = '${escaped}' WHERE id = '${u.id}';`
    );
    console.log(
      `      en: ${u.content_en.length} chars md → ${html.length} chars html`
    );
  }

  convertedCount++;
}

// 3. Execute or report
console.log(`\n── Summary ──`);
console.log(`   ${convertedCount} records need conversion`);
console.log(`   ${updateStatements.length} UPDATE statements generated\n`);

if (updateStatements.length === 0) {
  console.log('✅ Nothing to convert — all content is already HTML or empty.');
  process.exit(0);
}

if (!isWrite) {
  console.log('ℹ️  Dry-run complete. Run with --write to apply changes.');

  // Show a preview of the first converted HTML
  if (projects.length > 0) {
    const firstMd = projects.find((p) => isMarkdown(p.content_zh));
    if (firstMd) {
      const preview = marked.parse(firstMd.content_zh).substring(0, 500);
      console.log(`\n── Preview: ${firstMd.id} (zh, first 500 chars) ──`);
      console.log(preview);
    }
  }
  process.exit(0);
}

// Write SQL to temp file and execute
console.log('✏️  Writing to D1...');
const tmpFile = join(process.cwd(), 'scripts', '_tmp_convert.sql');
writeFileSync(tmpFile, updateStatements.join('\n'), 'utf-8');

const success = d1ExecuteFile(tmpFile, isRemote);
try {
  unlinkSync(tmpFile);
} catch {}

if (success) {
  console.log(`✅ Successfully converted ${convertedCount} records.`);
} else {
  console.log('❌ Conversion failed. Check errors above.');
  process.exit(1);
}
