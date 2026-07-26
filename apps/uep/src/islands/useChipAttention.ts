/**
 * UEP 浮島系統 — dock chip 注意力聚合（S9-D.5）
 *
 * 收合的島要怎麼告訴使用者「這裡有東西」，之前是一島一條線各自接：
 * Visual Clue 走 phantomBridge 的計數、Echo Spot 走 echoPreview 的旗標、
 * concepts 走未讀 badge，互不相干，CSS 也各有一個 class。島滿五座後
 * 這種長法會讓每加一個提示來源就多一組 class 與判斷式。
 *
 * 這支 hook 把所有來源收在一處求值，dock 只認一種結果：有沒有在等，
 * 以及等的是什麼。兩類來源的差別只在誰負責記著（見 chipAttention）：
 * - 衍生型：條件本身持續存在，當下重讀即可
 * - 標記型：事件當下沒有可查詢的條件，由 chipAttention 記住
 *
 * 同島兩者都成立時取衍生型的說明：那是「還沒處理完的事」，比「剛剛動了
 * 一下」更具體。
 */

import { useEffect, useMemo, useState } from 'react';

import {
  UEP_CHIP_ATTENTION_EVENT,
  getChipAttentionMark,
} from './chipAttention';
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
import {
  UEP_RELATED_PENDING_EVENT,
  getRelatedPendingFlag,
} from './interlinkTrigger';
import { ISLAND_IDS } from './types';
import type { IslandId } from './types';
import {
  UEP_CLUE_WAITING_EVENT,
  UEP_PHANTOM_SUGGESTION_EVENT,
  getClueWaitingCount,
  hasPhantomSuggestion,
} from './visuals/phantomBridge';

/** 觸發重算的事件（任一發生就整組重讀，不做細粒度更新） */
const SOURCE_EVENTS = [
  UEP_CLUE_WAITING_EVENT,
  UEP_PHANTOM_SUGGESTION_EVENT,
  UEP_ECHO_SPOT_WAITING_EVENT,
  UEP_ECHO_SUGGESTION_EVENT,
  UEP_ENTITY_PENDING_EVENT,
  UEP_CHIP_ATTENTION_EVENT,
  UEP_RELATED_PENDING_EVENT,
];

/** 各島的衍生型等待條件（求值順序即顯示優先序） */
function derivedReason(id: IslandId): string | null {
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
    case 'history':
      return getRelatedPendingFlag('history') ? '有相關段落等待查看' : null;
    default:
      return null;
  }
}

/** 當下各島 chip 的提示說明（純讀取，可單獨測試） */
export function computeChipAttentions(): Partial<Record<IslandId, string>> {
  const result: Partial<Record<IslandId, string>> = {};
  ISLAND_IDS.forEach((id) => {
    const reason = derivedReason(id) ?? getChipAttentionMark(id);
    if (reason) result[id] = reason;
  });
  return result;
}

export function useChipAttentions(): Partial<Record<IslandId, string>> {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    SOURCE_EVENTS.forEach((name) => window.addEventListener(name, bump));
    return () =>
      SOURCE_EVENTS.forEach((name) => window.removeEventListener(name, bump));
  }, []);

  return useMemo(() => computeChipAttentions(), [tick]);
}
