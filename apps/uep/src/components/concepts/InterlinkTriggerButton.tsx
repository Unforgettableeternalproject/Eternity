/**
 * Concepts 條目 →「相關」按鈕（S10-1 T-G3）
 *
 * 艾斯維爾 2026-07-27 定案：**透過 concept 的按鈕去找到對應 entity 的
 * echo 或者 visual**。原本這顆按鈕查的是 History 錨點（「⟡ 段落」），
 * 方向反了——一個 entity 可能在 History 出現數十次，「所有提到他的段落」
 * 對讀者沒有意義；History 島只對劇情點有反應。
 *
 * ## 復用 entity-activate，不自己造一套
 *
 * 點下去只是發 `uep:entity-activate`——與 History 文內點互動式嵌入完全
 * 同一個事件。`IslandHost` 對它已經有完整的三島分派：反查對應的歌與畫廊、
 * 疊 tree-aware 解鎖判定、算 spoiler 等級、推提示卡、島收合時暫存並亮
 * dock chip。呈現方式因此與讀者在 History 點嵌入時一模一樣。
 *
 * `sourceZone: 'concepts'` 讓 Terminal 島跳過自己——使用者正看著這個條目，
 * 不需要再被推回同一筆。
 *
 * ## 為什麼守門是「查得到內容」而不是「島掛載」
 *
 * 事件是 fire-and-forget，拿不到「有沒有查到」的結果，所以沒辦法在查無時
 * 補一則 toast。改成**有內容才長按鈕**：出現即代表按下去必有反應，這與
 * 隔壁「詳細」按鈕（browser 有條目才出現）是同一套哲學，也免掉了
 * 「按了沒反應」的疑慮。
 *
 * 判定用前端既有的兩份索引（模組級快取，與互動式嵌入的可點判定共用同一
 * 份資料），不額外打 API。
 */

import React, { useEffect, useState } from 'react';

import { activateEntityKey } from '../../embed';
import { shouldMountIsland, useDesktopIslandViewport } from '../../islands';
import {
  isEchoesEntityUnlocked,
  loadEchoesEntityIndex,
  type EchoesEntityIndexEntry,
} from '../../islands/echoes/echoesEntityIndex';
import {
  isVisualsEntityUnlocked,
  loadVisualsEntityIndex,
  type VisualsEntityIndexEntry,
} from '../../islands/visuals/visualsEntityIndex';
import { useProgress } from '../../progress/useProgress';

interface Props {
  /** 條目的 entityKey；未掛 key 的條目傳 undefined，元件自行不渲染 */
  entityKey?: string;
  /** 條目顯示名稱（島端提示卡的標題） */
  label: string;
  /** 額外 class（各 stack 版面微調用） */
  className?: string;
}

export default function InterlinkTriggerButton({
  entityKey,
  label,
  className,
}: Props) {
  const progress = useProgress();
  const desktopViewport = useDesktopIslandViewport();
  /* 兩份索引自載：`load*` 都有模組級快取（與互動式嵌入的可點判定共用
     同一份），一頁數十顆按鈕也只會打一次 API。 */
  const [echoesIndex, setEchoesIndex] = useState<
    EchoesEntityIndexEntry[] | null
  >(null);
  const [visualsIndex, setVisualsIndex] = useState<
    VisualsEntityIndexEntry[] | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    void loadEchoesEntityIndex()
      .then((e) => !cancelled && setEchoesIndex(e))
      .catch(() => {});
    void loadVisualsEntityIndex()
      .then((e) => !cancelled && setVisualsIndex(e))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const key = entityKey?.trim();
  if (!key || !desktopViewport) return null;

  /* 島沒掛載時連查都不必——事件廣播出去沒有消費者。逐島判定而非聯集：
     只解鎖 Echoes 的讀者不該因為這個 entity「只有畫廊」而看到按鈕。 */
  const hasEcho =
    shouldMountIsland(progress, 'echoes') &&
    isEchoesEntityUnlocked(echoesIndex, key, progress);
  const hasVisual =
    shouldMountIsland(progress, 'visuals') &&
    isVisualsEntityUnlocked(visualsIndex, key, progress);
  if (!hasEcho && !hasVisual) return null;

  return (
    <button
      type="button"
      className={`conc-interlink-btn${className ? ` ${className}` : ''}`}
      onClick={(event) => {
        // 條目卡本身也是拖曳來源與點擊目標，這顆按鈕不該連帶觸發
        event.stopPropagation();
        activateEntityKey({
          entityKey: key,
          text: label,
          sourceZone: 'concepts',
        });
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={`找「${label}」相關的回聲與影像`}
      aria-label={`找「${label}」相關的回聲與影像`}
    >
      <span className="conc-interlink-btn__glyph" aria-hidden="true">
        ⟡
      </span>
      <span className="conc-interlink-btn__text">相關</span>
    </button>
  );
}
