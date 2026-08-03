/**
 * Reader 提示層（S10-4 A／B 段）
 *
 * 五個 Reader 共用的提示位，目前有兩種，都是**需要確認才消失的強制卡**：
 *
 * - **AFK 提示**：閒置超過閾值時跳出，backdrop 模糊遮住內容——人不在時
 *   內容不該裸露在螢幕上。按「我還在」才收起。
 * - **休息提醒**（只 History 會提交）：backdrop 只暗化不模糊，語氣是善意
 *   提示而不是攔阻，內容仍隱約可見。
 *
 * ⚠️ AFK 卡原本的契約是「`pointer-events: none`、任何活動即消失」，
 * 2026-08-03 由艾斯維爾反轉。理由是那個設計在真實情境下會自我抵銷：
 * 從 DevTools 觸發後必須動滑鼠去關視窗，卡片當場就被自己的關閉條件收掉；
 * 更根本的是「動一下就消失」讓提示可以在使用者完全沒看到的情況下來去一遍。
 * 現在改由 `afkOpen` 這個閂鎖控制——**進 idle 時上鎖，離開 idle 不解鎖**，
 * 只有按下確認才解。
 *
 * 兩者共用同一層，同一時間只顯示一張：AFK 優先，休息提醒暫存，
 * 等 AFK 被確認後再顯示。
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

import {
  isIdleNudgeEnabled,
  noteActivity,
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
const AFK_BODY = '這一頁還開著，但已經有一陣子沒有動靜了。';
const AFK_ACTION = '我還在';

/**
 * 兩張卡共用的外殼。差別只有 backdrop 的遮蔽強度與強調色，
 * 結構、無障礙語意、焦點處理都一樣，沒有理由寫兩份。
 */
function NudgeDialog({
  variant,
  eyebrow,
  title,
  body,
  actionLabel,
  onConfirm,
}: {
  variant: 'afk' | 'rest';
  eyebrow: string;
  title: string;
  body: string;
  actionLabel: string;
  onConfirm: () => void;
}) {
  const titleId = React.useId();
  const actionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // preventScroll：卡片是 fixed 定位，聚焦不該把底下的內容捲走
    actionRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      className={`rnudge rnudge--${variant}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      // 卡片內只有一個可聚焦元素，Tab 沒有去處——放它走會把焦點交給
      // backdrop 底下那些看不見也點不到的東西
      onKeyDown={(e) => {
        if (e.key === 'Tab') e.preventDefault();
      }}
    >
      <div className="rnudge-card">
        <div className="rnudge-eyebrow">{eyebrow}</div>
        <div className="rnudge-title" id={titleId}>
          {title}
        </div>
        <div className="rnudge-body">{body}</div>
        <button
          ref={actionRef}
          type="button"
          className="rnudge-action"
          onClick={onConfirm}
        >
          {actionLabel}
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
  const { idle } = useIdleState();
  const [nudgeEnabled, setNudgeEnabled] = useState(false);
  const [rest, setRest] = useState<RestNudgeRequest | null>(null);
  /** AFK 卡的閂鎖。進 idle 時上鎖，只有按下確認才解 */
  const [afkOpen, setAfkOpen] = useState(false);

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

  // 上鎖只看「有沒有進 idle」，不看它現在是不是還 idle——解鎖權在使用者手上
  useEffect(() => {
    if (idle && nudgeEnabled) setAfkOpen(true);
  }, [idle, nudgeEnabled]);

  const acknowledgeAfk = useCallback(() => {
    setAfkOpen(false);
    // 確認即重新起算：不做的話 activityWatch 若仍在 idle（例如用鍵盤按下
    // 確認鈕，沒有任何 pointer 事件），下一個 tick 會立刻把卡片再叫回來
    noteActivity();
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

  const showRest = !afkOpen && rest !== null;

  return (
    <ReaderNudgeContext.Provider value={api}>
      {children}

      {afkOpen && (
        <NudgeDialog
          variant="afk"
          eyebrow="AWAY FROM KEYBOARD"
          title={AFK_TITLE}
          body={AFK_BODY}
          actionLabel={AFK_ACTION}
          onConfirm={acknowledgeAfk}
        />
      )}

      {showRest && rest && (
        <NudgeDialog
          variant="rest"
          eyebrow="READING RHYTHM"
          title={rest.title}
          body={rest.body}
          actionLabel="知道了"
          onConfirm={() => {
            rest.onAcknowledge();
            setRest(null);
          }}
        />
      )}
    </ReaderNudgeContext.Provider>
  );
}
