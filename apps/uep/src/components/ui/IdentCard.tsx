/**
 * 身分證吊掛面板 — 登入後出現的固定元件（Epic 2 S5）
 *
 * 概念：像一張掛在頁面邊緣的識別證。未展開時是垂掛的小吊牌，
 * 點擊後沿吊繩滑下展開成完整的身分證：代稱（含「已見證的」前綴）、
 * 帳號、視角、概略進度。視角切換也收在這裡（記錄/Profile 面板的一部分）。
 *
 * 相對進度（對照全站主線）待主線進度定義制定後再接上，
 * 目前先以計數呈現。
 */

import React, { useState } from 'react';

import { getReaderAuth, useReaderAuth } from '../../auth';
import { useProgress } from '../../progress/useProgress';
import ViewSwitch from './ViewSwitch';

import './IdentCard.css';

export default function IdentCard() {
  const session = useReaderAuth();
  const progress = useProgress();
  const [open, setOpen] = useState(false);

  /* 訪客沒有身分證——這是銘刻過記錄的人才有的東西 */
  if (!session) return null;

  const isObserver = progress.view === 'observer';

  return (
    <div className={`uep-ident${open ? ' is-open' : ''}`}>
      {/* 吊繩 + 吊牌：固定在 TopBar 下緣的掛點，開合時不變形不位移 */}
      <div className="uep-ident__hanger">
        <div className="uep-ident__cord" aria-hidden="true" />
        <button
          type="button"
          className="uep-ident__tab"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? '收起身分證' : '查看身分證'}
        >
          <span className="uep-ident__tab-glyph" aria-hidden="true">
            {isObserver ? '◉' : '◈'}
          </span>
          <span className="uep-ident__tab-label">識別證</span>
        </button>
      </div>

      {/* 證卡本體 */}
      {open && (
        <div className="uep-ident__card" role="region" aria-label="身分證">
          <div className="uep-ident__punch" aria-hidden="true" />
          <div className="uep-ident__kicker">U.E.P · IDENTIFICATION</div>

          <div className="uep-ident__alias">
            {getReaderAuth().displayAlias()}
          </div>
          <div className="uep-ident__username">@{session.username}</div>

          <div className="uep-ident__sep" />

          <div className="uep-ident__rows">
            <div className="uep-ident__row">
              <span className="uep-ident__row-label">視角</span>
              <span className="uep-ident__row-value">
                {isObserver ? '◉ 觀測者' : '◈ 探索者'}
              </span>
            </div>
            <div className="uep-ident__row">
              <span className="uep-ident__row-label">走過的篇章</span>
              <span className="uep-ident__row-value">
                {progress.completedPageIds.length}
              </span>
            </div>
            <div className="uep-ident__row">
              <span className="uep-ident__row-label">留下的印象</span>
              <span className="uep-ident__row-value">
                {progress.flags.length}
              </span>
            </div>
            {progress.islandsUnlocked.length > 0 && (
              <div className="uep-ident__row">
                <span className="uep-ident__row-label">喚醒的浮島</span>
                <span className="uep-ident__row-value">
                  {progress.islandsUnlocked.length}
                </span>
              </div>
            )}
            {session.observerEver && (
              <div className="uep-ident__row uep-ident__row--mark">
                <span className="uep-ident__row-label">印記</span>
                <span className="uep-ident__row-value">已見證</span>
              </div>
            )}
          </div>

          <div className="uep-ident__sep" />

          <div className="uep-ident__view-row">
            <span className="uep-ident__row-label">觀看世界的方式</span>
            <ViewSwitch />
          </div>
        </div>
      )}
    </div>
  );
}
