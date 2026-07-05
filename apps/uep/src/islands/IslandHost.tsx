/**
 * UEP 浮島系統 — 全域掛載點
 *
 * 掛在 TopBar（覆蓋所有非 admin 頁面），但用 createPortal 逃出 TopBar 的
 * sticky z-100 堆疊上下文（S5 教訓：內部 fixed 元件 z-index 對外被鎖 100 層），
 * 讓浮島的 2000-2999 層帶真正生效於 Minimap（300）之上。
 *
 * 掛載守門（四關）：
 * 1. 探索者視角（觀測者/切換中沒有浮島——需求定案）
 * 2. 已解鎖（ProgressState.islandsUnlocked，zone 首頁小物件授予）
 * 3. 未被使用者停用（識別證設定視窗寫入）
 * 4. 已有實體元件（S6 只有 history；S7/S8 逐島補上）
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { useProgress } from '../progress';

import DraggableIsland from './DraggableIsland';
import IslandDock from './IslandDock';
import { canUseIslands, shouldMountIsland } from './islandRuntime';
import { ISLAND_IDS } from './types';
import type { IslandId } from './types';
import { useIslandRuntimeState } from './useIslands';

/**
 * 各島的實體內容元件註冊表。
 * S6：history（Commit 3 接上）；S7：concepts、echoes；S8：visuals、storage。
 */
const ISLAND_COMPONENTS: Partial<Record<IslandId, React.ComponentType>> = {};

/** 註冊島的內容元件（各島模組 import 時自行呼叫，避免 host 反向依賴） */
export function registerIslandComponent(
  id: IslandId,
  component: React.ComponentType
): void {
  ISLAND_COMPONENTS[id] = component;
}

export default function IslandHost() {
  const progress = useProgress();
  const runtimeState = useIslandRuntimeState();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // SSR / 首次 render 前不輸出（portal 需要 document）
  if (!mounted) return null;

  // 守門 1：只有探索者有浮島
  if (!canUseIslands(progress)) return null;

  // 守門 2 + 3 + 4：已解鎖、未停用、且有實體元件
  const activeIds = ISLAND_IDS.filter(
    (id) => shouldMountIsland(progress, id) && ISLAND_COMPONENTS[id]
  );
  if (activeIds.length === 0) return null;

  const openIds = activeIds.filter((id) => runtimeState.windows[id]?.open);

  return createPortal(
    <>
      <IslandDock unlockedIds={activeIds} />
      {openIds.map((id) => {
        const Body = ISLAND_COMPONENTS[id]!;
        return (
          <DraggableIsland key={id} id={id}>
            <Body />
          </DraggableIsland>
        );
      })}
    </>,
    document.body
  );
}
