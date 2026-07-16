/**
 * 記錄按鈕 — TopBar 右上角登入入口（Epic 2 S5）
 *
 * S5 重構後：登入/註冊全部移到獨立的 /login 頁面。
 * 本元件只做兩件事：
 * 1. 未登入時渲染「記錄」按鈕，連到 /login?return=<current pathname>
 * 2. 已登入時 return null——TopBar 該位置改由識別證（IdentCard）接手
 *
 * ViewSwitch 已完全撤出，改由識別證內部呈現（一致的觀看方式入口）。
 * 檔名 RecordPanel 為保留舊 import 相容，語意上其實是 RecordButton。
 *
 * pathname 追蹤：因為 Astro ClientRouter（原 ViewTransitions）換頁時
 * island 不 remount，若把 return URL 寫死在 render 就會卡在初次載入的
 * 路徑。改用 state + astro:page-load 事件監聽，換頁後立即同步當前 pathname。
 */

import React, { useEffect, useState } from 'react';

import { useReaderAuth } from '../../auth';

import './RecordPanel.css';

/** 站內 return 路徑消毒：只允許站內、非 /login 自己 */
function sanitize(raw: string): string {
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  if (raw.startsWith('/login')) return '/';
  return raw;
}

/** 讀取當前 pathname + search（SSR 安全） */
function readPath(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname + window.location.search;
}

export default function RecordPanel() {
  const session = useReaderAuth();
  /** 當前路徑；SSR 給預設值，client mount 後即刻由 useEffect 同步真實值 */
  const [path, setPath] = useState<string>('/');

  useEffect(() => {
    /* mount 後立即抓一次，補上 SSR 值與真實值的差 */
    setPath(readPath());
    /* Astro ClientRouter 換頁事件——view transition 不 remount island，
       靠這個 event 才知道 pathname 已改變 */
    function onPageLoad() {
      setPath(readPath());
    }
    document.addEventListener('astro:page-load', onPageLoad);
    return () => {
      document.removeEventListener('astro:page-load', onPageLoad);
    };
  }, []);

  /* 已登入：不佔位——識別證會取代這個位置 */
  if (session) return null;

  const returnUrl = sanitize(path);
  const href = `/login?return=${encodeURIComponent(returnUrl)}`;

  return (
    <a
      className="btn-outline uep-record-trigger"
      href={href}
      title="登入或建立記錄"
    >
      ✎ 記錄
    </a>
  );
}
