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

export interface RestNudgeRequest {
  title: string;
  body: string;
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
 * U.E.P 趴在卡片上緣。
 *
 * 立繪與卡片同寬、底邊對齊卡片頂線——她是躺在這張牌子上休息，順帶把
 * 「該休息了」這件事演給你看，而不是站在旁邊指著牌子。素材下緣就是她
 * 貼地的那條線（轉檔時已去掉透明邊），所以直接對齊就是趴著的樣子。
 */
const UEP_ART = '/uep/art/rest-lazy.webp';
/** 原始像素，給瀏覽器先算好版面比例 */
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
  /**
   * 退場只能觸發一次。用 ref 不用上面那個 state——連按時三次 onClick 會在
   * 同一批更新內同步跑完，那時 `leaving` 還是 false，state 擋不住。
   */
  const leavingRef = useRef(false);

  // 卸載時清掉退場計時器：換頁時 React 會直接拔掉這棵樹，
  // 留著的 setTimeout 會對已卸載的元件呼叫 setState
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const acknowledge = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    // 動畫演完才通知提交方——提前通知的話卡片會在滑回去的半路上被拔掉
    timerRef.current = window.setTimeout(onDone, LEAVE_MS);
  }, [onDone]);

  return (
    <div
      className={`rnudge rnudge--rest${leaving ? ' rnudge--leaving' : ''}`}
      role="status"
      aria-live="polite"
    >
      <img
        className="rnudge-art"
        src={UEP_ART}
        width={UEP_ART_SIZE.width}
        height={UEP_ART_SIZE.height}
        alt=""
        aria-hidden="true"
      />
      <div className="rnudge-card">
        <div className="rnudge-eyebrow">READING RHYTHM</div>
        <div className="rnudge-title">{rest.title}</div>
        <div className="rnudge-body">{rest.body}</div>
        <button type="button" className="rnudge-action" onClick={acknowledge}>
          知道了
        </button>
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
