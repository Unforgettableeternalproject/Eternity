/**
 * UEP 浮島系統 — 設定視窗（識別證齒輪開啟）
 *
 * 使用者自行開關已解鎖的浮島；未解鎖的顯示鎖定態，問號 hover／聚焦時
 * 浮出漸進解碼的解鎖提示（2026-08-12 定案，推翻早前「不透露解鎖方式」的
 * 原則——提示指向地點與行為暗示、隨 zone 熟悉度逐字解密、永不揭露全句，
 * 見 unlockHints.ts；不常駐顯示，要湊近看才看得清）。
 * createPortal 掛到 body：IdentCard 在 TopBar 的 sticky 堆疊上下文內，
 * 不 portal 的話 z-index 對外會被鎖在 100 層。
 *
 * 停用狀態寫進 ProgressState.islandsDisabled（登入者自動同步到伺服器）。
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { getProgressManager, useProgress } from '../progress';

import { requestGuide } from './guide/guideRequest';
import { hasGuide } from './guide/guideSteps';
import IslandIcon from './IslandIcon';
import { isIslandDisabled, isIslandUnlocked } from './islandRuntime';
import { revealedUnlockHint } from './unlockHints';
import { ISLAND_DEFINITIONS, ISLAND_IDS } from './types';

import islandsCss from './islands.css?inline';
import { useDeferredStyle } from './useDeferredStyle';

interface IslandSettingsPanelProps {
  onClose: () => void;
}

export default function IslandSettingsPanel({
  onClose,
}: IslandSettingsPanelProps) {
  useDeferredStyle('islands-shell', islandsCss);
  const progress = useProgress();

  // Esc 關閉
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="uep-island-settings" onClick={onClose} role="presentation">
      <div
        className="uep-island-settings__panel"
        role="dialog"
        aria-modal="true"
        aria-label="浮島偏好設定"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="uep-island-settings__title">浮島偏好</div>
        <div className="uep-island-settings__subtitle">
          UEP · Island Preferences
        </div>

        <div className="uep-island-settings__rows">
          {ISLAND_IDS.map((id) => {
            const def = ISLAND_DEFINITIONS[id];
            const unlocked = isIslandUnlocked(progress, id);
            const enabled = unlocked && !isIslandDisabled(progress, id);

            if (!unlocked) {
              return (
                <div
                  key={id}
                  className="uep-island-settings__row uep-island-settings__row--locked"
                >
                  {/* 問號本身是提示的入口：hover／鍵盤聚焦時浮出解鎖提示
                      （艾斯維爾 2026-08-12：不要常駐文字，要湊近才看得清）。
                      按下去沒有動作——揭示靠 CSS 的 :hover/:focus-visible。
                      遮蔽字元對 AT 是雜訊，氣泡整段 aria-hidden，語意由
                      按鈕的 aria-label 承擔 */}
                  <button
                    type="button"
                    className="uep-island-settings__row-icon uep-island-settings__hint-btn"
                    aria-label="解鎖提示（隨探索逐步解密）"
                  >
                    ?
                    <span
                      className="uep-island-settings__hint"
                      role="tooltip"
                      aria-hidden
                    >
                      {revealedUnlockHint(progress, id)}
                    </span>
                  </button>
                  <span className="uep-island-settings__row-name">
                    未知的浮島
                  </span>
                  <span className="uep-island-settings__row-state">
                    尚未喚醒
                  </span>
                </div>
              );
            }

            return (
              <div key={id} className="uep-island-settings__row">
                <span className="uep-island-settings__row-icon" aria-hidden>
                  <IslandIcon id={id} size={18} />
                </span>
                <span className="uep-island-settings__row-name">
                  {def.title}
                </span>
                {/* 回顧鈕只給「已解鎖且啟用中」的島。停用的語意就是
                    「我現在不要這個東西」，為了回顧硬把島掛回來與那個
                    表態相衝突；未解鎖的列連名字都不顯示，更不會有教學。 */}
                {enabled && hasGuide(id) && (
                  <button
                    type="button"
                    className="uep-island-settings__guide"
                    aria-label={`重看${def.title}的說明`}
                    title="重看說明"
                    onClick={() => {
                      // 先關掉自己：面板是 modal，留著會蓋住教學
                      onClose();
                      requestGuide(id);
                    }}
                  >
                    ?
                  </button>
                )}
                <button
                  type="button"
                  className="uep-island-settings__toggle"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${enabled ? '停用' : '啟用'}${def.title}`}
                  onClick={() =>
                    getProgressManager().setIslandDisabled(id, enabled)
                  }
                />
              </div>
            );
          })}

          {/* 識別證不是浮島（沒有視窗、不能停用），但它的教學同樣只在
              首次登入演一次——沒有這個入口就再也叫不出來。放在島列表下方
              而不是混進去：它沒有開關，混進去會讓那一列少一顆按鈕。 */}
          <div className="uep-island-settings__row uep-island-settings__row--ident">
            <span className="uep-island-settings__row-icon" aria-hidden>
              ◈
            </span>
            <span className="uep-island-settings__row-name">識別證</span>
            <button
              type="button"
              className="uep-island-settings__guide"
              aria-label="重看識別證的說明"
              title="重看說明"
              onClick={() => {
                onClose();
                requestGuide('ident');
              }}
            >
              ?
            </button>
          </div>
        </div>

        <button
          type="button"
          className="uep-island-settings__close"
          onClick={onClose}
        >
          關閉
        </button>
      </div>
    </div>,
    document.body
  );
}
