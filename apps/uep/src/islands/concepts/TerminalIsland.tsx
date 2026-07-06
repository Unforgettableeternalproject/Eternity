/**
 * Terminal Island —「移動終端」（Epic 2 S7-C）
 *
 * Concepts 的隨身查詢介面：指令式檢索 dossier/diff 條目（互動式嵌入
 * 的落點）、獨立查詢 browser/chrono。不持有資料——索引與內容
 * 全部經 terminalCore 按需取得（設計文件 6-1）。
 *
 * 視覺語彙取自 Eternity-Design concepts-base.jsx 的 TerminalIsland
 * （行分色、prompt 列、suggested chips），功能優先——比照旅程之書，
 * 細節由艾斯維爾驗收時調。拖曳/收合由 DraggableIsland 外殼負責。
 *
 * 指令集（設計文件 6-3）：
 *   ?/help、query <kw>（裸關鍵字同 query）、ls <log|browser|clock|compare>、clear
 */

import React, { useEffect, useRef, useState } from 'react';

import { getProgressManager, useProgress } from '../../progress';

import { subscribeEntityActivate } from './terminalBridge';
import {
  TERMINAL_STACK_LABELS,
  completeInput,
  findByEntityKey,
  groupStackEntries,
  loadEntityIndex,
  passedRevisionCount,
  queryIndex,
  resolveEntryDetails,
  resolveStackAlias,
  significantChronoPeriods,
} from './terminalCore';
import type { TerminalIndexEntry } from './terminalCore';
import {
  MAX_TERM_LINES,
  clearTerminalLog,
  loadTerminalLog,
  saveTerminalLog,
} from './terminalLog';
import type { TermAction, TermLine } from './terminalLog';

import './TerminalIsland.css';

const BOOT_LINES: TermLine[] = [
  { kind: 'meta', text: 'uep.terminal v1.0 — 輸入 ? 查看指令' },
  { kind: 'meta', text: 'connected → concepts://*' },
];

/** ls 逐項列出的上限（其餘提示用 query 檢索） */
const LS_LIST_CAP = 30;

/** ls clock 顯著時代的列出數（事件較多 = 顯著，艾斯維爾定案 3~5 個） */
const CLOCK_HIGHLIGHT_LIMIT = 5;

const HELP_LINES: TermLine[] = [
  { kind: 'meta', text: '? · query <keyword> — 檢索人物 / 地點 / 術語' },
  { kind: 'meta', text: '  · ls <stack>      — 列出已解鎖條目' },
  { kind: 'meta', text: '        stack: log · browser · clock · compare' },
  { kind: 'meta', text: '  · clear           — 清空輸出' },
];

/**
 * 跳轉到 Concepts 頁面（entry 導向列用，比照 navigateToHistoryPage）：
 * - 已在 /concepts：pushState + 手動 dispatch popstate，讓 Reader 的
 *   useZoneRouter 接手載入（不整頁重載）
 * - 在其他頁面：整頁導航到 /concepts?page=...
 * 未解鎖頁由 ConceptsReader 的 deep link 守門處理（not-found 呈現）。
 */
function navigateToConceptsPage(pageId: string): void {
  const slug = pageId.startsWith('concepts/')
    ? pageId.slice('concepts/'.length)
    : pageId;
  const onConceptsPage =
    window.location.pathname.replace(/\/$/, '') === '/concepts';
  if (onConceptsPage) {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('page', slug);
    window.history.pushState({}, '', url.toString());
    window.dispatchEvent(new PopStateEvent('popstate'));
  } else {
    window.location.href = `/concepts?page=${encodeURIComponent(slug)}`;
  }
}

export default function TerminalIsland() {
  const progress = useProgress();
  // 輸出歷史持久化（S7-C 驗收定案）：mount 時還原上次內容，
  // 跨頁/收合/登出重登都不消失（本機 localStorage）
  const [lines, setLines] = useState<TermLine[]>(
    () => loadTerminalLog() ?? BOOT_LINES
  );
  const [input, setInput] = useState('');
  const [indexReady, setIndexReady] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** async 回呼取用最新進度（不重綁 listener） */
  const progressRef = useRef(progress);
  progressRef.current = progress;
  /** 清空式展現的一次性捲動目標（null = 照常捲到底） */
  const pendingAnchorRef = useRef<string | null>(null);
  const anchorSeqRef = useRef(0);

  /* Tab 補全 + ↑↓ 候選/歷史（S7-C 驗收回饋） */
  const [completion, setCompletion] = useState<{
    candidates: string[];
    index: number;
  } | null>(null);
  const historyRef = useRef<string[]>([]);
  const histIdxRef = useRef<number | null>(null);

  function append(add: TermLine[]) {
    setLines((prev) => [...prev, ...add].slice(-MAX_TERM_LINES));
  }

  /** data-driven action 的執行入口（rehydrate 後的列也走同一條路） */
  function runAction(action: TermAction) {
    if (action.type === 'show-entry') {
      void showDetails(action.entry);
    } else if (action.type === 'navigate') {
      navigateToConceptsPage(action.pageId);
    }
  }

  /** 取得索引；未就緒時輸出載入提示，失敗時輸出錯誤並回 null */
  async function ensureIndex(): Promise<TerminalIndexEntry[] | null> {
    if (!indexReady) {
      append([{ kind: 'meta', text: '[SYS] 索引載入中…' }]);
    }
    try {
      const entries = await loadEntityIndex();
      setIndexReady(true);
      return entries;
    } catch {
      append([{ kind: 'err', text: '× 索引載入失敗——與資料庫的連線中斷' }]);
      return null;
    }
  }

  /* mount：預熱索引 + 聚焦輸入列 */
  useEffect(() => {
    let cancelled = false;
    loadEntityIndex()
      .then(() => {
        if (!cancelled) setIndexReady(true);
      })
      .catch(() => {
        /* 失敗不在 mount 時報錯——首次指令會經 ensureIndex 呈現 */
      });
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  /* 輸出更新後捲動：有 pending anchor（entry 詳細內容）→ 該行置頂
     ——清空式展現（艾斯維爾定案：保留歷史、捲動置頂）；否則照常捲到底 */
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const anchorId = pendingAnchorRef.current;
    if (anchorId) {
      pendingAnchorRef.current = null;
      const el = body.querySelector<HTMLElement>(
        `[data-anchor-id="${anchorId}"]`
      );
      if (el) {
        body.scrollTop +=
          el.getBoundingClientRect().top - body.getBoundingClientRect().top;
        return;
      }
    }
    body.scrollTop = body.scrollHeight;
  }, [lines]);

  /* 輸出歷史持久化（action 是純資料，整批可序列化） */
  useEffect(() => {
    saveTerminalLog(lines);
  }, [lines]);

  /* entity-activate 消費（經 terminalBridge，收合期間的事件會補送） */
  useEffect(
    () =>
      subscribeEntityActivate((detail) => {
        const label = detail.text ?? detail.entityKey ?? detail.ref;
        append([{ kind: 'in', text: `» 接收訊號：${label}` }]);
        if (detail.entityKey) {
          void showByEntityKey(detail.entityKey, label);
        } else {
          // 舊格式 ref 無 entityKey——降級為文字檢索
          void runQuery(detail.text ?? detail.ref);
        }
      }),
    []
  );

  /* 更動通知（設計文件 6-6）：旗標/視角變化 → 重算各 entityKey 的
     已通過 revision 數，高於已讀水位 → 輸出 [SYS] 通知並寫回水位。
     首次遇到的 key 靜默建檔（不通知）——否則初訪會被 base revision 洗版。
     同 entityKey 跨 stack 多條鏈時取最大值（同組旗標驅動，天然同步）。
     deps 刻意不含 conceptsReadLevel：寫回水位不得再觸發重算。 */
  useEffect(() => {
    if (!indexReady) return;
    let cancelled = false;
    void loadEntityIndex()
      .then((entries) => {
        if (cancelled) return;
        const current = progressRef.current;
        const counts = new Map<string, number>();
        for (const entry of entries) {
          if (!entry.entityKey || !entry.revisionGates?.length) continue;
          counts.set(
            entry.entityKey,
            Math.max(
              counts.get(entry.entityKey) ?? 0,
              passedRevisionCount(entry, current)
            )
          );
        }
        const levels: Record<string, number> = {};
        const notices: TermLine[] = [];
        for (const [key, passed] of counts) {
          const known = current.conceptsReadLevel[key];
          if (known === undefined) {
            levels[key] = passed; // 首次建檔：靜默
            continue;
          }
          if (passed > known) {
            levels[key] = passed;
            notices.push({
              kind: 'meta',
              text: `[SYS] · ${key} 資料已更新（+${passed - known} revision）`,
            });
            notices.push({
              kind: 'meta',
              text: `[SYS] · 輸入 query ${key} 查看最新內容`,
            });
          }
        }
        if (Object.keys(levels).length > 0) {
          getProgressManager().updateConceptsReadLevel(levels);
        }
        if (notices.length > 0) append(notices);
      })
      .catch(() => {
        /* 索引失敗已由指令路徑呈現，通知靜默略過 */
      });
    return () => {
      cancelled = true;
    };
  }, [indexReady, progress.flags, progress.view, progress.observerEver]);

  /* ── 指令處理 ── */

  /** 同 entityKey 的 browser 對應條目（導向列用；無 key 或無對應回 null） */
  async function findBrowserCounterpart(
    target: TerminalIndexEntry
  ): Promise<TerminalIndexEntry | null> {
    if (!target.entityKey || target.stack === 'browser') return null;
    try {
      const entries = await loadEntityIndex();
      return (
        entries.find(
          (e) => e.stack === 'browser' && e.entityKey === target.entityKey
        ) ?? null
      );
    } catch {
      return null;
    }
  }

  async function showDetails(target: TerminalIndexEntry) {
    // browser 內容一律不在 terminal 展示（S7-C 驗收定案：資料保證
    // log↔browser 映射，詳細欄位歸個性瀏覽器）——只輸出導向列
    if (target.stack === 'browser') {
      const anchorId = `anchor-${++anchorSeqRef.current}`;
      pendingAnchorRef.current = anchorId;
      append([
        {
          kind: 'ok',
          text: `✓ ${target.name} · ${TERMINAL_STACK_LABELS.browser}`,
          anchorId,
        },
        {
          kind: 'row',
          text: '  → 開啟個性瀏覽器檔案 ▸',
          action: { type: 'navigate', pageId: target.pageId },
        },
      ]);
      return;
    }

    const details = await resolveEntryDetails(target, progressRef.current);
    if (details.length === 0) {
      append([
        { kind: 'err', text: `× 資料軌跡遺失——${target.pageTitle} 查無此條目` },
      ]);
      return;
    }
    const out: TermLine[] = [];
    let anyVisible = false;
    for (const d of details) {
      if (d.restricted) {
        out.push({
          kind: 'err',
          text: `✗ ACCESS RESTRICTED · ${d.name} — 資料尚未解密`,
        });
        continue;
      }
      anyVisible = true;
      const variant = d.variantId ? ` [${d.variantId.toUpperCase()}]` : '';
      out.push({
        kind: 'ok',
        text: `✓ ${d.name}${variant} · ${TERMINAL_STACK_LABELS[d.stack]}`,
      });
      out.push({ kind: 'row', text: `  ⌂ ${d.pageTitle}`, fade: true });
      for (const s of d.summary) {
        out.push({ kind: 'row', text: `  ${s}` });
      }
    }
    // 統一導向列（S7-C 驗收定案：所有 entry 尾端可導向對應頁面）；
    // 全 restricted 時不給導向（頁面守門也會擋，避免死路體驗）
    if (anyVisible) {
      out.push({
        kind: 'row',
        text: `  → 前往 ${target.pageTitle} ▸`,
        action: { type: 'navigate', pageId: target.pageId },
      });
      const counterpart = await findBrowserCounterpart(target);
      if (counterpart) {
        out.push({
          kind: 'row',
          text: '  → 開啟個性瀏覽器檔案 ▸',
          action: { type: 'navigate', pageId: counterpart.pageId },
        });
      }
    }
    // 清空式展現：整批第一行標錨點，輸出後捲動置頂（保留歷史）
    if (out.length > 0) {
      const anchorId = `anchor-${++anchorSeqRef.current}`;
      out[0] = { ...out[0], anchorId };
      pendingAnchorRef.current = anchorId;
    }
    append(out);
  }

  async function showByEntityKey(entityKey: string, label: string) {
    const entries = await ensureIndex();
    if (!entries) return;
    const hits = findByEntityKey(entries, entityKey);
    if (hits.length === 0) {
      // 索引沒有這個 key（資料端尚未掛 entityKey）——降級文字檢索
      await runQuery(label);
      return;
    }
    // 同 key 去重：有 log/diff 命中時 browser 不另列（導向列已涵蓋）
    const nonBrowser = hits.filter((h) => h.stack !== 'browser');
    for (const hit of nonBrowser.length > 0 ? nonBrowser : hits) {
      await showDetails(hit);
    }
  }

  async function runQuery(keyword: string) {
    const kw = keyword.trim();
    if (!kw) return;
    const entries = await ensureIndex();
    if (!entries) return;

    const rawHits = queryIndex(entries, kw, progressRef.current);
    // 同 entityKey 去重（S7-C 驗收定案）：存在 log/diff 命中時，
    // browser 那筆不進結果列表——瀏覽器內容統一走詳細頁導向列
    const keyedNonBrowser = new Set(
      rawHits
        .filter((h) => h.stack !== 'browser' && h.entityKey)
        .map((h) => h.entityKey as string)
    );
    const hits = rawHits.filter(
      (h) =>
        !(
          h.stack === 'browser' &&
          h.entityKey &&
          keyedNonBrowser.has(h.entityKey)
        )
    );
    if (hits.length === 0) {
      append([
        { kind: 'err', text: `× 查無「${kw}」` },
        {
          kind: 'row',
          text: '  試試其他關鍵字，或 ls log 瀏覽條目',
          fade: true,
        },
      ]);
      return;
    }
    if (hits.length === 1) {
      await showDetails(hits[0]);
      return;
    }
    append([
      { kind: 'ok', text: `✓ ${hits.length} 筆結果——點擊開啟` },
      ...hits.slice(0, 8).map(
        (hit): TermLine => ({
          kind: 'row',
          text: `  › ${hit.name} · ${TERMINAL_STACK_LABELS[hit.stack]}`,
          action: { type: 'show-entry', entry: hit },
        })
      ),
      ...(hits.length > 8
        ? [
            {
              kind: 'row',
              text: `  ……其餘 ${hits.length - 8} 筆省略，輸入更精確的關鍵字`,
              fade: true,
            } as TermLine,
          ]
        : []),
    ]);
  }

  async function runLs(arg: string) {
    if (!arg) {
      append([{ kind: 'err', text: '用法：ls <log|browser|clock|compare>' }]);
      return;
    }
    const stack = resolveStackAlias(arg);
    if (!stack) {
      append([{ kind: 'err', text: `× unknown stack: ${arg}` }]);
      return;
    }
    const entries = await ensureIndex();
    if (!entries) return;

    const { groups, unlockedCount, total } = groupStackEntries(
      entries,
      stack,
      progressRef.current
    );
    const out: TermLine[] = [
      {
        kind: 'ok',
        text: `✓ ${TERMINAL_STACK_LABELS[stack]} · ${unlockedCount}/${total} 已解鎖`,
      },
    ];

    if (stack === 'chrono') {
      // 顯著時代（事件較多 = 顯著）——完整時間軸仍在原質震盪時鐘
      const highlights = significantChronoPeriods(
        entries,
        progressRef.current,
        CLOCK_HIGHLIGHT_LIMIT
      );
      if (highlights.length > 0) {
        out.push({ kind: 'head', text: '▸ 顯著時代' });
        for (const entry of highlights) {
          out.push({
            kind: 'row',
            text: `  › ${entry.name} · ${entry.eventCount} 事件`,
            action: { type: 'show-entry', entry },
          });
        }
      }
      out.push({
        kind: 'meta',
        text: '（完整時間軸見原質震盪時鐘）',
      });
      append(out);
      return;
    }

    // dossier/diff/browser：按 category → group 分組列出（S7-C 驗收回饋）
    let listed = 0;
    let capped = false;
    outer: for (const bucket of groups) {
      if (bucket.category) {
        out.push({ kind: 'head', text: `▸ ${bucket.category}` });
      }
      if (bucket.group) {
        out.push({ kind: 'head', text: `  · ${bucket.group}`, fade: true });
      }
      const indent = bucket.category || bucket.group ? '    ' : '  ';
      for (const entry of bucket.entries) {
        if (listed >= LS_LIST_CAP) {
          capped = true;
          break outer;
        }
        out.push({
          kind: 'row',
          text: `${indent}› ${entry.name}`,
          action: { type: 'show-entry', entry },
        });
        listed += 1;
      }
    }
    if (capped) {
      out.push({
        kind: 'row',
        text: `  ……其餘 ${unlockedCount - listed} 條省略，用 query 檢索`,
        fade: true,
      });
    }
    append(out);
  }

  function runCommand(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;

    if (cmd === 'clear') {
      // 回到 boot 狀態（非死白）並清除持久化歷史
      clearTerminalLog();
      setLines(BOOT_LINES);
      return;
    }

    append([{ kind: 'in', text: `$ ${cmd}` }]);

    if (cmd === '?' || cmd === 'help') {
      append(HELP_LINES);
      return;
    }
    if (cmd === 'ls' || cmd.startsWith('ls ')) {
      void runLs(cmd.slice(2).trim());
      return;
    }
    if (cmd.startsWith('query ')) {
      void runQuery(cmd.slice('query '.length));
      return;
    }
    // 裸關鍵字視同 query（設計稿原型行為）
    void runQuery(cmd);
  }

  /* ── Tab 補全 / 歷史導航 ── */

  /** 套用候選（同步更新輸入列與循環索引） */
  function applyCandidate(
    candidates: string[],
    index: number,
    open = false
  ): void {
    setCompletion({ candidates, index });
    setInput(candidates[index]);
    if (open) histIdxRef.current = null;
  }

  /** Tab 首按：計算候選並套用第一個 */
  async function openCompletion(): Promise<void> {
    let entries: TerminalIndexEntry[] = [];
    try {
      entries = await loadEntityIndex();
    } catch {
      // 索引失敗仍可補指令詞
    }
    const candidates = completeInput(input, entries, progressRef.current);
    if (candidates.length === 0) return;
    applyCandidate(candidates, 0, true);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (completion && completion.candidates.length > 0) {
        const next = (completion.index + 1) % completion.candidates.length;
        applyCandidate(completion.candidates, next);
      } else {
        void openCompletion();
      }
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? -1 : 1;

    // 候選開啟中：↑↓ 在候選間循環
    if (completion && completion.candidates.length > 0) {
      const len = completion.candidates.length;
      const next = (completion.index + dir + len) % len;
      applyCandidate(completion.candidates, next);
      return;
    }

    // 無候選：↑↓ 翻指令歷史（↓ 超出回到空輸入列）
    const hist = historyRef.current;
    if (hist.length === 0) return;
    const cur = histIdxRef.current;
    let next: number | null;
    if (cur === null) {
      next = dir === -1 ? hist.length - 1 : null;
    } else {
      const moved = cur + dir;
      next = moved >= hist.length ? null : Math.max(0, moved);
    }
    histIdxRef.current = next;
    setInput(next === null ? '' : hist[next]);
  }

  const lineClass = (line: TermLine) =>
    `uep-terminal__line uep-terminal__line--${line.kind}${
      line.fade ? ' uep-terminal__line--fade' : ''
    }`;

  return (
    <div className="uep-terminal">
      <div className="uep-terminal__body" ref={bodyRef}>
        {lines.map((line, i) =>
          line.action ? (
            <button
              key={i}
              type="button"
              className={`${lineClass(line)} uep-terminal__line-btn`}
              data-anchor-id={line.anchorId}
              onClick={() => runAction(line.action!)}
            >
              {line.text}
            </button>
          ) : (
            <div
              key={i}
              className={lineClass(line)}
              data-anchor-id={line.anchorId}
            >
              {line.text}
            </div>
          )
        )}

        {/* 首次使用引導 chips（照設計稿原型） */}
        {lines.length <= BOOT_LINES.length && (
          <div className="uep-terminal__chips">
            <div className="uep-terminal__chips-label">· suggested:</div>
            {['?', 'ls log', 'ls compare'].map((s) => (
              <button
                key={s}
                type="button"
                className="uep-terminal__chip"
                onClick={() => runCommand(s)}
              >
                › {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        className="uep-terminal__prompt"
        onSubmit={(e) => {
          e.preventDefault();
          const cmd = input.trim();
          if (cmd) {
            const hist = historyRef.current;
            if (hist[hist.length - 1] !== cmd) hist.push(cmd);
            if (hist.length > 50) hist.shift();
          }
          histIdxRef.current = null;
          setCompletion(null);
          runCommand(input);
          setInput('');
        }}
      >
        <span className="uep-terminal__prompt-sign" aria-hidden>
          $
        </span>
        <input
          ref={inputRef}
          className="uep-terminal__input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setCompletion(null);
            histIdxRef.current = null;
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={indexReady ? 'query … （⇥ 補全）' : 'initializing…'}
          aria-label="terminal 指令輸入"
          spellCheck={false}
          autoComplete="off"
        />
        {completion && completion.candidates.length > 1 ? (
          <span className="uep-terminal__completion-hint" aria-hidden>
            ⇥ {completion.index + 1}/{completion.candidates.length}
          </span>
        ) : (
          <span className="uep-terminal__enter" aria-hidden>
            ↵
          </span>
        )}
      </form>
    </div>
  );
}
