/**
 * 休息提醒（S10-4 B 段，只 History）
 *
 * ## 為什麼只 History
 *
 * 「獲得很多進度」這件事只有 History 有具體定義（completedPageIds、掃描線、
 * 迷霧線）。其餘四區的停留形態不同（聽歌／看圖／查條目），硬套「讀太多」
 * 的語意不成立。
 *
 * ## 兩條線，先到先觸發
 *
 * - **本輪累積活躍時長**：用 activityWatch 的活躍毫秒差值，不是牆鐘時間。
 *   中途 AFK 十分鐘不算進去。
 * - **視窗內完成頁數**：滾動視窗內新增的完成頁數。
 *
 * 兩條各自有盲點：只看時長會漏掉「四十分鐘掃完十篇短文」的人，只看頁數
 * 會漏掉「在一篇長文卡兩小時」的人。取聯集才覆蓋兩種讀法。
 *
 * ## 狀態都在記憶體，不進 ProgressState
 *
 * 「剛剛提醒過」是本次閱讀 session 的狀態，跨裝置同步它沒有意義，而且會讓
 * 進度 blob 因為一個純瞬時狀態反覆寫入。完成頁的時間戳同理——只收本
 * session 真的發生的 `page-completed` 事件，hydrate、跨裝置既有完成與重讀
 * 都不算成本次的大量閱讀。
 *
 * ## ⚠️ 掛載位置
 *
 * 提示層的 context 由 `ReaderNudgeProvider` 提供，而它掛在 ReaderShell 內。
 * **HistoryReader 是 ReaderShell 的父元件**（它 render `<ReaderShell>` 包住
 * 自己的內容），所以在 HistoryReader 的函式本體呼叫這個 hook 只會拿到
 * no-op context。消費端一律用同檔匯出的 `<RestReminder />`，放進
 * `<ReaderShell>` 的 children 裡。
 */

import { useEffect, useRef } from 'react';

import { getActiveTotalMs } from '../../lib/activityWatch';
import { markTeatimeInvited } from '../../lib/teatime';
import { getSetting, initUepSettings } from '../../lib/uepSettings';
import { PROGRESS_CHANGE_EVENT, getProgressManager } from '../../progress';
import type { ProgressChangeDetail } from '../../progress';
import { useReaderNudge } from '../zone/ReaderNudge';
import type { RestNudgeRequest, RestNudgeVariant } from '../zone/ReaderNudge';

/** 判定週期。門檻以分鐘計，15 秒的解析度已經遠比需要的細 */
const CHECK_INTERVAL_MS = 15_000;

const MINUTE_MS = 60_000;

const REST_TITLE = '看了好多東西了';
const REST_BODY = '要不要休息一下呢?';

/**
 * 邀茶差分：同一個提醒的另一種說法，多一條出路。
 *
 * 門檻與冷卻完全共用——它不是第二種提醒，是同一個提醒偶爾換一張臉。
 */
const INVITE_TITLE = '已經看很多了，要不要去休息一下?';
const INVITE_BODY = 'U.E.P 有泡一些茶，可以去嘗嘗看';

/** 設定未載入時的預設機率（權威預設，與 worker 的 SETTING_DEFAULTS 對齊） */
const TEA_INVITE_CHANCE_PCT = 10;

/**
 * 手動驗收用的 bridge（同 LostBookmark 的既有模式）。
 *
 * 休息提醒的預設門檻是 45 分鐘活躍或 30 分鐘內讀完 5 頁——照正常流程驗收
 * 要坐在那裡讀四十分鐘。掛在 window 上讓 DevTools 直接觸發。
 */
declare global {
  interface Window {
    __uepRestReminderTest?: {
      /**
       * 立刻跳出休息提醒（走正規提交路徑，確認鈕的行為完全一致）。
       * 不指定 variant 就照設定的機率擲骰——邀茶版預設只有一成，
       * 要驗收它得明確指定。
       */
      trigger: (variant?: RestNudgeVariant) => void;
      /** 收掉目前的提醒，不算確認（不重設 baseline、不開始冷卻） */
      dismiss: () => void;
      /** 目前的判定狀態 */
      state: () => {
        activeMs: number;
        completedInWindow: number;
        cooldownRemainingMs: number;
        pending: boolean;
      };
    };
  }
}

interface RestConfig {
  activeMs: number;
  pageCount: number;
  windowMs: number;
  cooldownMs: number;
}

function readConfig(): RestConfig {
  return {
    activeMs: getSetting('reader.restActiveMinutes', 75) * MINUTE_MS,
    pageCount: getSetting('reader.restPageCount', 8),
    windowMs: getSetting('reader.restWindowMinutes', 30) * MINUTE_MS,
    cooldownMs: getSetting('reader.restCooldownMinutes', 90) * MINUTE_MS,
  };
}

export function useRestReminder(): void {
  const { requestRestNudge, dismissRestNudge } = useReaderNudge();

  /** 本輪活躍時長的起點；每次確認提醒後重設 */
  const baselineRef = useRef(0);
  /** 本 session 完成頁的時間戳，判定前剔除視窗外的舊項 */
  const completedAtRef = useRef<number[]>([]);
  /**
   * 見過的完成頁 id——byPages 只計「本 session 首次讀完的不重複頁面」。
   *
   * 沒有這道防線的實際事故（Ariel 2026-08-12）：跨裝置 409 覆蓋（修掉前）
   * 會把 completedPageIds 倒帶，掃描線還停在文末，於是同一頁反覆
   * 重新標記完成，五次 `page-completed` 在幾分鐘內湊滿門檻，讀第一篇
   * 捲到底提醒就跳出來。覆蓋 bug 已修（改聯集合併），這裡再擋一層。
   *
   * 集合吸收**所有來源**的 completedPageIds（掛載快照、hydrate 匯入都算
   * 「見過」），但只有 `page-completed` 來源的新增才記時間戳——否則登入
   * hydrate 帶進來的既有完成頁會在下一次真實完成時被整批誤算成本次閱讀。
   */
  const seenPagesRef = useRef(new Set<string>());
  /** 冷卻結束時刻。從按下「知道了」起算，不是從卡片出現起算 */
  const cooldownUntilRef = useRef(0);
  /** 卡片正在顯示（或排隊中），不重複提交 */
  const pendingRef = useRef(false);

  const nudgeRef = useRef({ requestRestNudge, dismissRestNudge });
  nudgeRef.current = { requestRestNudge, dismissRestNudge };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    // 掛載當下的完成頁是歷史，不是本次閱讀（見 seenPagesRef）
    seenPagesRef.current = new Set(
      getProgressManager().getState().completedPageIds
    );

    const onProgressChange = (event: Event) => {
      const detail = (event as CustomEvent<ProgressChangeDetail>).detail;
      const ids = detail?.state?.completedPageIds;
      if (!ids) return;
      // 只有 page-completed 來源的新增算本次閱讀；其餘來源（hydrate、
      // reset 後重建等）只吸收進「見過」集合，不記時間戳
      const isCompletion = detail.source === 'page-completed';
      for (const pageId of ids) {
        if (seenPagesRef.current.has(pageId)) continue;
        seenPagesRef.current.add(pageId);
        if (isCompletion) completedAtRef.current.push(Date.now());
      }
    };

    window.addEventListener(PROGRESS_CHANGE_EVENT, onProgressChange);

    void initUepSettings().then(() => {
      if (cancelled) return;
      const config = readConfig();

      // 兩條線都關 = 整個功能停用，連計時器都不必開
      if (config.activeMs <= 0 && config.pageCount <= 0) return;

      baselineRef.current = getActiveTotalMs();

      const acknowledge = () => {
        const now = Date.now();
        // 三件事一起做：重新累積活躍時長、丟掉已計入的完成紀錄、開始冷卻
        baselineRef.current = getActiveTotalMs();
        completedAtRef.current = [];
        cooldownUntilRef.current = now + config.cooldownMs;
        pendingRef.current = false;
      };

      /**
       * 這次要用哪一種說法。擲骰在提交當下——提前決定的話，設定改了要等
       * 下一次觸發才反映，而兩次觸發之間可能隔一小時。
       */
      const buildRequest = (forced?: RestNudgeVariant): RestNudgeRequest => {
        const chance = getSetting(
          'reader.teaInviteChancePct',
          TEA_INVITE_CHANCE_PCT
        );
        const variant =
          forced ?? (Math.random() * 100 < chance ? 'invite' : 'lazy');
        if (variant !== 'invite') {
          return {
            title: REST_TITLE,
            body: REST_BODY,
            variant: 'lazy',
            onAcknowledge: acknowledge,
          };
        }
        return {
          title: INVITE_TITLE,
          body: INVITE_BODY,
          variant: 'invite',
          action: {
            label: '前往茶會',
            onClick: () => {
              // 旗標要在導航之前寫下——assign 之後這一頁的 JS 不保證還跑得完
              markTeatimeInvited();
              window.location.assign('/teatime');
            },
          },
          onAcknowledge: acknowledge,
        };
      };

      const check = () => {
        if (pendingRef.current) return;
        const now = Date.now();
        if (now < cooldownUntilRef.current) return;

        completedAtRef.current = completedAtRef.current.filter(
          (at) => now - at < config.windowMs
        );

        const activeMs = getActiveTotalMs() - baselineRef.current;
        const byTime = config.activeMs > 0 && activeMs >= config.activeMs;
        const byPages =
          config.pageCount > 0 &&
          completedAtRef.current.length >= config.pageCount;
        if (!byTime && !byPages) return;

        pendingRef.current = true;
        nudgeRef.current.requestRestNudge(buildRequest());
      };

      timer = setInterval(check, CHECK_INTERVAL_MS);

      // 手動驗收：走與 check 相同的提交路徑，只是跳過門檻判定
      window.__uepRestReminderTest = {
        trigger: (variant?: RestNudgeVariant) => {
          if (pendingRef.current) return;
          pendingRef.current = true;
          nudgeRef.current.requestRestNudge(buildRequest(variant));
        },
        dismiss: () => {
          pendingRef.current = false;
          nudgeRef.current.dismissRestNudge();
        },
        state: () => {
          const now = Date.now();
          return {
            activeMs: getActiveTotalMs() - baselineRef.current,
            completedInWindow: completedAtRef.current.filter(
              (at) => now - at < config.windowMs
            ).length,
            cooldownRemainingMs: Math.max(0, cooldownUntilRef.current - now),
            pending: pendingRef.current,
          };
        },
      };
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      delete window.__uepRestReminderTest;
      window.removeEventListener(PROGRESS_CHANGE_EVENT, onProgressChange);
      // 離開 Reader 時把還沒被確認的卡片收掉——它的判定依據
      // （本輪活躍時長）已經隨著離開失去意義
      if (pendingRef.current) {
        pendingRef.current = false;
        nudgeRef.current.dismissRestNudge();
      }
    };
  }, []);
}

/**
 * 無渲染掛載點。放在 `<ReaderShell>` 的 children 裡才在 Provider 的
 * context 範圍內——見檔頭的掛載位置說明。
 */
export function RestReminder(): null {
  useRestReminder();
  return null;
}
