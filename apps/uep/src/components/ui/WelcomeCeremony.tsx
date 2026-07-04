/**
 * 登入 / 註冊成功轉場儀式（Epic 2 S5 打磨輪 3）
 *
 * 從 /login 頁完成 auth 後不立刻導頁——先播一段短促的「迎接」轉場：
 * 頂部升起金色細線、中央顯示代稱與極簡祝賀語、底部同樣一線收攏。
 * 結束後才 onDone → 呼叫端執行 window.location.href（跳回來源頁）。
 *
 * 與 ViewSwitchCeremony 語意分工：這個是「從無到有的迎接」，
 * ViewSwitchCeremony 是「已在世界內的身分轉換」——兩者刻意不共用素材。
 *
 * 走 createPortal 掛到 body：頁面容器可能有 transform 建立 stacking
 * context，會鎖住 fixed 定位的元素。
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import './WelcomeCeremony.css';

interface Props {
  alias: string;
  kind: 'login' | 'register';
  onDone: () => void;
}

/** 儀式總時長；reduced-motion 縮短到 700ms */
const CEREMONY_MS = 2200;
const CEREMONY_MS_REDUCED = 700;

const KICKER: Record<Props['kind'], string> = {
  login: 'RECORD RESUMED',
  register: 'RECORD BEGUN',
};

const GREETING: Record<Props['kind'], string> = {
  login: '記錄已接續',
  register: '記錄已銘刻',
};

export default function WelcomeCeremony({ alias, kind, onDone }: Props) {
  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(onDone, reduced ? CEREMONY_MS_REDUCED : CEREMONY_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="uep-welcome"
      role="status"
      aria-live="polite"
      aria-label={`${GREETING[kind]}，${alias}`}
    >
      <div className="uep-welcome__veil" />

      <div className="uep-welcome__stage">
        {/* 上下對稱的金線：從中心向兩側延伸出來——「開場」的儀式感 */}
        <div
          className="uep-welcome__rule uep-welcome__rule--top"
          aria-hidden="true"
        />

        <div className="uep-welcome__kicker">{KICKER[kind]}</div>
        <div className="uep-welcome__alias">{alias}</div>
        <div className="uep-welcome__greeting">{GREETING[kind]}</div>

        <div
          className="uep-welcome__rule uep-welcome__rule--bottom"
          aria-hidden="true"
        />
      </div>
    </div>,
    document.body
  );
}
