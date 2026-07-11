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

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useReaderAuth } from '../auth';
import { UEP_ENTITY_ACTIVATE_EVENT } from '../embed';
import type { EntityActivateDetail } from '../embed';
import { useProgress } from '../progress';

import DraggableIsland from './DraggableIsland';
import IslandDock from './IslandDock';
import { pushEntityActivate } from './concepts/terminalBridge';
import {
  canUseIslands,
  getIslandRuntime,
  shouldMountIsland,
} from './islandRuntime';
import { mountIslandsTestBridge } from './testBridge';
import { ISLAND_IDS } from './types';
import type { IslandId } from './types';
import { useIslandRuntimeState } from './useIslands';

/**
 * 各島的實體內容元件註冊表（lazy——TopBar 全站掛載，島內容只在
 * 真正展開時載入，避免 tree 抓取等邏輯進到每一頁的初始 bundle）。
 * S6：history；S7：concepts；S8：echoes；S8 後半：visuals；S9：storage。
 */
const ISLAND_COMPONENTS: Partial<
  Record<IslandId, React.LazyExoticComponent<React.ComponentType>>
> = {
  history: React.lazy(() => import('./history/HistoryIsland')),
  concepts: React.lazy(() => import('./concepts/TerminalIsland')),
  echoes: React.lazy(() => import('./echoes/EchoesIsland')),
};

export default function IslandHost() {
  const progress = useProgress();
  // 訂閱 auth 變化（S7-C 定案：浮島限已登入探索者）——登入/登出時
  // 重新求值守門；canUseIslands 內部讀 auth singleton，此 hook 純為重渲染
  useReaderAuth();
  const runtimeState = useIslandRuntimeState();
  const [mounted, setMounted] = useState(false);
  /** 事件 listener 取用最新進度（不重綁） */
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => setMounted(true), []);

  // dev 測試 bridge（S6-3）：全站可用的浮島解鎖/足跡操控入口。
  // 掛在這裡而非各 Reader——解鎖狀態是全域的，不該綁定單一 zone。
  useEffect(() => mountIslandsTestBridge(), []);

  // entity-activate 常駐監聽（S7-C）：監聽必須放在 Host 而非
  // TerminalIsland——島收合時內容元件沒有 mount，聽不到事件。
  // 收到後暫存 detail（terminalBridge）並展開島，島 mount 後取走。
  // concepts 島不可用（未解鎖/停用/觀測者）→ 事件靜默消失（既有定案）。
  useEffect(() => {
    const onActivate = (event: Event) => {
      const detail = (event as CustomEvent<EntityActivateDetail>).detail;
      if (!detail) return;
      if (!shouldMountIsland(progressRef.current, 'concepts')) return;
      pushEntityActivate(detail);
      getIslandRuntime().open('concepts');
    };
    window.addEventListener(UEP_ENTITY_ACTIVATE_EVENT, onActivate);
    return () =>
      window.removeEventListener(UEP_ENTITY_ACTIVATE_EVENT, onActivate);
  }, []);

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
          <DraggableIsland key={id} id={id} className={`uep-island--${id}`}>
            <Suspense fallback={null}>
              <Body />
            </Suspense>
          </DraggableIsland>
        );
      })}
    </>,
    document.body
  );
}
