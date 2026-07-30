/**
 * 旗標 DevTools actions（S10-3 T-A8）
 *
 * 動機：`progress:grant-flags` 是自由輸入框——要授予什麼得先自己記得旗標
 * 叫什麼。有了註冊表（`uep_flags`）之後可以直接列出來選，也能一次模擬
 * 「全都持有」或「全部清掉」，驗收 gate 時省下反覆手打。
 *
 * 與「進度系統」群組的分工：
 * - `progress:grant-flags`／`revoke-flags` = 自由輸入，可以打**還沒註冊**的
 *   旗標（測試打錯字的症狀時仍需要），刻意保留
 * - 這裡的授予／撤銷 = 從註冊表或目前持有清單選，不會拼錯
 *
 * ⚠️ 分組（自動生成／自訂／未註冊）一律走 worker 的 `/api/flags/audit`，
 * 不在前端重寫形狀判斷。判定 derived 形狀的權威是 `flags-scan.ts` 的
 * `classifyFlag`，而形狀清單的權威又是各產生端函式的 return——在前端多寫
 * 一份等於再開一個會漂移的事實來源（2026-07-30 的 image 旗標形狀事故就是
 * 照抄摘要表抄出來的）。
 *
 * 註冊表端點掛 `isAuthorized`，走同源 SSR proxy `/api/flags/*`（proxy 從
 * httpOnly cookie 補 Bearer）。所以這一組 action **需要同一個瀏覽器已登入
 * `/admin`**；沒登入時 worker 回 401，各 action 會明確講出原因而不是靜默失敗。
 */

import {
  buildTreeIndex,
  fetchHistoryTree,
  type HistoryTreeIndex,
} from '../../islands/history/historyIslandData';
import {
  COMPLETION_FLAG_PREFIX,
  effectiveGate,
  evaluateEffectiveGate,
  isEffectivelyCompleted,
  isPristine,
} from '../../progress';
import { getRegistry } from '../actionRegistry';

const GROUP = '旗標';
const LOG = '[UEP Flags]';

/** 註冊表的一列（只取這一組 action 用得到的欄位） */
interface FlagRegistryRow {
  name: string;
  label: string | null;
  category: string | null;
}

/** 巡查清單的一列（同上） */
interface FlagAuditRow {
  name: string;
  source: 'registered' | 'derived' | 'unregistered';
  label: string | null;
}

/**
 * 打同源 proxy 並解包 `{ ok, data }`。
 *
 * 401／403 特別點名：這一組 action 最常見的失敗就是「忘了先登入 admin」，
 * 而 proxy 只是原樣轉發 worker 的狀態碼，訊息本身看不出是權限問題。
 */
async function fetchFlagsApi<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(path);
  } catch (err) {
    console.error(`${LOG} ${path} 連線失敗`, err);
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    console.warn(
      `${LOG} ${path} 回 ${res.status}——旗標端點是 admin only，請先在同一個瀏覽器登入 /admin 再回來（本機 dev worker 會直接放行）`
    );
    return null;
  }
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: T;
    error?: string;
  } | null;
  if (!json?.ok) {
    console.error(
      `${LOG} ${path} 失敗：${json?.error ?? `HTTP ${res.status}`}`
    );
    return null;
  }
  return json.data ?? null;
}

async function loadRegistry(): Promise<FlagRegistryRow[] | null> {
  const data = await fetchFlagsApi<{ flags: FlagRegistryRow[] }>('/api/flags');
  return data?.flags ?? null;
}

async function loadAudit(): Promise<FlagAuditRow[] | null> {
  const data = await fetchFlagsApi<{ flags: FlagAuditRow[] }>(
    '/api/flags/audit'
  );
  return data?.flags ?? null;
}

/** 有標籤就一併顯示，方便從一堆 kebab-case 裡認出想要的那個 */
function describe(row: { name: string; label?: string | null }): string {
  return row.label ? `${row.name}（${row.label}）` : row.name;
}

/**
 * 從清單選一項：編號表印在 console，prompt 只收編號或完整名稱。
 *
 * 不把清單塞進 prompt 內文——旗標動輒數十筆，prompt 的多行文字不可滾動，
 * 超出的部分在有些瀏覽器上直接看不到。
 */
function pickFromList(
  rows: Array<{ name: string; label?: string | null }>,
  title: string
): string | null {
  if (rows.length === 0) {
    console.warn(`${LOG} ${title}：清單是空的`);
    return null;
  }
  console.log(
    `${LOG} ${title}\n` +
      rows.map((row, i) => `  ${i + 1}. ${describe(row)}`).join('\n')
  );
  const raw = window.prompt(
    `${title}\n輸入編號 1–${rows.length}（完整清單見 console），或直接貼旗標名`,
    '1'
  );
  if (raw === null) return null;
  const input = raw.trim();
  if (!input) return null;

  const index = Number(input);
  if (Number.isInteger(index) && index >= 1 && index <= rows.length) {
    return rows[index - 1].name;
  }
  // 允許直接貼名稱：清單可能很長，知道叫什麼的時候不必去數編號
  const hit = rows.find((row) => row.name === input);
  if (hit) return hit.name;
  console.warn(`${LOG} 「${input}」不在清單裡，也不是合法編號`);
  return null;
}

/** 目前的 progress state；store 還沒就緒時回 null 並說明 */
function requireState() {
  const state = window.__uepProgress?.getState();
  if (!state) {
    console.warn(`${LOG} progress store 尚未就緒（通常 hydrate 完就會有）`);
    return null;
  }
  return state;
}

/* ── gate 求值 ── */

/**
 * 目前正在看的 History 頁 id。
 *
 * Reader 是單一路由 SPA，子頁靠 `?page=` 帶。不在 `/history` 或沒帶 param
 * 時回 null，由呼叫端 prompt 補——DevTools 面板在全站都開得起來。
 */
function currentHistoryPageId(): string | null {
  const onHistory = window.location.pathname.replace(/\/$/, '') === '/history';
  if (!onHistory) return null;
  const slug = new URL(window.location.href).searchParams.get('page');
  if (!slug) return null;
  return slug.startsWith('history/') ? slug : `history/${slug}`;
}

/** 逐項印出 gate 的每個條件目前通不通過 */
function reportGate(pageId: string, index: HistoryTreeIndex): void {
  const state = requireState();
  if (!state) return;

  const node = index.nodesById.get(pageId);
  if (!node) {
    console.warn(
      `${LOG} tree 裡沒有 ${pageId}——可能是 id 打錯，或這頁 hidden（buildTreeIndex 會濾掉）`
    );
    return;
  }

  const gate = effectiveGate(pageId, index.adapter);
  console.log(`${LOG} gate 求值 ${pageId}（${node.title}）`);
  console.log('  視角:', state.view, isPristine(state) ? '｜純潔者' : '');

  if (!gate) {
    console.log('  有效條件: 無（無限制，一律可讀）');
    return;
  }
  console.log('  有效條件:', gate);

  // 四維條件是 AND 聯集：progressPage 鏈與容器繼承已由 effectiveGate 併入
  // requiresFlags，所以這裡只需分「完成依賴」與「自訂旗標」兩種比對方式
  for (const flag of gate.requiresFlags ?? []) {
    if (flag.startsWith(COMPLETION_FLAG_PREFIX)) {
      const depId = flag.slice(COMPLETION_FLAG_PREFIX.length);
      const done = isEffectivelyCompleted(depId, state, index.adapter);
      // 「有效完成」是遞迴的：有 completed 旗標但自己解不開的頁面不算完成
      console.log(
        `  ${done ? '✓' : '✗'} ${flag}（完成依賴｜遞迴驗證${done ? '通過' : '未過'}）`
      );
    } else {
      const held = state.flags.includes(flag);
      console.log(
        `  ${held ? '✓' : '✗'} ${flag}（自訂旗標｜${held ? '持有' : '未持有'}）`
      );
    }
  }
  if (gate.pristineOnly) {
    const ok = isPristine(state);
    console.log(
      `  ${ok ? '✓' : '✗'} pristineOnly（純潔者限定｜觀測者印記${state.observerEver ? '已留下' : '無'}）`
    );
  }

  const visible = evaluateEffectiveGate(pageId, state, index.adapter, gate);
  const bypassed =
    state.view === 'observer' && (gate.requiresFlags?.length ?? 0) > 0;
  console.log(
    `  結論: ${visible ? '可讀' : '鎖住'}${bypassed ? '（觀測者 bypass 了旗標條件；pristineOnly 不受 bypass）' : ''}`
  );
}

export function registerFlagActions(): void {
  const registry = getRegistry();
  registry.register([
    {
      group: GROUP,
      id: 'flags:dump-held',
      label: '傾印目前持有旗標（依來源分組）',
      description:
        '自動生成／已註冊自訂／未註冊三組，分類直接取 /api/flags/audit',
      execute: async () => {
        const state = requireState();
        if (!state) return;
        const held = [...state.flags].sort();
        console.log(`${LOG} 目前持有 ${held.length} 個旗標`);

        const audit = await loadAudit();
        if (!audit) {
          // 註冊表讀不到時仍印清單——分組是加值，不是這個 action 的全部
          console.log(`${LOG} 無法分組，改印原始清單:`, held);
          return;
        }
        const sourceOf = new Map(audit.map((row) => [row.name, row.source]));
        const groups: Record<string, string[]> = {
          '自動生成（derived）': [],
          '自訂・已註冊': [],
          未註冊: [],
        };
        for (const flag of held) {
          const source = sourceOf.get(flag);
          if (source === 'derived') groups['自動生成（derived）'].push(flag);
          else if (source === 'registered') groups['自訂・已註冊'].push(flag);
          // audit 沒收錄的一律歸未註冊：audit 已經把註冊表整份併進來了，
          // 查不到就代表既不在註冊表也沒出現在任何頁面內容裡
          else groups['未註冊'].push(flag);
        }
        for (const [label, flags] of Object.entries(groups)) {
          console.log(`  ${label}（${flags.length}）`, flags);
        }
      },
    },
    {
      group: GROUP,
      id: 'flags:grant-from-registry',
      label: '從註冊表選一個旗標授予',
      description:
        '列出 uep_flags 供選，不必自己記名字（自由輸入版在「進度系統」）',
      execute: async () => {
        const rows = await loadRegistry();
        if (!rows) return;
        const name = pickFromList(rows, '選要授予的旗標');
        if (!name) return;
        window.__uepProgress?.grantFlags([name]);
        console.log(`${LOG} 已授予 ${name}`);
      },
    },
    {
      group: GROUP,
      id: 'flags:revoke-held',
      label: '從目前持有的旗標選一個撤銷',
      description: '清單來源是 progress state，含自動生成的旗標',
      execute: () => {
        const state = requireState();
        if (!state) return;
        const rows = [...state.flags].sort().map((name) => ({ name }));
        const name = pickFromList(rows, '選要撤銷的旗標');
        if (!name) return;
        window.__uepProgress?.revokeFlags([name]);
        console.log(`${LOG} 已撤銷 ${name}`);
      },
    },
    {
      group: GROUP,
      id: 'flags:grant-all-registered',
      label: '模擬持有全部註冊旗標',
      description: '只授予註冊表裡的自訂旗標，不含 completed:* 等自動旗標',
      requiresConfirm: true,
      confirmMessage:
        '把註冊表裡全部自訂旗標一次授予？（自動生成的旗標不受影響，要模擬讀完進度請用「標記頁面完成」）',
      execute: async () => {
        const rows = await loadRegistry();
        if (!rows) return;
        if (rows.length === 0) {
          console.warn(`${LOG} 註冊表是空的，沒有東西可授予`);
          return;
        }
        const names = rows.map((row) => row.name);
        window.__uepProgress?.grantFlags(names);
        console.log(`${LOG} 已授予 ${names.length} 個註冊旗標`, names);
      },
    },
    {
      group: GROUP,
      id: 'flags:clear-custom',
      label: '清空自訂旗標（保留自動生成的）',
      description:
        '撤銷 audit 判為 registered／unregistered 的旗標，completed:* 等維持不動',
      destructive: true,
      requiresConfirm: true,
      confirmMessage:
        '撤銷全部自訂旗標？自動生成的旗標（completed:*、*:song 等）會保留，所以閱讀進度不會被清掉。',
      execute: async () => {
        const state = requireState();
        if (!state) return;
        const audit = await loadAudit();
        if (!audit) {
          // 沒有 audit 就無法區分自動與自訂，寧可不動也不要連進度一起清掉
          console.warn(`${LOG} 讀不到分類，中止——避免誤撤自動生成的旗標`);
          return;
        }
        const derived = new Set(
          audit.filter((row) => row.source === 'derived').map((row) => row.name)
        );
        const drop = state.flags.filter((flag) => !derived.has(flag));
        if (drop.length === 0) {
          console.log(`${LOG} 目前沒有自訂旗標`);
          return;
        }
        window.__uepProgress?.revokeFlags(drop);
        console.log(`${LOG} 已撤銷 ${drop.length} 個自訂旗標`, drop);
      },
    },
    {
      group: GROUP,
      id: 'flags:evaluate-gate',
      label: '求值目前頁面的 gate 條件',
      description:
        '逐項列出四維條件通過狀態（完成依賴走遞迴驗證）；不在 History 頁時詢問 pageId',
      execute: async () => {
        let pageId = currentHistoryPageId();
        if (!pageId) {
          const raw = window.prompt(
            '目前不在 History 的內容頁。輸入要求值的 pageId（例：history/chapter-1-arc-1-section-2）',
            window.__uepProgress?.getState().lastVisitedPageId ?? 'history/'
          );
          if (!raw?.trim()) return;
          pageId = raw.trim();
        }
        // 與 HistoryReader／浮島同一份 tree 與 adapter（含模組級快取），
        // gate 語意不可能分岔
        const index = buildTreeIndex(await fetchHistoryTree());
        reportGate(pageId, index);
      },
    },
  ]);
}
