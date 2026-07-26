/**
 * UEP 浮島系統 — dock chip 注意力聚合（S9-D.5）
 *
 * 收合的島要怎麼告訴使用者「這裡有東西」，之前是一島一條線各自接：
 * Visual Clue 走 phantomBridge 的計數、Echo Spot 走 echoPreview 的旗標、
 * concepts 走未讀 badge，互不相干，CSS 也各有一個 class。島滿五座後
 * 這種長法會讓每加一個提示來源就多一組 class 與判斷式。
 *
 * 這支 hook 把所有來源收在一處求值，dock 只認兩種結果：
 * - `waiting`（持續）— 條件成立就一直閃，條件消失才停。來源是各 bridge
 *   的當下狀態，不是事件；島展開消費掉 pending 後 chip 自然安靜。
 * - `pulse`（瞬時）— 剛剛發生了一件事，閃一下就停（見 chipAttention）。
 *
 * 同一座島兩者同時成立時 waiting 優先：持續狀態描述的是「還沒處理完」，
 * 比「剛剛動了一下」更需要被看到。
 */

import { useEffect, useMemo, useState } from 'react';

import { UEP_CHIP_PULSE_EVENT, getChipPulse } from './chipAttention';
import {
  UEP_ENTITY_PENDING_EVENT,
  hasPendingEntityActivate,
} from './concepts/terminalBridge';
import {
  UEP_ECHO_SPOT_WAITING_EVENT,
  getEchoSpotWaiting,
} from './echoes/echoPreview';
import {
  UEP_ECHO_SUGGESTION_EVENT,
  hasEchoSuggestion,
} from './echoes/echoSuggestionBridge';
import { ISLAND_IDS } from './types';
import type { IslandId } from './types';
import {
  UEP_CLUE_WAITING_EVENT,
  UEP_PHANTOM_SUGGESTION_EVENT,
  getClueWaitingCount,
  hasPhantomSuggestion,
} from './visuals/phantomBridge';

export interface ChipAttention {
  kind: 'waiting' | 'pulse';
  /** 附加在 aria-label／title 的說明，如「有視覺線索等待中」 */
  reason: string;
}

/** 觸發重算的事件（任一發生就整組重讀，不做細粒度更新） */
const SOURCE_EVENTS = [
  UEP_CLUE_WAITING_EVENT,
  UEP_PHANTOM_SUGGESTION_EVENT,
  UEP_ECHO_SPOT_WAITING_EVENT,
  UEP_ECHO_SUGGESTION_EVENT,
  UEP_ENTITY_PENDING_EVENT,
  UEP_CHIP_PULSE_EVENT,
];

/** 各島的持續等待條件（求值順序即顯示優先序） */
function waitingReason(id: IslandId): string | null {
  switch (id) {
    case 'visuals':
      if (getClueWaitingCount() > 0) return '有視覺線索等待中';
      if (hasPhantomSuggestion()) return '有相關畫廊等待查看';
      return null;
    case 'echoes':
      if (getEchoSpotWaiting()) return '有回聲等待插播';
      if (hasEchoSuggestion()) return '有相關回聲等待查看';
      return null;
    case 'concepts':
      return hasPendingEntityActivate() ? '有條目等待查閱' : null;
    default:
      return null;
  }
}

/** 當下的 chip 注意力狀態（純讀取，可單獨測試） */
export function computeChipAttentions(): Partial<
  Record<IslandId, ChipAttention>
> {
  const result: Partial<Record<IslandId, ChipAttention>> = {};
  ISLAND_IDS.forEach((id) => {
    const waiting = waitingReason(id);
    if (waiting) {
      result[id] = { kind: 'waiting', reason: waiting };
      return;
    }
    const pulse = getChipPulse(id);
    if (pulse) result[id] = { kind: 'pulse', reason: pulse };
  });
  return result;
}

export function useChipAttentions(): Partial<Record<IslandId, ChipAttention>> {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    SOURCE_EVENTS.forEach((name) => window.addEventListener(name, bump));
    return () =>
      SOURCE_EVENTS.forEach((name) => window.removeEventListener(name, bump));
  }, []);

  return useMemo(() => computeChipAttentions(), [tick]);
}
