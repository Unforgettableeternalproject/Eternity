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
/* global PopStateEvent */

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
  resolveBrowserExpand,
  resolveEntryDetails,
  resolveStackAlias,
  significantChronoPeriods,
  summarizeCategories,
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

/**
 * 打字機動畫節奏（艾斯維爾定案：中速 ~25ms/字、一行接一行、reduced-motion 才跳過）。
 * 空白與標點降到 8ms 通過——避免長句被逗號拖住節奏。
 */
const TYPE_DELAY_MS = 25;
const TYPE_PUNCT_DELAY_MS = 8;
const TYPE_PUNCT_PATTERN = /[\s.,、。·—:：（）()!?！？]/;

const HELP_LINES: TermLine[] = [
  { kind: 'meta', text: '? · query <keyword>    — 檢索人物 / 地點 / 術語' },
  { kind: 'meta', text: '  · ls <stack> [分類]  — 列出分類，點分類展開條目' },
  { kind: 'meta', text: '        stack: log · browser · clock · compare' },
  { kind: 'meta', text: '  · clear              — 清空輸出' },
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

  /**
   * 打字機動畫進度（艾斯維爾定案的四題：只新輸出、一行接一行、
   * reduced-motion 才跳過、~25ms/字）。
   * - currentLine：正在打字的行索引；`>= lines.length` 表示全部已完成
   * - charCount：當前行已顯示的字元數（達到 line.text.length 即完成該行）
   *
   * mount 時：有 stored → 全部立即完成（不重播歷史）；無 stored → 從 0 開始
   * 打字 boot 兩行，首次進入才有終端啟動感。
   */
  const [currentLine, setCurrentLine] = useState<number>(() => {
    const stored = loadTerminalLog();
    return stored ? stored.length : 0;
  });
  const [charCount, setCharCount] = useState(0);
  /**
   * prefers-reduced-motion：一次讀取即可（極端情況下切換不需要即時反應）。
   * SSR 安全：無 window 時預設 false（動畫照常）——TerminalIsland 是 lazy 掛載，
   * 實務上只在瀏覽器端 mount。
   */
  const [prefersReducedMotion] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  const bodyRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** async 回呼取用最新進度（不重綁 listener） */
  const progressRef = useRef(progress);
  progressRef.current = progress;
  /** 清空式展現的一次性捲動目標（null = 照常捲到底） */
  const pendingAnchorRef = useRef<string | null>(null);
  const anchorSeqRef = useRef(0);
  /** anchor 是否已完成首次置頂——之後打字推進不再碰 scrollTop（#12） */
  const anchorAlignedRef = useRef(false);

  /* 補全候選列表（S7-C 驗收回饋三輪：slash-command 式向上展開，
     打字即出、↑↓/Tab 移動高亮、Enter 填入、無高亮 Enter 照常送出） */
  const [completion, setCompletion] = useState<{
    candidates: string[];
    /** 高亮位置；null = 未進入選擇（Enter 直接送出輸入） */
    index: number | null;
  } | null>(null);
  const historyRef = useRef<string[]>([]);
  const histIdxRef = useRef<number | null>(null);
  /** 索引預熱後的同步引用（onChange 即時計算候選用） */
  const entriesRef = useRef<TerminalIndexEntry[]>([]);

  function append(add: TermLine[]) {
    setLines((prev) => [...prev, ...add].slice(-MAX_TERM_LINES));
  }

  /** 清空式展現輸出：整批第一行標錨點，effect 內捲動置頂（保留歷史） */
  function appendAnchored(add: TermLine[]) {
    if (add.length === 0) return;
    const anchorId = `anchor-${++anchorSeqRef.current}`;
    pendingAnchorRef.current = anchorId;
    anchorAlignedRef.current = false;
    append([{ ...add[0], anchorId }, ...add.slice(1)]);
  }

  /** data-driven action 的執行入口（rehydrate 後的列也走同一條路） */
  function runAction(action: TermAction) {
    if (action.type === 'show-entry') {
      void showDetails(action.entry);
    } else if (action.type === 'expand-browser') {
      void showBrowserExpand(action.entry);
    } else if (action.type === 'navigate') {
      navigateToConceptsPage(action.pageId);
    } else if (action.type === 'ls-category') {
      void runLsCategory(action.stack, action.category);
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
      .then((entries) => {
        if (cancelled) return;
        entriesRef.current = entries;
        setIndexReady(true);
      })
      .catch(() => {
        /* 失敗不在 mount 時報錯——首次指令會經 ensureIndex 呈現 */
      });
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  /* 打字機 tick：一行接一行、每字排一次 setTimeout。
     - reduced-motion：整批瞬間完成（單次 setCurrentLine 到底）
     - 完成當前行 → 進下一行、charCount 歸零
     - 尚有字要打 → 依字元屬性排下一 tick（標點/空白加速通過）
     捲動 effect 監聽 currentLine（不含 charCount）——每完成一行才捲動一次，
     打字中的 wrap 換行不觸發 reflow-driven 捲動，符合真實終端 stdout 行為。 */
  useEffect(() => {
    if (currentLine >= lines.length) return; // 全部打完
    if (prefersReducedMotion) {
      setCurrentLine(lines.length);
      setCharCount(0);
      return;
    }
    const line = lines[currentLine];
    const total = line.text.length;
    if (charCount >= total) {
      // 該行完成 → 立刻進下一行（同一 tick 內完成推進）
      setCurrentLine((n) => n + 1);
      setCharCount(0);
      return;
    }
    const nextChar = line.text.charAt(charCount);
    const delay = TYPE_PUNCT_PATTERN.test(nextChar)
      ? TYPE_PUNCT_DELAY_MS
      : TYPE_DELAY_MS;
    const id = window.setTimeout(() => {
      setCharCount((c) => c + 1);
    }, delay);
    return () => window.clearTimeout(id);
  }, [lines, currentLine, charCount, prefersReducedMotion]);

  /* 輸出更新後捲動：有 pending anchor（entry 詳細內容 / 分類展開）→
     該行「置頂」——清空式展現（艾斯維爾定案：保留歷史、捲動置頂，
     上方歷史需上捲才看到）。內容不足一屏時以底部 spacer 補足捲動空間，
     否則 anchor 行物理上到不了視窗頂。無 anchor 照常捲到底。
     #12 修正（S7 驗收回饋）：置頂只在錨點批次首次渲染時對齊一次——
     之後打字機每完成一行只收縮 spacer（配合內容增長），不再改寫
     scrollTop 也不歸零 spacer 重量測（歸零瞬間 scrollHeight 縮短會被
     瀏覽器 clamp 而跳動）。使用者中途手動捲動不會被拉回。 */
  useEffect(() => {
    const body = bodyRef.current;
    const spacer = spacerRef.current;
    if (!body) return;
    const anchorId = pendingAnchorRef.current;
    const typingDone = currentLine >= lines.length;
    if (anchorId) {
      const el = body.querySelector<HTMLElement>(
        `[data-anchor-id="${anchorId}"]`
      );
      if (el) {
        // anchor 行相對內容頂部的偏移（與當前捲動位置無關）
        const anchorTop =
          el.getBoundingClientRect().top -
          body.getBoundingClientRect().top +
          body.scrollTop;
        if (!anchorAlignedRef.current) {
          // 首次渲染：歸零 spacer 量測純內容高度 → 補足 → 對齊一次
          if (spacer) spacer.style.height = '0px';
          const deficit = anchorTop + body.clientHeight - body.scrollHeight;
          if (spacer && deficit > 0) spacer.style.height = `${deficit}px`;
          body.scrollTop = anchorTop;
          anchorAlignedRef.current = true;
        } else if (spacer) {
          // 後續打字推進：只依內容增長收縮 spacer，不碰 scrollTop
          const spacerH = parseFloat(spacer.style.height) || 0;
          const contentH = body.scrollHeight - spacerH;
          const deficit = anchorTop + body.clientHeight - contentH;
          spacer.style.height = `${Math.max(0, deficit)}px`;
        }
        // 打字全結束才卸除 anchor（spacer 保留，維持當前視圖穩定）
        if (typingDone) {
          pendingAnchorRef.current = null;
          anchorAlignedRef.current = false;
        }
        return;
      }
      // anchor 元素未找到（極端案例）：卸除避免卡住
      if (typingDone) {
        pendingAnchorRef.current = null;
        anchorAlignedRef.current = false;
      }
    }
    // 無 anchor 的一般輸出：清掉殘留 spacer、照常捲到底
    if (spacer) spacer.style.height = '0px';
    body.scrollTop = body.scrollHeight;
  }, [lines, currentLine]);

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
    // browser 條目：預設不展開內容（log entry 為主體），
    // 輸出導向標題 + 展開列——完整檔案由 expand-browser 在
    // terminal 內展現（S7-D-4，取代 S7-C 的純導向過渡形態）
    if (target.stack === 'browser') {
      appendAnchored([
        {
          kind: 'ok',
          text: `✓ ${target.name} · ${TERMINAL_STACK_LABELS.browser}`,
          suffix: {
            text: '↗',
            action: { type: 'navigate', pageId: target.pageId },
          },
        },
        {
          kind: 'row',
          text: '  ▸ 展開完整檔案',
          action: { type: 'expand-browser', entry: target },
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
        // 導向符號（S7-C 三輪定案：標題行尾 ↗，取代整行導向文字）；
        // restricted 條目已在上方 continue，這裡必然可導向
        suffix: {
          text: '↗',
          action: { type: 'navigate', pageId: target.pageId },
        },
      });
      out.push({ kind: 'row', text: `  ⌂ ${d.pageTitle}`, fade: true });
      for (const s of d.summary) {
        out.push({ kind: 'row', text: `  ${s}` });
      }
    }
    // browser 對應（同 entityKey）：「▸ 展開完整檔案」在 terminal 內
    // 展現（S7-D-4 定案，取代「→ 個性瀏覽器」縮短導向）；
    // 行尾 ↗ 仍可直接跳個性瀏覽器頁面
    if (anyVisible) {
      const counterpart = await findBrowserCounterpart(target);
      if (counterpart) {
        out.push({
          kind: 'row',
          text: '  ▸ 展開完整檔案',
          action: { type: 'expand-browser', entry: counterpart },
          suffix: {
            text: '↗',
            action: { type: 'navigate', pageId: counterpart.pageId },
          },
        });
      }
    }
    appendAnchored(out);
  }

  /** browser 完整檔案的 terminal 內展現（S7-D-4：basic 全欄位 + sections 不截短） */
  async function showBrowserExpand(target: TerminalIndexEntry) {
    const detail = await resolveBrowserExpand(target, progressRef.current);
    if (!detail) {
      append([
        { kind: 'err', text: `× 資料軌跡遺失——${target.pageTitle} 查無此檔案` },
      ]);
      return;
    }
    if (detail.restricted) {
      appendAnchored([
        {
          kind: 'err',
          text: `✗ ACCESS RESTRICTED · ${detail.name} — 檔案尚未解密`,
        },
      ]);
      return;
    }
    const out: TermLine[] = [
      {
        kind: 'ok',
        text: `✓ ${detail.name} · ${TERMINAL_STACK_LABELS.browser} [FULL]`,
        suffix: {
          text: '↗',
          action: { type: 'navigate', pageId: detail.pageId },
        },
      },
      { kind: 'row', text: `  ⌂ ${detail.pageTitle}`, fade: true },
    ];
    for (const line of detail.basic) {
      out.push({ kind: 'row', text: `  ${line}` });
    }
    for (const section of detail.sections) {
      out.push({ kind: 'head', text: `  ▸ ${section.label}` });
      for (const line of section.lines) {
        out.push({ kind: 'row', text: `  ${line}` });
      }
    }
    appendAnchored(out);
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

    // browser 不進檢索（queryIndex 內建排除）——log entry 為主體
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

  /** ls 第二層：列出指定分類的條目（category '' = 未分類） */
  async function runLsCategory(
    stack: NonNullable<ReturnType<typeof resolveStackAlias>>,
    category: string
  ) {
    const entries = await ensureIndex();
    if (!entries) return;

    const { groups } = groupStackEntries(entries, stack, progressRef.current);
    const matched = groups.filter((g) => (g.category ?? '') === category);
    const count = matched.reduce((n, g) => n + g.entries.length, 0);
    if (count === 0) {
      append([{ kind: 'err', text: `× 查無分類「${category || '未分類'}」` }]);
      return;
    }

    const out: TermLine[] = [
      {
        kind: 'ok',
        text: `✓ ${TERMINAL_STACK_LABELS[stack]} › ${category || '未分類'} · ${count} 條`,
      },
    ];
    let listed = 0;
    let capped = false;
    outer: for (const bucket of matched) {
      if (bucket.group) {
        out.push({ kind: 'head', text: `  · ${bucket.group}`, fade: true });
      }
      const indent = bucket.group ? '    ' : '  ';
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
        text: `  ……其餘 ${count - listed} 條省略，用 query 檢索`,
        fade: true,
      });
    }
    // 點入下一層 = 清空式展現（該層從視窗頂開始）
    appendAnchored(out);
  }

  /** ls 頂層：層級式——只列分類摘要，點分類（或 ls <stack> <分類>）才展開 */
  async function runLs(arg: string) {
    if (!arg) {
      append([
        { kind: 'err', text: '用法：ls <log|browser|clock|compare> [分類]' },
      ]);
      return;
    }
    const [stackArg, ...rest] = arg.split(/\s+/);
    const categoryArg = rest.join(' ').trim();
    const stack = resolveStackAlias(stackArg);
    if (!stack) {
      append([{ kind: 'err', text: `× unknown stack: ${stackArg}` }]);
      return;
    }

    // 指定分類 → 直接進第二層（「未分類」對映空分類）
    if (categoryArg) {
      await runLsCategory(stack, categoryArg === '未分類' ? '' : categoryArg);
      return;
    }

    const entries = await ensureIndex();
    if (!entries) return;

    if (stack === 'chrono') {
      // 顯著時代（事件較多 = 顯著）——完整時間軸仍在原質震盪時鐘
      const { unlockedCount, total } = summarizeCategories(
        entries,
        stack,
        progressRef.current
      );
      const out: TermLine[] = [
        {
          kind: 'ok',
          text: `✓ ${TERMINAL_STACK_LABELS.chrono} · ${unlockedCount}/${total} 已解鎖`,
        },
      ];
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
      out.push({ kind: 'meta', text: '（完整時間軸見原質震盪時鐘）' });
      append(out);
      return;
    }

    const { categories, unlockedCount, total } = summarizeCategories(
      entries,
      stack,
      progressRef.current
    );

    // 全無分類（如 browser profiles 平鋪）→ 沒有第二層，直接列條目
    if (categories.length === 1 && categories[0].category === '') {
      await runLsCategory(stack, '');
      return;
    }

    const out: TermLine[] = [
      {
        kind: 'ok',
        text: `✓ ${TERMINAL_STACK_LABELS[stack]} · ${unlockedCount}/${total} 已解鎖`,
      },
    ];
    for (const cat of categories) {
      out.push({
        kind: 'row',
        text: `  ▸ ${cat.category || '未分類'} (${cat.count}) ▾`,
        action: { type: 'ls-category', stack, category: cat.category },
      });
    }
    out.push({ kind: 'meta', text: '（點分類展開條目）' });
    append(out);
  }

  function runCommand(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;

    if (cmd === 'clear') {
      // 回到 boot 狀態（非死白）並清除持久化歷史。
      // clear 是使用者刻意的重置——boot 已見過，不再重播打字（直接完成）。
      clearTerminalLog();
      setLines(BOOT_LINES);
      setCurrentLine(BOOT_LINES.length);
      setCharCount(0);
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

  /* ── 補全候選列表 / 歷史導航 ── */

  /** 依輸入值重算候選列表（打字即出；空輸入或無候選時收起） */
  function computeCandidates(value: string): void {
    if (!value.trim()) {
      setCompletion(null);
      return;
    }
    const candidates = completeInput(
      value,
      entriesRef.current,
      progressRef.current
    ).filter((c) => c !== value); // 已與輸入相同的候選不重複列
    setCompletion(candidates.length > 0 ? { candidates, index: null } : null);
  }

  /** 確認候選：填入輸入列並以新值重算（帶參數指令可繼續 refine） */
  function selectCandidate(candidate: string): void {
    setInput(candidate);
    histIdxRef.current = null;
    computeCandidates(candidate);
    inputRef.current?.focus();
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    const hasList = completion !== null && completion.candidates.length > 0;

    if (e.key === 'Escape' && hasList) {
      e.preventDefault();
      setCompletion(null);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (!hasList) return;
      // Tab：高亮往下循環（null → 第一項）
      const len = completion.candidates.length;
      const next = completion.index === null ? 0 : (completion.index + 1) % len;
      setCompletion({ ...completion, index: next });
      return;
    }

    if (e.key === 'Enter') {
      // 有高亮 → Enter 是「選候選」不是送出
      if (hasList && completion.index !== null) {
        e.preventDefault();
        selectCandidate(completion.candidates[completion.index]);
      }
      return; // 無高亮：交給 form submit
    }

    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? -1 : 1;

    // 列表開啟中：↑↓ 移動高亮（不動輸入列）
    if (hasList) {
      const len = completion.candidates.length;
      const next =
        completion.index === null
          ? dir === -1
            ? len - 1
            : 0
          : (completion.index + dir + len) % len;
      setCompletion({ ...completion, index: next });
      return;
    }

    // 無列表：↑↓ 翻指令歷史（↓ 超出回到空輸入列）
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

  /** 打字機游標——正在打字的行末端；打字完成後消失 */
  const cursor = (
    <span className="uep-terminal__cursor" aria-hidden>
      ▋
    </span>
  );

  return (
    <div className="uep-terminal">
      <div className="uep-terminal__body" ref={bodyRef}>
        {/* 打字機切片：只 render「已完成 + 正在打字」的行，尚未開始的
            隱藏——真實終端「一行一行冒出」的視覺（若尚無打字進行，
            currentLine === lines.length，slice 涵蓋全部）。 */}
        {lines
          .slice(0, Math.min(lines.length, currentLine + 1))
          .map((line, i) => {
            const isTyping =
              i === currentLine &&
              currentLine < lines.length &&
              charCount < line.text.length;
            // 打字中：只顯示已打出的文字 + 游標，action/suffix 按鈕暫不啟用
            // （避免半行文字就被點擊，也避免游標卡在 flex 對齊中間）
            if (isTyping) {
              const shown = line.text.slice(0, charCount);
              return (
                <div
                  key={i}
                  className={lineClass(line)}
                  data-anchor-id={line.anchorId}
                >
                  {shown}
                  {cursor}
                </div>
              );
            }
            return line.suffix ? (
              // 帶行尾符號的行：主文字 + 獨立可點符號（如 ↗ 跳頁）
              <div
                key={i}
                className={`${lineClass(line)} uep-terminal__line-flex`}
                data-anchor-id={line.anchorId}
              >
                {line.action ? (
                  <button
                    type="button"
                    className="uep-terminal__line-btn uep-terminal__line-main"
                    onClick={() => runAction(line.action!)}
                  >
                    {line.text}
                  </button>
                ) : (
                  <span className="uep-terminal__line-main">{line.text}</span>
                )}
                <button
                  type="button"
                  className="uep-terminal__suffix-btn"
                  title="前往對應頁面"
                  onClick={() => runAction(line.suffix!.action)}
                >
                  {line.suffix.text}
                </button>
              </div>
            ) : line.action ? (
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
            );
          })}

        {/* 置頂捲動的動態補位（內容不足一屏時撐開捲動空間） */}
        <div ref={spacerRef} aria-hidden />

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
        {/* 補全候選列表——slash-command 式向上展開（打字即出） */}
        {completion && completion.candidates.length > 0 && (
          <div className="uep-terminal__suggest" role="listbox">
            {completion.candidates.map((c, i) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={i === completion.index}
                className={`uep-terminal__suggest-item${
                  i === completion.index ? ' is-active' : ''
                }`}
                // mousedown 防 input blur（blur 會先於 click 關列表）
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectCandidate(c);
                }}
              >
                › {c}
              </button>
            ))}
            <div className="uep-terminal__suggest-hint">
              ⇥/↑↓ 選擇 · ↵ 填入 · esc 關閉
            </div>
          </div>
        )}
        <span className="uep-terminal__prompt-sign" aria-hidden>
          $
        </span>
        <input
          ref={inputRef}
          className="uep-terminal__input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            histIdxRef.current = null;
            computeCandidates(e.target.value);
          }}
          onKeyDown={handleInputKeyDown}
          onBlur={() => setCompletion(null)}
          placeholder={indexReady ? 'query … （⇥ 補全）' : 'initializing…'}
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
