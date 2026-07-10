/**
 * 入站儀式 — 初次進入網站的身分選擇（Epic 2 S5）
 *
 * 觸發條件：localStorage 完全沒有身分紀錄（onboard 標記與進度都不存在）。
 * - 在非主頁：導回主頁進行儀式（deep link 在完成儀式後不再受影響）
 * - 在主頁：全螢幕互動視窗，選擇以探索者或觀測者的身分遊歷世界
 * - 選擇觀測者：進入觀測者協議儀式（劇透警告 + 永久印記）
 *
 * 向後相容：已有進度紀錄（uep.progress.v1）的舊使用者視為已完成儀式，
 * 靜默補上標記、不重複打擾。
 */

import React, { useEffect, useState } from 'react';

import { PROGRESS_STORAGE_KEY } from '../../progress/adapters';
import { getProgressManager } from '../../progress/progressStore';
import ObserverGate from './ObserverGate';

import './OnboardingGate.css';

/** 完成入站儀式的永久標記 */
export const ONBOARDED_KEY = 'uep.onboarded.v1';

type Stage = 'hidden' | 'choice' | 'observer-gate';

interface OnboardingTestBridge {
  /** 直接叫出身分選擇視窗，不修改任何紀錄。 */
  showChoice(): void;
  /** 直接叫出觀測者協議儀式，不修改任何紀錄。 */
  showObserverGate(): void;
  /** 關閉目前入站測試視窗。 */
  hide(): void;
  /**
   * 清除本機訪客入站紀錄與進度，用來模擬全新訪客。
   * 預設會導回主頁重新載入，確保 module singleton 也回到乾淨狀態。
   */
  resetLocalIdentity(options?: { reload?: boolean }): void;
  /** 查看目前入站測試狀態。 */
  status(): {
    stage: Stage;
    onboarded: boolean;
    progressExists: boolean;
    path: string;
  };
}

declare global {
  interface Window {
    __uepOnboardingTest?: OnboardingTestBridge;
  }
}

function hasIdentityRecord(): boolean {
  try {
    return (
      window.localStorage.getItem(ONBOARDED_KEY) !== null ||
      window.localStorage.getItem(PROGRESS_STORAGE_KEY) !== null
    );
  } catch {
    // localStorage 不可用：不打擾，直接放行
    return true;
  }
}

function markOnboarded(): void {
  try {
    window.localStorage.setItem(ONBOARDED_KEY, new Date().toISOString());
  } catch {
    // 寫不進去就算了——下次會再問一次，不阻斷
  }
}

/** 儀式期間掛在 body 上的 class，讓浮島等固定元素能被 CSS 一律隱藏
 *  （z-index 在 fixed + 有 transform 祖先時不一定夠力，用 class 最保險） */
const ONBOARDING_ACTIVE_CLASS = 'uep-onboarding-active';

export default function OnboardingGate() {
  const [stage, setStage] = useState<Stage>('hidden');

  /* 儀式活躍時鎖住其他固定 UI（Minimap 等），避免穿透遮罩 */
  useEffect(() => {
    const active = stage !== 'hidden';
    document.body.classList.toggle(ONBOARDING_ACTIVE_CLASS, active);
    return () => {
      document.body.classList.remove(ONBOARDING_ACTIVE_CLASS);
    };
  }, [stage]);

  useEffect(() => {
    const bridge: OnboardingTestBridge = {
      showChoice() {
        setStage('choice');
      },
      showObserverGate() {
        setStage('observer-gate');
      },
      hide() {
        setStage('hidden');
      },
      resetLocalIdentity(options) {
        try {
          window.localStorage.removeItem(ONBOARDED_KEY);
          window.localStorage.removeItem(PROGRESS_STORAGE_KEY);
        } catch {
          /* 忽略 */
        }
        if (options?.reload === false) {
          setStage('choice');
          return;
        }
        window.location.assign('/');
      },
      status() {
        let onboarded = false;
        let progressExists = false;
        try {
          onboarded = window.localStorage.getItem(ONBOARDED_KEY) !== null;
          progressExists =
            window.localStorage.getItem(PROGRESS_STORAGE_KEY) !== null;
        } catch {
          /* 忽略 */
        }
        return {
          stage,
          onboarded,
          progressExists,
          path: window.location.pathname,
        };
      },
    };
    window.__uepOnboardingTest = bridge;
    return () => {
      if (window.__uepOnboardingTest === bridge) {
        delete window.__uepOnboardingTest;
      }
    };
  }, [stage]);
  useEffect(() => {
    if (hasIdentityRecord()) {
      // 舊使用者（有進度無標記）：靜默補標記
      try {
        if (window.localStorage.getItem(ONBOARDED_KEY) === null) {
          markOnboarded();
        }
      } catch {
        /* 忽略 */
      }
      return;
    }
    // 無身分紀錄：非主頁一律先導回主頁進行儀式
    if (window.location.pathname !== '/') {
      window.location.replace('/');
      return;
    }
    setStage('choice');
  }, []);

  if (stage === 'hidden') return null;

  function chooseExplorer() {
    markOnboarded();
    getProgressManager().setView('explorer');
    setStage('hidden');
    window.__uepToastManager?.info('旅程開始了。世界會隨著你的足跡慢慢展開。');
  }

  function confirmObserver() {
    markOnboarded();
    getProgressManager().setView('observer');
    setStage('hidden');
    window.__uepToastManager?.info('印記已烙下。歡迎，觀測者。');
  }

  if (stage === 'observer-gate') {
    return (
      <ObserverGate
        onConfirm={confirmObserver}
        onCancel={() => setStage('choice')}
      />
    );
  }

  return (
    <div
      className="uep-onboard"
      role="dialog"
      aria-modal="true"
      aria-labelledby="uep-onboard-title"
    >
      <div className="uep-onboard__veil" />
      <div className="uep-onboard__panel">
        <div className="uep-onboard__kicker">U.E.P · IMAGINARY SPACE</div>
        <h2 id="uep-onboard-title" className="uep-onboard__title">
          你想以什麼身分遊歷這個世界？
        </h2>
        <p className="uep-onboard__sub">
          這個選擇隨時可以改變——但有些選擇，會留下永久的痕跡。
        </p>

        <div className="uep-onboard__cards">
          <button
            type="button"
            className="uep-onboard__card"
            onClick={chooseExplorer}
          >
            <div className="uep-onboard__card-glyph">◈</div>
            <div className="uep-onboard__card-name">探索者</div>
            <div className="uep-onboard__card-desc">
              世界隨你的足跡展開。篇章、人物、記憶——都要親自走過才會顯現。
            </div>
            <div className="uep-onboard__card-note">推薦的遊歷方式</div>
          </button>

          <button
            type="button"
            className="uep-onboard__card uep-onboard__card--observer"
            onClick={() => setStage('observer-gate')}
          >
            <div className="uep-onboard__card-glyph">◉</div>
            <div className="uep-onboard__card-name">觀測者</div>
            <div className="uep-onboard__card-desc">
              一切對你敞開，不受進度所限。但這雙眼睛，會留下永久的印記。
            </div>
            <div className="uep-onboard__card-note">包含大量劇透</div>
          </button>
        </div>

        {/* 已註冊者的捷徑（S7 驗收 #1）：直接前往登入頁，
            不標記 onboarded——登入成功後進度鏡像落地即視為已完成儀式；
            中途折返則下次來訪儀式照常出現 */}
        <div className="uep-onboard__login">
          <a className="uep-onboard__login-link" href="/login?return=%2F">
            已經銘刻過記錄？直接登入 ▸
          </a>
        </div>
      </div>
    </div>
  );
}
