/**
 * 載入根目錄 `.env` 到 process.env
 *
 * 為什麼需要這支：Astro／Vite 會自動吃 `.env`，但**獨立執行的 node 腳本
 * 不會**。於是 `resolveWriteToken()` 讀 `process.env.API_TOKEN` 時，
 * 就算 `.env` 裡寫了也永遠讀不到——症狀是「明明設了卻還是要我登入」。
 *
 * 刻意**不覆蓋**已存在的環境變數：shell 上臨時指定的值應該贏過檔案，
 * 這樣才能用 `API_TOKEN=xxx pnpm sync` 一次性換 token 而不必改檔案。
 *
 * 只處理最基本的 KEY=VALUE：這是給自己專案的 .env 用的，不是要當
 * dotenv 的替代品。多行值、變數展開一律不支援。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '.env');

let loaded = false;

/**
 * 讀取根目錄 .env 並填入 process.env（已存在的 key 不動）。
 * 冪等——重複呼叫只會實際讀檔一次。
 */
export function loadRootEnv() {
  if (loaded) return;
  loaded = true;

  let raw;
  try {
    raw = fs.readFileSync(ENV_PATH, 'utf8');
  } catch {
    return; // 沒有 .env 是正常情況（CI／乾淨 clone）
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(eq + 1).trim();
    // 去掉成對的包圍引號（值本身含引號時不動）
    if (value.length >= 2) {
      const q = value[0];
      if ((q === '"' || q === "'") && value.endsWith(q)) {
        value = value.slice(1, -1);
      }
    }
    process.env[key] = value;
  }
}

/** 供只想知道路徑的呼叫端（錯誤訊息指路用） */
export const ROOT_ENV_PATH = ENV_PATH;
