/**
 * Reader 提示層（S10-4 A／B 段）
 *
 * 五個 Reader 共用的低調提示位，目前有兩種：
 *
 * - **AFK 提示**：閒置超過閾值時淡入。`pointer-events: none`、沒有按鈕、
 *   任何活動即消失。刻意不放「我還在」按鈕——使用者要證明自己在，最自然的
 *   動作就是動一下滑鼠，而那正是 activityWatch 已經在聽的東西；加按鈕等於
 *   要求使用者用一個特定動作去回答一個任何動作都能回答的問題。
 * - **休息提醒**（只 History 會提交）：有「知道了」按鈕且會停留。它要求的是
 *   一個決定，不是一個動作，所以不會被 pointermove 自動關掉。
 *
 * 兩者共用同一層，同一時間只顯示一張：idle 時 AFK 優先，休息提醒暫存，
 * 等使用者恢復活動、AFK 卡消失後再顯示。
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
  useState,
} from 'react';

import {
  isIdleNudgeEnabled,
  startActivityWatch,
  stopActivityWatch,
} from '../../lib/activityWatch';
import { useIdleState } from '../../lib/useIdleState';

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

const AFK_TITLE = '你還在嗎';
const AFK_BODY = '這一頁還開著。動一下就好。';

export function ReaderNudgeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { idle } = useIdleState();
  const [nudgeEnabled, setNudgeEnabled] = useState(false);
  const [rest, setRest] = useState<RestNudgeRequest | null>(null);

  // activityWatch 是全站單例，但生命週期綁在 Reader 上——離開 Reader 就
  // 沒有消費端了，繼續掛著全域 listener 只是徒增負擔
  useEffect(() => {
    let cancelled = false;
    void startActivityWatch().then(() => {
      // 提示開關要等設定就緒才知道，start 前讀到的是程式碼預設值
      if (!cancelled) setNudgeEnabled(isIdleNudgeEnabled());
    });
    return () => {
      cancelled = true;
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

  const showAfk = idle && nudgeEnabled;
  const showRest = !showAfk && rest !== null;

  return (
    <ReaderNudgeContext.Provider value={api}>
      {children}

      {showAfk && (
        <div className="rnudge rnudge--afk" role="status" aria-live="polite">
          <div className="rnudge-card">
            <div className="rnudge-title">{AFK_TITLE}</div>
            <div className="rnudge-body">{AFK_BODY}</div>
          </div>
        </div>
      )}

      {showRest && rest && (
        <div className="rnudge rnudge--rest" role="status" aria-live="polite">
          <div className="rnudge-card">
            <div className="rnudge-title">{rest.title}</div>
            <div className="rnudge-body">{rest.body}</div>
            <button
              type="button"
              className="rnudge-action"
              onClick={() => {
                rest.onAcknowledge();
                setRest(null);
              }}
            >
              知道了
            </button>
          </div>
        </div>
      )}
    </ReaderNudgeContext.Provider>
  );
}
