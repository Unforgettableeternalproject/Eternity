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
 */

import React from 'react';

import { useReaderAuth } from '../../auth';

import './RecordPanel.css';

/** 站內 return 路徑消毒：只允許站內、非 /login 自己 */
function buildReturn(): string {
  if (typeof window === 'undefined') return '/';
  const p = window.location.pathname + window.location.search;
  if (!p.startsWith('/') || p.startsWith('//')) return '/';
  if (p.startsWith('/login')) return '/';
  return p;
}

export default function RecordPanel() {
  const session = useReaderAuth();

  /* 已登入：不佔位——識別證會取代這個位置 */
  if (session) return null;

  const returnUrl = buildReturn();
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
