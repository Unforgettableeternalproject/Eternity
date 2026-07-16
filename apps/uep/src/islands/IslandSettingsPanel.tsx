/**
 * UEP 浮島系統 — 設定視窗（識別證齒輪開啟）
 *
 * 使用者自行開關已解鎖的浮島；未解鎖的顯示鎖定態（不透露解鎖方式）。
 * createPortal 掛到 body：IdentCard 在 TopBar 的 sticky 堆疊上下文內，
 * 不 portal 的話 z-index 對外會被鎖在 100 層。
 *
 * 停用狀態寫進 ProgressState.islandsDisabled（登入者自動同步到伺服器）。
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { getProgressManager, useProgress } from '../progress';

import { isIslandDisabled, isIslandUnlocked } from './islandRuntime';
import { ISLAND_DEFINITIONS, ISLAND_IDS } from './types';

import './islands.css';

interface IslandSettingsPanelProps {
  onClose: () => void;
}

export default function IslandSettingsPanel({
  onClose,
}: IslandSettingsPanelProps) {
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
                  <span className="uep-island-settings__row-icon" aria-hidden>
                    ？
                  </span>
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
                  {def.icon}
                </span>
                <span className="uep-island-settings__row-name">
                  {def.title}
                </span>
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
