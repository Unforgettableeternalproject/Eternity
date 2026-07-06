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
  findByEntityKey,
  listStackEntries,
  loadEntityIndex,
  passedRevisionCount,
  queryIndex,
  resolveEntryDetails,
  resolveStackAlias,
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
const LS_LIST_CAP = 20;

const HELP_LINES: TermLine[] = [
  { kind: 'meta', text: '? · query <keyword> — 檢索人物 / 地點 / 術語' },
  { kind: 'meta', text: '  · ls <stack>      — 列出已解鎖條目' },
  { kind: 'meta', text: '        stack: log · browser · clock · compare' },
  { kind: 'meta', text: '  · clear           — 清空輸出' },
];

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

  function append(add: TermLine[]) {
    setLines((prev) => [...prev, ...add].slice(-MAX_TERM_LINES));
  }

  /** data-driven action 的執行入口（rehydrate 後的列也走同一條路） */
  function runAction(action: TermAction) {
    if (action.type === 'show-entry') {
      void showDetails(action.entry);
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

  /* 輸出更新後捲到底 */
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
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

  async function showDetails(target: TerminalIndexEntry) {
    const details = await resolveEntryDetails(target, progressRef.current);
    if (details.length === 0) {
      append([
        { kind: 'err', text: `× 資料軌跡遺失——${target.pageTitle} 查無此條目` },
      ]);
      return;
    }
    const out: TermLine[] = [];
    for (const d of details) {
      if (d.restricted) {
        out.push({
          kind: 'err',
          text: `✗ ACCESS RESTRICTED · ${d.name} — 資料尚未解密`,
        });
        continue;
      }
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
    for (const hit of hits) {
      await showDetails(hit);
    }
  }

  async function runQuery(keyword: string) {
    const kw = keyword.trim();
    if (!kw) return;
    const entries = await ensureIndex();
    if (!entries) return;

    const hits = queryIndex(entries, kw, progressRef.current);
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

    const { unlocked, total } = listStackEntries(
      entries,
      stack,
      progressRef.current
    );
    const out: TermLine[] = [
      {
        kind: 'ok',
        text: `✓ ${TERMINAL_STACK_LABELS[stack]} · ${unlocked.length}/${total} 已解鎖`,
      },
    ];
    if (stack === 'chrono') {
      // 定案 A：ls clock 不逐項列出時間點
      out.push({
        kind: 'meta',
        text: '（時間點不逐項列出——完整時間軸見原質震盪時鐘）',
      });
    } else {
      for (const entry of unlocked.slice(0, LS_LIST_CAP)) {
        out.push({
          kind: 'row',
          text: `  › ${entry.name}`,
          action: { type: 'show-entry', entry },
        });
      }
      if (unlocked.length > LS_LIST_CAP) {
        out.push({
          kind: 'row',
          text: `  ……其餘 ${unlocked.length - LS_LIST_CAP} 條省略，用 query 檢索`,
          fade: true,
        });
      }
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
              onClick={() => runAction(line.action!)}
            >
              {line.text}
            </button>
          ) : (
            <div key={i} className={lineClass(line)}>
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
          onChange={(e) => setInput(e.target.value)}
          placeholder={indexReady ? 'query …' : 'initializing…'}
          aria-label="terminal 指令輸入"
          spellCheck={false}
          autoComplete="off"
        />
        <span className="uep-terminal__enter" aria-hidden>
          ↵
        </span>
      </form>
    </div>
  );
}
