#!/usr/bin/env node
/**
 * pnpm act — 常用腳本的互動式入口
 *
 * 把 package.json 裡四十幾條 script 收成分類選單，省得每次翻 README 或
 * 靠記憶打指令。純 node + readline，不引入任何互動選單套件。
 *
 * 設計取捨：
 * - **不自動偵測 script 清單**。自動列舉會把 `sync:push` 跟 `format` 並排
 *   成一樣的東西，而它們的後果差了好幾個數量級。這份清單是手寫的，因為
 *   「哪些危險、哪些需要 server 先起來」只有人知道。
 *   ⚠️ package.json 新增常用 script 時記得回來補一筆。
 * - **危險項一律二次確認**，且確認字串各不相同（要打的字就是後果本身），
 *   避免養成無腦按 y 的肌肉記憶。
 * - 子行程 stdio 全繼承——底下的腳本自己就有互動介面（sync 的差異確認、
 *   reset 的 RESET TEST 輸入），不能被這一層吃掉。
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import { ask } from './sync-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

/**
 * 標記說明：
 *   danger  — 會寫入正式環境或刪除資料，需二次確認（confirm 為要輸入的字串）
 *   needs   — 執行前必須先跑起來的東西（純提示，不強制檢查）
 *   slow    — 會跑很久，先讓人有心理準備
 */
const GROUPS = [
  {
    key: 'dev',
    title: '開發伺服器',
    items: [
      { cmd: 'dev', desc: '啟動兩站（root:4320、uep:4321）' },
      {
        cmd: 'pnpm --filter content-api-worker dev',
        raw: true,
        desc: 'content-api Worker（:8788）',
      },
      {
        cmd: 'pnpm --filter visitor-counter-worker dev',
        raw: true,
        desc: 'visitor-counter Worker（:8787）',
      },
      {
        cmd: 'dev:discord-widget',
        desc: 'Discord widget sync Worker（:8790）',
      },
    ],
  },
  {
    key: 'check',
    title: '品質檢查',
    items: [
      {
        cmd: 'check',
        desc: 'lint → 編碼 → typecheck → format → build（PR 前跑這個就好）',
        slow: true,
      },
      { cmd: 'lint', desc: 'ESLint' },
      { cmd: 'typecheck', desc: 'TypeScript 型別檢查' },
      { cmd: 'format', desc: 'Prettier 格式化（會改檔案）' },
      { cmd: 'format:check', desc: 'Prettier 只檢查不改' },
      { cmd: 'lint:encoding', desc: '原始碼編碼檢查（擋 NUL 等字元）' },
    ],
  },
  {
    key: 'test',
    title: '測試',
    items: [
      { cmd: 'test', desc: '前端單元測試' },
      { cmd: 'test:watch', desc: '前端單元測試（watch）' },
      { cmd: 'test:workers', desc: 'Worker 整合測試' },
      { cmd: 'test:all', desc: '單元 + Worker 全部', slow: true },
      {
        cmd: 'test:e2e',
        desc: 'E2E 煙霧測試',
        needs: '兩站 dev server + content-api',
        slow: true,
      },
      {
        cmd: 'test:e2e:stress',
        desc: 'E2E 壓力 + 效能門檻',
        needs: '兩站 dev server + content-api',
        slow: true,
      },
      {
        cmd: 'test:release',
        desc: 'Release 前完整測試',
        needs: '兩站 dev server + content-api',
        slow: true,
      },
      { cmd: 'test:load', desc: '負載測試（本地）', needs: 'content-api' },
      { cmd: 'test:load:staging', desc: '負載測試（staging）' },
    ],
  },
  {
    key: 'sync',
    title: '內容同步',
    items: [
      {
        cmd: 'sync',
        desc: '互動模式（顯示差異、逐一確認）',
        needs: 'content-api（本地 D1）',
      },
      { cmd: 'sync:docs', desc: '只同步文件站', needs: 'content-api' },
      { cmd: 'sync:root', desc: '只同步主站', needs: 'content-api' },
      {
        cmd: 'sync:push',
        desc: '本地 → 遠端（本地贏）',
        needs: 'content-api',
        danger: true,
        confirm: 'push',
        warn: '會用本地內容覆蓋遠端，遠端較新的改動一律丟棄。',
      },
      {
        cmd: 'sync:pull',
        desc: '遠端 → 本地（遠端贏）',
        needs: 'content-api',
        danger: true,
        confirm: 'pull',
        warn: '會用遠端內容覆蓋本地，本地未推的改動一律丟棄。',
      },
    ],
  },
  {
    key: 'db',
    title: '資料庫與衍生表',
    items: [
      { cmd: 'db:migrate:local', desc: '套用 migration（本地）' },
      {
        cmd: 'db:migrate:test',
        desc: '套用 migration（test）',
        danger: true,
        confirm: 'test',
        warn: '會改動 test D1 的結構。',
      },
      {
        cmd: 'db:migrate:remote',
        desc: '套用 migration（正式）',
        danger: true,
        confirm: 'remote',
        warn: '會改動正式 D1 的結構，且不可自動回復。',
      },
      {
        cmd: 'interlink:reindex:local',
        desc: '補建互聯衍生表（本地）',
        needs: 'content-api',
      },
      { cmd: 'interlink:reindex:test', desc: '補建互聯衍生表（test）' },
      {
        cmd: 'interlink:reindex:remote',
        desc: '補建互聯衍生表（正式）',
        danger: true,
        confirm: 'reindex remote',
        warn: '會對正式 worker 發出寫入，重建 history_interlink_index 與 story_points；腳本本身不再確認。',
      },
    ],
  },
  {
    key: 'testenv',
    title: '測試環境',
    items: [
      { cmd: 'test:seed', desc: '從正式環境增量 seed test D1' },
      {
        cmd: 'test:fixtures',
        desc: '灌入進度系統驗收素材（section/song/gallery/stuff/concepts）',
      },
      {
        cmd: 'test:fixtures:dry',
        desc: '驗收素材 dry-run（只列出要寫什麼）',
      },
      {
        cmd: 'test:reset',
        desc: '清空並重建 test D1',
        danger: true,
        confirm: 'reset test',
        warn: 'test D1 的業務資料會被清空後重種，過程中的編輯全部消失。',
      },
    ],
  },
  {
    key: 'deploy',
    title: '部署',
    items: [
      {
        cmd: 'deploy:content-api',
        desc: '部署 content-api Worker（正式）',
        danger: true,
        confirm: 'deploy',
        warn: '正式站會立刻換成目前這份程式碼。',
      },
      {
        cmd: 'deploy:content-api:test',
        desc: '部署 content-api Worker（test）',
      },
      {
        cmd: 'deploy:visitor',
        desc: '部署 visitor-counter Worker（正式）',
        danger: true,
        confirm: 'deploy',
        warn: '正式站會立刻換成目前這份程式碼。',
      },
      {
        cmd: 'deploy:discord-widget',
        desc: '部署 Discord widget sync Worker（正式）',
        danger: true,
        confirm: 'deploy',
        warn: '正式站會立刻換成目前這份程式碼。',
      },
    ],
  },
  {
    key: 'asset',
    title: '資產與效能',
    items: [
      { cmd: 'build:art', desc: '產出 U.E.P 差分素材' },
      { cmd: 'build:art:dry', desc: '產出差分素材（dry-run）' },
      {
        cmd: 'optimize:assets',
        desc: '最佳化 R2 資產（正式）',
        danger: true,
        confirm: 'optimize',
        warn: '會對正式 R2 上傳最佳化版本並刪除原檔；腳本本身不再確認。先跑 dry-run。',
      },
      { cmd: 'optimize:assets:dry', desc: '最佳化 R2 資產（dry-run）' },
      { cmd: 'perf', desc: '節流效能量測（行動版）', slow: true },
      { cmd: 'perf:desktop', desc: '節流效能量測（桌面）', slow: true },
    ],
  },
];

/** 把選項攤平成一份帶編號的清單，供搜尋與直接輸入指令名使用 */
const ALL_ITEMS = GROUPS.flatMap((g) =>
  g.items.map((it) => ({ ...it, group: g.title }))
);

function label(it) {
  const marks = [];
  if (it.danger) marks.push(`${C.red}危險${C.reset}`);
  if (it.needs) marks.push(`${C.yellow}需 ${it.needs}${C.reset}`);
  if (it.slow) marks.push(`${C.dim}耗時${C.reset}`);
  return marks.length ? ` ${marks.join(' ')}` : '';
}

function printGroups() {
  console.log(`\n${C.bold}  Eternity — 常用腳本${C.reset}\n`);
  GROUPS.forEach((g, i) => {
    console.log(
      `    ${C.cyan}[${i + 1}]${C.reset} ${g.title}  ${C.dim}(${g.items.length})${C.reset}`
    );
  });
  console.log(
    `\n    ${C.dim}輸入編號選分類，或直接打 script 名稱（如 test:all）${C.reset}`
  );
  console.log(`    ${C.dim}輸入關鍵字可搜尋，q 離開${C.reset}\n`);
}

function printItems(group) {
  console.log(`\n${C.bold}  ${group.title}${C.reset}\n`);
  group.items.forEach((it, i) => {
    const name = it.raw ? it.cmd : `pnpm ${it.cmd}`;
    console.log(`    ${C.cyan}[${i + 1}]${C.reset} ${name}${label(it)}`);
    console.log(`        ${C.dim}${it.desc}${C.reset}`);
  });
  console.log(`\n    ${C.dim}b 返回，q 離開${C.reset}\n`);
}

function printMatches(matches) {
  console.log(`\n${C.bold}  符合的項目${C.reset}\n`);
  matches.forEach((it, i) => {
    const name = it.raw ? it.cmd : `pnpm ${it.cmd}`;
    console.log(
      `    ${C.cyan}[${i + 1}]${C.reset} ${name}${label(it)}  ${C.dim}${it.group}${C.reset}`
    );
    console.log(`        ${C.dim}${it.desc}${C.reset}`);
  });
  console.log(`\n    ${C.dim}b 返回，q 離開${C.reset}\n`);
}

/** 執行一條指令，stdio 全繼承（底下的腳本自己有互動介面） */
function run(item) {
  const display = item.raw ? item.cmd : `pnpm ${item.cmd}`;
  console.log(`\n${C.green}▸ ${display}${C.reset}\n`);

  const [file, ...args] = item.raw
    ? item.cmd.split(' ')
    : ['pnpm', ...item.cmd.split(' ')];

  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('close', (code) => {
      console.log(
        code === 0
          ? `\n${C.green}✓ 完成${C.reset}\n`
          : `\n${C.red}✗ 結束碼 ${code}${C.reset}\n`
      );
      resolve(code);
    });
    child.on('error', (err) => {
      console.error(`\n${C.red}✗ 無法執行：${err.message}${C.reset}\n`);
      resolve(1);
    });
  });
}

/** 危險項的二次確認——要輸入的字串就是後果本身，不是一律 y */
async function confirmDanger(item) {
  console.log(`\n${C.red}${C.bold}  ⚠ ${item.warn}${C.reset}`);
  const answer = await ask(
    `    確認請輸入 ${C.bold}${item.confirm}${C.reset}（其他任意鍵取消）： `,
    { lowercase: true }
  );
  if (answer !== item.confirm) {
    console.log(`\n${C.dim}  已取消。${C.reset}\n`);
    return false;
  }
  return true;
}

async function execute(item) {
  if (item.danger && !(await confirmDanger(item))) return;
  await run(item);
}

async function main() {
  // 直接帶參數：pnpm act test:all → 跳過選單
  const direct = process.argv.slice(2).join(' ').trim();
  if (direct) {
    const hit = ALL_ITEMS.find((it) => it.cmd === direct);
    if (hit) {
      await execute(hit);
      return;
    }
    console.error(
      `\n${C.red}  找不到 "${direct}"${C.reset}${C.dim}（改用選單）${C.reset}`
    );
  }

  if (!process.stdin.isTTY) {
    console.error(
      `\n${C.red}  act 需要互動式終端。${C.reset}` +
        `${C.dim}\n  在管線／CI 裡請直接呼叫對應的 pnpm script。${C.reset}\n`
    );
    process.exit(1);
  }

  let current = null;

  for (;;) {
    if (current) printItems(current);
    else printGroups();

    const input = await ask('  > ', { lowercase: false });
    const lower = input.toLowerCase();

    if (lower === 'q' || lower === 'quit' || lower === 'exit') {
      console.log(`\n${C.dim}  bye.${C.reset}\n`);
      return;
    }
    if (lower === 'b' || lower === 'back') {
      current = null;
      continue;
    }
    if (!input) continue;

    // 分類內：數字選項目
    if (current) {
      const idx = Number(input);
      if (Number.isInteger(idx) && idx >= 1 && idx <= current.items.length) {
        await execute(current.items[idx - 1]);
        continue;
      }
      console.log(
        `\n${C.red}  請輸入 1-${current.items.length}，或 b / q${C.reset}`
      );
      continue;
    }

    // 頂層：數字選分類
    const idx = Number(input);
    if (Number.isInteger(idx) && idx >= 1 && idx <= GROUPS.length) {
      current = GROUPS[idx - 1];
      continue;
    }

    // 頂層：完整 script 名稱直接跑
    const exact = ALL_ITEMS.find((it) => it.cmd === input);
    if (exact) {
      await execute(exact);
      continue;
    }

    // 頂層：關鍵字搜尋（比對指令名與說明）
    const matches = ALL_ITEMS.filter(
      (it) =>
        it.cmd.toLowerCase().includes(lower) ||
        it.desc.toLowerCase().includes(lower)
    );
    if (matches.length === 0) {
      console.log(`\n${C.red}  找不到符合 "${input}" 的項目${C.reset}`);
      continue;
    }
    if (matches.length === 1) {
      await execute(matches[0]);
      continue;
    }

    printMatches(matches);
    const pick = await ask('  > ', { lowercase: true });
    if (pick === 'b' || pick === 'q') {
      if (pick === 'q') {
        console.log(`\n${C.dim}  bye.${C.reset}\n`);
        return;
      }
      continue;
    }
    const pickIdx = Number(pick);
    if (
      Number.isInteger(pickIdx) &&
      pickIdx >= 1 &&
      pickIdx <= matches.length
    ) {
      await execute(matches[pickIdx - 1]);
    }
  }
}

main().catch((err) => {
  console.error(`\n${C.red}  act 發生未預期錯誤：${err.message}${C.reset}\n`);
  process.exit(1);
});
