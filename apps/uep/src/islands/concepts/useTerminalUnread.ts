/**
 * useTerminalUnread — dock chip 未讀 badge 的輕量 hook（S7 驗收 #10）
 *
 * 收合狀態下 TerminalIsland 內容元件未 mount，更動通知的水位 diff
 * 在這裡預計算：訂閱進度變化 → 載入索引（模組級快取，重複呼叫零成本）
 * → computeUnreadUpdates 取未讀數。**只讀不寫**——水位推進只發生在
 * terminal 展開、通知文字真正渲染時（TerminalIsland 的通知 effect）。
 *
 * terminalCore / terminalNotify 走動態 import：IslandDock 常駐於全站
 * bundle，terminal 查詢核心維持惰性載入（enabled 才觸發）。
 */

import { useEffect, useState } from 'react';

import { useProgress } from '../../progress';

export function useTerminalUnread(enabled: boolean): number {
  const progress = useProgress();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [{ loadEntityIndex }, { computeUnreadUpdates }] =
          await Promise.all([
            import('./terminalCore'),
            import('./terminalNotify'),
          ]);
        const entries = await loadEntityIndex();
        if (cancelled) return;
        setCount(computeUnreadUpdates(entries, progress).updates.length);
      } catch {
        // 索引載入失敗：badge 靜默不亮（terminal 開啟時會呈現錯誤）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, progress]);

  return count;
}
