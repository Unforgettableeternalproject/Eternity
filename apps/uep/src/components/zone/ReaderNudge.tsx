/**
 * Reader 提示層（S10-4 A／B 段）
 *
 * 兩套機制共用這一層，但形狀完全不同：
 *
 * - **閒置**：不是提示卡，是從四周漫入的靜電霧（`IdleVeil`）。狀態機在
 *   `lib/idleVeil.ts`，這裡只負責啟動它與掛上渲染層。
 * - **休息提醒**（只 History 會提交）：U.E.P 從畫面右側探出來的小卡，
 *   不擋內容、不遮畫面，按「知道了」就滑回去。
 *
 * ## 兩次改版都是同一個教訓
 *
 * 08/03 把閒置提示從「動一下就消失的浮字」改成「要按確認的 modal」，
 * 08/04 又整個換成帷幕。中間那版 modal 解決的是真問題（提示會在使用者
 * 沒看到的情況下來去一遍），但解法選錯了——它把「你還在嗎」變成一道
 * 要人回答的關卡。帷幕保留了回饋（看得到霧、看得到自己撥開多少），
 * 卻不需要任何按鈕。
 *
 * 📌 所以這一層現在只剩休息提醒需要 context：它要求的是一個決定
 * （現在休不休息），而掛機不是問題，是狀態。
 *
 * 資料流走 context 而不是 window event bridge——ReaderShell 是 HistoryReader
 * 的父層，資訊本來就能往上傳，專案已有三套島訊號 bridge，再加一套的門檻
 * 應該很高。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { startActivityWatch, stopActivityWatch } from '../../lib/activityWatch';
import { startIdleVeil, stopIdleVeil } from '../../lib/idleVeil';

import IdleVeil from './IdleVeil';

import './ReaderNudge.css';

/**
 * 休息提醒的兩種面孔：`lazy` 是單純的「該休息了」，`invite` 是她順便邀你
 * 去喝杯茶。差別在立繪與是否多一顆行動鈕，判定（擲骰）留在提交方。
 */
export type RestNudgeVariant = 'lazy' | 'invite';

export interface RestNudgeRequest {
  title: string;
  body: string;
  /** 預設 `lazy` */
  variant?: RestNudgeVariant;
  /**
   * 確認鈕之外的第二顆按鈕。按下後不播退場動畫——它的行為是導航，
   * 演給正在離開的畫面看沒有意義。
   */
  action?: { label: string; onClick: () => void };
  /** 按下確認鈕時呼叫——冷卻與 baseline 的重設由提交方負責 */
  onAcknowledge: () => void;
}

interface ReaderNudgeContextValue {
  requestRestNudge: (req: RestNudgeRequest) => void;
  dismissRestNudge: () => void;
}

/**
 * Provider 外呼叫時是 no-op 而不是丟錯。Reader 元件在單元測試裡常單獨
 * render，為了一個提示位就要求每個測試包一層 Provider 不划算；行為上
 * 「沒有提示層可用」與「提示層存在但沒東西可顯示」對消費端沒有差別。
 */
const ReaderNudgeContext = createContext<ReaderNudgeContextValue>({
  requestRestNudge: () => {},
  dismissRestNudge: () => {},
});

export function useReaderNudge(): ReaderNudgeContextValue {
  return useContext(ReaderNudgeContext);
}

/** 滑回去的動畫時間，與 CSS 的 `ivl`／`rnudge--leaving` 對齊 */
const LEAVE_MS = 460;

/**
 * 沒有人回應的話，卡片自己退場的時間。
 *
 * 提醒是善意的提議，不是待辦事項——沒被理會就該安靜地收起來，而不是
 * 一直掛在畫面角落。退場走的是**與按下「知道了」完全相同的路徑**：
 * 重設 baseline、開始冷卻。
 *
 * ⚠️ 不能只是把卡片拿掉而不重設判定：門檻早就達標了，下一次 15 秒的
 * 巡檢會立刻再送一張出來，變成每 20 秒閃一次的迴圈。
 */
const AUTO_DISMISS_MS = 20_000;

/**
 * U.E.P 趴在卡片上緣。
 *
 * 立繪與卡片同寬、底邊對齊卡片頂線——她是躺在這張牌子上休息，順帶把
 * 「該休息了」這件事演給你看，而不是站在旁邊指著牌子。素材下緣就是她
 * 貼地的那條線（轉檔時已去掉透明邊），所以直接對齊就是趴著的樣子。
 */
const UEP_ART: Record<RestNudgeVariant, string> = {
  lazy: '/uep/art/rest-lazy.webp',
  invite: '/uep/art/rest-invite.webp',
};
/**
 * 原始像素，給瀏覽器先算好版面比例。兩張是同一構圖的差分，在轉檔階段就
 * 共用同一個裁切框（`frames: 'rest'`），所以尺寸必然相同——這也是換圖時
 * 她不會跳位的原因。
 */
const UEP_ART_SIZE = { width: 1200, height: 635 };

function RestNudgeCard({
  rest,
  onDone,
}: {
  rest: RestNudgeRequest;
  onDone: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<number | null>(null);
  const autoTimerRef = useRef<number | null>(null);
  /**
   * 退場只能觸發一次。用 ref 不用上面那個 state——連按時三次 onClick 會在
   * 同一批更新內同步跑完，那時 `leaving` 還是 false，state 擋不住。
   */
  const leavingRef = useRef(false);

  // 卸載時清掉兩個計時器：換頁時 React 會直接拔掉這棵樹，
  // 留著的 setTimeout 會對已卸載的元件呼叫 setState
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (autoTimerRef.current !== null) {
        window.clearTimeout(autoTimerRef.current);
      }
    },
    []
  );

  const acknowledge = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    if (autoTimerRef.current !== null) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    // 動畫演完才通知提交方——提前通知的話卡片會在滑回去的半路上被拔掉
    timerRef.current = window.setTimeout(onDone, LEAVE_MS);
  }, [onDone]);

  /* 沒有人理會就自己收起來。走 acknowledge 而不是另一條路徑——
     「使用者按了」與「使用者沒理」在判定上該有同樣的後果，兩者都表示
     這一次的提醒已經完成任務了 */
  useEffect(() => {
    autoTimerRef.current = window.setTimeout(acknowledge, AUTO_DISMISS_MS);
    return () => {
      if (autoTimerRef.current !== null) {
        window.clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
  }, [acknowledge]);

  return (
    <div
      className={`rnudge rnudge--rest${leaving ? ' rnudge--leaving' : ''}`}
      role="status"
      aria-live="polite"
    >
      <img
        className="rnudge-art"
        src={UEP_ART[rest.variant ?? 'lazy']}
        width={UEP_ART_SIZE.width}
        height={UEP_ART_SIZE.height}
        alt=""
        aria-hidden="true"
      />
      <div className="rnudge-card">
        <div className="rnudge-eyebrow">READING RHYTHM</div>
        <div className="rnudge-title">{rest.title}</div>
        <div className="rnudge-body">{rest.body}</div>
        <div className="rnudge-actions">
          <button type="button" className="rnudge-action" onClick={acknowledge}>
            知道了
          </button>
          {rest.action && (
            <button
              type="button"
              className="rnudge-action rnudge-action--primary"
              onClick={rest.action.onClick}
            >
              {rest.action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReaderNudgeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [rest, setRest] = useState<RestNudgeRequest | null>(null);

  // activityWatch 與帷幕都是全站單例，但生命週期綁在 Reader 上——離開
  // Reader 就沒有消費端了，繼續掛著全域 listener 只是徒增負擔
  useEffect(() => {
    /* start 會等 settings fetch，這段期間離開 Reader 的話 cleanup 早就跑完，
       promise 才 resolve——沒有這道 guard 就會在沒有消費端的情況下把帷幕的
       全域訂閱重新掛上，而且再也沒有人會去解除它 */
    let cancelled = false;
    void startActivityWatch().then(() => {
      if (cancelled) return;
      // 帷幕要讀 `reader.idleNudgeMode`，等 settings 就緒才啟動；
      // start 之前讀到的是程式碼預設值
      startIdleVeil();
    });
    return () => {
      cancelled = true;
      stopIdleVeil();
      stopActivityWatch();
    };
  }, []);

  /*
   * 立繪要先熱好，不然滑入動畫等於白做。
   *
   * 卡片是 620ms 滑進來的，而立繪要等到卡片掛載那一刻才開始下載——第一次
   * 觸發時滑入早就跑完了圖才蹦出來，看起來就是「卡片滑進來、然後圖直接
   * 出現」。第二次之後有快取才正常，所以這個問題只在最需要它好看的那次發生。
   *
   * 走 idle callback 而不是直接 new Image()：休息提醒平均要等幾十分鐘才
   * 觸發，沒有理由跟首屏內容搶頻寬。
   */
  useEffect(() => {
    let cancelled = false;
    /* 兩個差分都要熱：哪一張會用到是觸發當下才擲的骰，等到那時再載就晚了 */
    const warm = () => {
      if (cancelled) return;
      for (const src of Object.values(UEP_ART)) new Image().src = src;
    };
    // 型別上 requestIdleCallback 一定存在，實際上 Safari 16.4 之前沒有——
    // 用 typeof 檢查而不是真值判斷，才不會被判成恆真
    const hasIdle = typeof window.requestIdleCallback === 'function';
    const handle = hasIdle
      ? window.requestIdleCallback(warm, { timeout: 4000 })
      : window.setTimeout(warm, 2000);
    return () => {
      cancelled = true;
      if (hasIdle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  const requestRestNudge = useCallback((req: RestNudgeRequest) => {
    setRest(req);
  }, []);

  const dismissRestNudge = useCallback(() => {
    setRest(null);
  }, []);

  const api = useMemo(
    () => ({ requestRestNudge, dismissRestNudge }),
    [requestRestNudge, dismissRestNudge]
  );

  return (
    <ReaderNudgeContext.Provider value={api}>
      {children}

      <IdleVeil />

      {rest && (
        <RestNudgeCard
          rest={rest}
          onDone={() => {
            rest.onAcknowledge();
            setRest(null);
          }}
        />
      )}
    </ReaderNudgeContext.Provider>
  );
}
