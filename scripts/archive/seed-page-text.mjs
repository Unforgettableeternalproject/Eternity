#!/usr/bin/env node
/**
 * seed-page-text.mjs
 *
 * 將首頁、專案、動態、連結四個頁面的硬編碼 hero 文字寫入 D1 singletons。
 * 對應的 section_id：
 *   page-home-zh / page-home-en
 *   page-projects-zh / page-projects-en
 *   page-updates-zh / page-updates-en
 *   page-links-zh / page-links-en
 *
 * 用法：
 *   node scripts/seed-page-text.mjs           # 本地 D1
 *   node scripts/seed-page-text.mjs --remote   # 遠端 D1
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const isRemote = process.argv.includes('--remote');
const WORKER_DIR = 'workers/content-api';

// ─── 首頁 ZH ───
const pageHomeZh = {
  heroLabel: '—— vol. 00 · personal site · 2026',
  heroTitle: '一個還在寫的故事。',
  heroSubtitle:
    '我是 顏榕嶙 — 台灣的全端工程師與創作者。我用程式、音樂、文字、像素，慢慢把心中那個故事寫成現實。',
  heroCta1: '看作品',
  heroCta2: '進 Imaginary Space',
  projectsLabel: '—— 01 / selected work',
  projectsTitle: '精選作品',
  projectsCta: '查看全部',
  aboutLabel: '—— 02 / about',
  aboutTitle: '關於我',
  aboutContent:
    '我並不想要被任何事物給拘束，而希望追求一個自由自在的環境。\n\n當然，聽起來還是天方夜譚，不過這也是我之所以繼續努力著的原因。\n\n有一個故事存活在我的心中，而對我而言，想辦法把這個故事給實現就是我一直在追求的最終目標。',
  aboutCta: '完整自介',
  updatesLabel: '—— 03 / log',
  updatesTitle: '近期動態',
  updatesCta: '所有動態',
};

// ─── 首頁 EN ───
const pageHomeEn = {
  heroLabel: '—— vol. 00 · personal site · 2026',
  heroTitle: 'A story still being written.',
  heroSubtitle:
    "I'm Bernie Yen — a full-stack developer & creator from Taiwan. I use code, music, words, and pixels to slowly bring the story in my heart to life.",
  heroCta1: 'View work',
  heroCta2: 'Enter Imaginary Space',
  projectsLabel: '—— 01 / selected work',
  projectsTitle: 'Selected Work',
  projectsCta: 'View all',
  aboutLabel: '—— 02 / about',
  aboutTitle: 'About Me',
  aboutContent:
    "I don't want to be constrained by anything — I seek a free and open environment.\n\nOf course, it still sounds like a fantasy, but that's exactly why I keep pushing forward.\n\nA story lives in my heart, and finding a way to bring it to life is the ultimate goal I pursue.",
  aboutCta: 'Full bio',
  updatesLabel: '—— 03 / log',
  updatesTitle: 'Recent Log',
  updatesCta: 'All updates',
};

// ─── 作品頁 ZH ───
const pageProjectsZh = {
  heroLabel: '—— 02 / projects · 作品目錄',
  heroTitle: '我做過的所有東西。',
  heroSubtitle:
    '程式、世界觀、遊戲、工具 — 全部攤開列在這份目錄裡。點任何一個進去看詳細紀錄。',
  bottomLabel: '—— next · 進行中',
  bottomTitle: '還有些東西躺在抽屜裡',
  bottomSubtitle: '桌面型 AI、世界觀腳本、新一輪 OST、像素場景集 — 都還在寫。',
  bottomCta: '看動態',
};

// ─── 作品頁 EN ───
const pageProjectsEn = {
  heroLabel: '—— 02 / projects · project catalog',
  heroTitle: "Everything I've built.",
  heroSubtitle:
    'Code, worldbuilding, games, tools — all laid out in this catalog. Click any entry for full details.',
  bottomLabel: '—— next · in progress',
  bottomTitle: 'More things sitting in the drawer',
  bottomSubtitle:
    'Desktop AI, worldbuilding scripts, new OST batch, pixel scene packs — all in progress.',
  bottomCta: 'View updates',
};

// ─── 動態頁 ZH ───
const pageUpdatesZh = {
  heroLabel: '—— 04 / updates · 邊際的草稿',
  heroTitle: '我做了什麼事。',
  heroSubtitle:
    '里程碑、上線通知、寫作進度、曲子釋出 — 按時間倒著排。想知道最近在忙什麼，看這裡。',
};

// ─── 動態頁 EN ───
const pageUpdatesEn = {
  heroLabel: '—— 04 / updates · journal',
  heroTitle: "What I've been up to.",
  heroSubtitle:
    "Milestones, ship notes, writing progress, music releases — reverse chronological. See what I've been working on.",
};

// ─── 連結頁 ZH ───
const pageLinksZh = {
  heroLabel: '—— 05 / links · 對外連結',
  heroTitle: '你能在哪裡找到我。',
  heroSubtitle:
    '所有對外連結都收在這頁 — 程式、創作、世界觀、夥伴與聯絡方式。一個 hub，少一點四散。',
  bottomTitle: '有些東西還沒放上來',
  bottomSubtitle:
    'Bandcamp / itch.io / 某些 deprecated 的舊作 — 都還在整理。如果你在找特定東西，直接寫信問會更快。',
  bottomCta: '寫信問',
};

// ─── 連結頁 EN ───
const pageLinksEn = {
  heroLabel: '—— 05 / links · external links',
  heroTitle: 'Where to find me.',
  heroSubtitle:
    'All external links are collected here — code, creative, worldbuilding, allies and contact. One hub, less scattering.',
  bottomTitle: 'Some things are not listed yet',
  bottomSubtitle:
    'Bandcamp, itch.io, and some deprecated old works are still being organized. If you are looking for something specific, email me directly.',
  bottomCta: 'Ask via email',
};

// ─── About / Contact hero 文字 ───
const pageAboutZh = {
  heroLabel: '—— 03 / about · 個人簡介',
  heroTitle:
    '有一個<br /><span style="color: var(--q-navy); font-weight: 600;">尚未完成</span>的<br />故事存在著。',
  heroIntro:
    '我的本名是顏榕嶙，台灣人。這頁是我給自己留下的一份備忘錄 — 也讓走過的人，對「顏榕嶙是誰」有更完整的印象。',
};

const pageAboutEn = {
  heroLabel: '—— 03 / about · personal profile',
  heroTitle:
    'A story <br /><span style="color: var(--q-navy); font-weight: 600;">not yet finished</span><br />exists.',
  heroIntro:
    'My name is Bernie Yen, from Taiwan. This page is a memo I left for myself — and for anyone passing through, a fuller picture of who I am.',
};

const pageContactZh = {
  heroLabel: '—— 06 / contact · 寫信給我',
  heroTitle:
    '來說<span style="color: var(--q-navy); font-weight: 600;">你的</span>故事。',
  heroIntro:
    '合作邀約、聲音作品、文字、世界觀討論、或單純打聲招呼 — 都歡迎。我會盡量在 48 小時內回。',
};

const pageContactEn = {
  heroLabel: '—— 06 / contact · reach out',
  heroTitle:
    'Tell me <span style="color: var(--q-navy); font-weight: 600;">your</span> story.',
  heroIntro:
    "Collaborations, music, writing, worldbuilding discussions, or just saying hi — all welcome. I'll try to reply within 48 hours.",
};

// ─── 寫入 D1 ───
const singletons = [
  ['page-home-zh', pageHomeZh],
  ['page-home-en', pageHomeEn],
  ['page-projects-zh', pageProjectsZh],
  ['page-projects-en', pageProjectsEn],
  ['page-updates-zh', pageUpdatesZh],
  ['page-updates-en', pageUpdatesEn],
  ['page-links-zh', pageLinksZh],
  ['page-links-en', pageLinksEn],
  ['page-about-zh', pageAboutZh],
  ['page-about-en', pageAboutEn],
  ['page-contact-zh', pageContactZh],
  ['page-contact-en', pageContactEn],
];

const statements = singletons.map(([key, data]) => {
  const json = JSON.stringify(data).replace(/'/g, "''");
  return `INSERT OR REPLACE INTO root_singletons (section_id, content, updated_at) VALUES ('${key}', '${json}', datetime('now'));`;
});

const tmpFile = join(process.cwd(), 'scripts', '_tmp_seed_page_text.sql');
writeFileSync(tmpFile, statements.join('\n'), 'utf-8');

const remoteFlag = isRemote ? ' --remote' : ' --local';
const cmd = `npx wrangler d1 execute eternity-content${remoteFlag} --file="${tmpFile}"`;

console.log(`\n📋 Seeding page text singletons`);
console.log(`   Mode: ${isRemote ? '🌐 Remote' : '💻 Local'} D1\n`);

try {
  execSync(cmd, { cwd: WORKER_DIR, encoding: 'utf-8', stdio: 'pipe' });
  console.log('✅ Successfully seeded:');
  singletons.forEach(([key]) => console.log(`   - ${key}`));
} catch (e) {
  // wrangler 有時候回傳非零 exit code 但實際上已成功
  if (e.stdout?.includes('command executed successfully')) {
    console.log('✅ Successfully seeded:');
    singletons.forEach(([key]) => console.log(`   - ${key}`));
  } else {
    console.error('❌ Seed failed:', e.message);
    process.exit(1);
  }
}

try {
  unlinkSync(tmpFile);
} catch {}
