/**
 * UEP 本機儲存命名空間 — 行為測試 + **命名規約契約測試**
 *
 * 後半段（「命名規約契約」describe）是這個檔案存在的主要理由：
 * `wipeAllUepStorage()` 靠掃描 `uep.` / `uep-` 前綴來清除，命名空間外的
 * key 會被靜默漏掉。歷史上就有三把漏網的（`history-sidebar`、
 * `reading-resume-jump`、`ned-recent-icons`），靠人工 review 抓不住。
 *
 * 因此這裡直接掃原始碼：任何人新增 storage key 而沒用 UEP 前綴，
 * 這個測試就會紅，並在錯誤訊息裡告訴他該怎麼辦。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  collectUepStorageKeys,
  isUepStorageKey,
  wipeAllUepStorage,
  wipeUepStorage,
} from '../uepStorage';

describe('isUepStorageKey', () => {
  it('認得兩種 UEP 前綴風格', () => {
    expect(isUepStorageKey('uep.progress.v1')).toBe(true);
    expect(isUepStorageKey('uep-player-volume')).toBe(true);
  });

  it('命名空間外一律不認', () => {
    expect(isUepStorageKey('history-sidebar')).toBe(false);
    expect(isUepStorageKey('ned-recent-icons')).toBe(false);
    expect(isUepStorageKey('theme')).toBe(false);
  });
});

describe('wipeUepStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('清除命名空間內的 key，不動其他人的', () => {
    localStorage.setItem('uep.progress.v1', 'a');
    localStorage.setItem('uep-player-volume', 'b');
    localStorage.setItem('someone-elses-key', 'c');

    const removed = wipeUepStorage(localStorage);

    expect(removed).toBe(2);
    expect(localStorage.getItem('uep.progress.v1')).toBeNull();
    expect(localStorage.getItem('uep-player-volume')).toBeNull();
    expect(localStorage.getItem('someone-elses-key')).toBe('c');
  });

  it('保留豁免 key（開發旗標／裝置偏好／admin 認證）', () => {
    localStorage.setItem('uep-devtools-force', '1');
    localStorage.setItem('uep-protection-force', '1');
    localStorage.setItem('uep-theme', 'dark');
    localStorage.setItem('uep-admin-token', 'tok');
    localStorage.setItem('uep.progress.v1', 'gone');

    wipeUepStorage(localStorage);

    expect(localStorage.getItem('uep-devtools-force')).toBe('1');
    expect(localStorage.getItem('uep-protection-force')).toBe('1');
    expect(localStorage.getItem('uep-theme')).toBe('dark');
    expect(localStorage.getItem('uep-admin-token')).toBe('tok');
    expect(localStorage.getItem('uep.progress.v1')).toBeNull();
  });

  it('訪客計數去重標記刻意不豁免（重置＝變回全新訪客）', () => {
    localStorage.setItem('uep-visitor-tracked', '1');
    wipeUepStorage(localStorage);
    expect(localStorage.getItem('uep-visitor-tracked')).toBeNull();
  });

  /**
   * 【回歸】邊迭代邊 removeItem 會讓 `storage.key(i)` 索引位移，
   * 造成隔一把漏刪——必須先收集再刪除。
   */
  it('連續多把 key 全數清除，不因索引位移漏刪', () => {
    for (let i = 0; i < 10; i += 1) {
      localStorage.setItem(`uep.bulk.${i}`, String(i));
    }
    expect(collectUepStorageKeys(localStorage)).toHaveLength(10);

    wipeUepStorage(localStorage);

    expect(collectUepStorageKeys(localStorage)).toHaveLength(0);
    expect(localStorage.length).toBe(0);
  });

  it('wipeAllUepStorage 同時處理 local 與 session', () => {
    localStorage.setItem('uep.progress.v1', 'a');
    sessionStorage.setItem('uep.welcome.pending.v1', 'b');
    sessionStorage.setItem('uep.storage.jumpToPinned', 'c');

    const removed = wipeAllUepStorage();

    expect(removed).toBe(3);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('動態組出來的 key 也涵蓋（浮島視窗／echo spot）', () => {
    localStorage.setItem('uep.islands.v1.history', '{}');
    sessionStorage.setItem('uep.echo-spot.triggered.page-1.spot-a', '1');

    wipeAllUepStorage();

    expect(localStorage.getItem('uep.islands.v1.history')).toBeNull();
    expect(
      sessionStorage.getItem('uep.echo-spot.triggered.page-1.spot-a')
    ).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────
 * 命名規約契約測試
 * ──────────────────────────────────────────────────────────────── */

/** 已知且**刻意**留在 UEP 命名空間外的 key，新增前請先想清楚。 */
const KNOWN_NON_UEP_KEYS = new Map<string, string>([
  [
    'ned-recent-icons',
    'admin 編輯器的最近使用圖示——屬編輯者偏好，不該被讀者身分重置波及',
  ],
]);

const SRC_ROOT = join(__dirname, '..', '..');

/** 遞迴列出所有原始碼檔（排除測試自身，測試裡本來就有大量假 key） */
function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      listSourceFiles(full, acc);
      continue;
    }
    if (/\.(ts|tsx|astro)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/** 直接把字面值傳給 storage API：`localStorage.setItem('foo', …)` */
const LITERAL_ACCESS =
  /(?:localStorage|sessionStorage)\s*\??\s*\.\s*(?:get|set|remove)Item\s*\(\s*(['"`])([^'"`\n]+)\1/g;

/** 以識別字取用：`localStorage.getItem(SOME_KEY)` → 收集識別字 */
const IDENT_ACCESS =
  /(?:localStorage|sessionStorage)\s*\??\s*\.\s*(?:get|set|remove)Item\s*\(\s*([A-Za-z_$][\w$]*)\s*[),]/g;

/** `const NAME = 'literal'` */
const CONST_LITERAL =
  /const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(['"`])([^'"`\n]+)\2/g;

/** `const NAME = isTestMode() ? 'a' : 'b'`（跨行） */
const CONST_TERNARY =
  /const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*isTestMode\(\)\s*\?\s*(['"`])([^'"`\n]+)\2\s*:\s*(['"`])([^'"`\n]+)\4/g;

interface FoundKey {
  key: string;
  file: string;
}

/** 從單一檔案抽出所有「確實被當作 storage key 使用」的字面值 */
function extractStorageKeys(source: string, file: string): FoundKey[] {
  const found: FoundKey[] = [];

  for (const m of source.matchAll(LITERAL_ACCESS)) {
    found.push({ key: m[2]!, file });
  }

  // 以常數取用的：先建同檔案的 常數名 → 字面值 對照，再用識別字反查
  const constValues = new Map<string, string[]>();
  for (const m of source.matchAll(CONST_LITERAL)) {
    constValues.set(m[1]!, [m[3]!]);
  }
  for (const m of source.matchAll(CONST_TERNARY)) {
    // 三元覆蓋掉 CONST_LITERAL 可能的部分匹配，兩個分支都要檢查
    constValues.set(m[1]!, [m[3]!, m[5]!]);
  }
  for (const m of source.matchAll(IDENT_ACCESS)) {
    const values = constValues.get(m[1]!);
    if (!values) continue; // 函式回傳或 import 進來的，交給定義處的檔案負責
    for (const value of values) found.push({ key: value, file });
  }

  return found;
}

describe('命名規約契約（掃描原始碼）', () => {
  const offenders: FoundKey[] = [];
  const seen = new Set<string>();

  for (const file of listSourceFiles(SRC_ROOT)) {
    for (const found of extractStorageKeys(
      readFileSync(file, 'utf8'),
      relative(SRC_ROOT, file).replace(/\\/g, '/')
    )) {
      if (isUepStorageKey(found.key)) continue;
      if (KNOWN_NON_UEP_KEYS.has(found.key)) continue;
      const dedupe = `${found.file}::${found.key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      offenders.push(found);
    }
  }

  it('所有 storage key 都落在 UEP 命名空間內（或已登記豁免）', () => {
    const detail = offenders
      .map((o) => `  - "${o.key}"  （${o.file}）`)
      .join('\n');
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            '',
            '發現不在 UEP 命名空間內的 localStorage/sessionStorage key：',
            detail,
            '',
            'wipeAllUepStorage() 只掃描 "uep." / "uep-" 前綴，這些 key 會在',
            '「重置本機身分／完全重置」時被漏掉，變成跨帳號殘留的髒資料。',
            '',
            '請二選一：',
            '  (a) 把 key 改名為 uep. 或 uep- 開頭（多數情況的正解）',
            '  (b) 確認它不屬於讀者身分（例如 admin 編輯器偏好），',
            '      並登記到本檔的 KNOWN_NON_UEP_KEYS 並寫明理由',
            '',
          ].join('\n')
    ).toEqual([]);
  });

  it('掃描器本身有效——確實掃到了預期數量的 key', () => {
    // 防呆：若 regex 因重構失效而一無所獲，上面的測試會假性通過
    const all: FoundKey[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      all.push(
        ...extractStorageKeys(
          readFileSync(file, 'utf8'),
          relative(SRC_ROOT, file).replace(/\\/g, '/')
        )
      );
    }
    const unique = new Set(all.map((f) => f.key));
    expect(unique.size).toBeGreaterThan(10);
    // 幾把一定要掃得到的代表性 key
    expect(unique).toContain('uep.progress.v1');
    expect(unique).toContain('uep.onboarded.v1');
    expect(unique).toContain('ned-recent-icons');
  });
});
