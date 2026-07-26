/**
 * useVisualClues — History 文章的 Visual Clue 消費端（S8 下半場 V-D）。
 *
 * 從文章 DOM 收集成對錨點（孤兒容錯：不成對/亂序/缺目標一律視為
 * 無效 clue，直接不渲染書籤——編輯器存檔閘是第一層防禦，這裡是
 * 第二層），並以掃描線同一條 80% 線判定「閱讀位置是否在起訖區間內」。
 *
 * 區間判定不走 IntersectionObserver 而用捲動事件 + rAF 節流的
 * getBoundingClientRect 比對——書籤語意是「在區間內就顯示、離開就
 * 收起、回捲重新顯示」的雙向持續狀態，IO 的單向 isIntersecting
 * 事件流拼不出穩定的雙向判定（回捲重入時進出事件語意混淆）。
 */

import { useEffect, useState, type RefObject } from 'react';

import {
  VISUAL_CLUE_END_ROLE,
  VISUAL_CLUE_START_ROLE,
} from '../../progress/markers';

/** 配對成功的 Visual Clue（前台書籤的資料來源） */
export interface VisualClueEntry {
  clueId: string;
  targetType: 'entity' | 'story';
  /** entityKey 或 storyKey（依 targetType）——觸發時以此反查現行資料 */
  targetKey: string;
  /** gallery 頁 id 快照（反查失敗時的顯示 fallback） */
  galleryId: string;
  /** gallery 標題快照（書籤顯示用） */
  title: string;
  /** Gallery Clue 的預設圖片。 */
  imageId: string;
  imageTitle: string;
  /** 預設圖片的 R2 key 快照；舊資料可能缺少。 */
  imageFile: string;
  startEl: Element;
  endEl: Element;
}

/**
 * 從文章容器收集配對成功的 Visual Clue（文件順序）。
 * 孤兒容錯：同 clueId 必須恰好一起一訖、起在訖前、目標存在，
 * 否則整組略過——與編輯器 collectVisualClueIssues 同一套規則。
 */
export function collectVisualClues(container: Element): VisualClueEntry[] {
  const startEls = Array.from(
    container.querySelectorAll(`[data-role="${VISUAL_CLUE_START_ROLE}"]`)
  );
  const endEls = Array.from(
    container.querySelectorAll(`[data-role="${VISUAL_CLUE_END_ROLE}"]`)
  );

  const starts = new Map<string, Element[]>();
  for (const el of startEls) {
    const clueId = el.getAttribute('data-clue-id')?.trim() || '';
    if (!clueId) continue;
    starts.set(clueId, [...(starts.get(clueId) || []), el]);
  }
  const ends = new Map<string, Element[]>();
  for (const el of endEls) {
    const clueId = el.getAttribute('data-clue-id')?.trim() || '';
    if (!clueId) continue;
    ends.set(clueId, [...(ends.get(clueId) || []), el]);
  }

  const entries: VisualClueEntry[] = [];
  for (const [clueId, startGroup] of starts) {
    const endGroup = ends.get(clueId) || [];
    // 恰好一起一訖才算有效配對
    if (startGroup.length !== 1 || endGroup.length !== 1) continue;
    const [startEl] = startGroup;
    const [endEl] = endGroup;
    // 起點必須在訖點之前（文件順序）
    const position = startEl.compareDocumentPosition(endEl);
    if ((position & Node.DOCUMENT_POSITION_FOLLOWING) === 0) continue;
    const targetKey = startEl.getAttribute('data-target-key')?.trim() || '';
    if (!targetKey) continue;
    const targetType: VisualClueEntry['targetType'] =
      startEl.getAttribute('data-target-type') === 'story' ? 'story' : 'entity';
    // 起訖目標必須一致（同編輯器 collectVisualClueIssues 規則）——
    // 不一致代表資料損壞（如手改 HTML），整組略過而非照 start 執行
    const endKey = endEl.getAttribute('data-target-key')?.trim() || '';
    const endType =
      endEl.getAttribute('data-target-type') === 'story' ? 'story' : 'entity';
    if (endKey !== targetKey || endType !== targetType) continue;
    const imageId = startEl.getAttribute('data-image-id')?.trim() || '';
    entries.push({
      clueId,
      targetType,
      targetKey,
      galleryId: startEl.getAttribute('data-gallery-id')?.trim() || '',
      title: startEl.getAttribute('data-gallery-title')?.trim() || '',
      imageId,
      imageTitle: startEl.getAttribute('data-image-title')?.trim() || '',
      imageFile: startEl.getAttribute('data-image-file')?.trim() || '',
      startEl,
      endEl,
    });
  }
  return entries;
}

interface UseVisualCluesOptions {
  pageId: string | null;
  /** 文章內容容器（收集錨點的範圍） */
  containerRef: RefObject<HTMLElement | null>;
  /** 滾動容器（80% 掃描線的參考框） */
  scrollRef: RefObject<HTMLElement | null>;
  /** 內容識別鍵——變更時重新收集錨點（同 useScanline） */
  contentKey?: unknown;
  enabled?: boolean;
}

/**
 * 回傳「閱讀位置目前落在起訖區間內」的 clue 清單（文件順序）。
 * dedupe（點過且通過訖點後本次造訪不再出現）由呼叫端過濾——
 * 這裡只負責純粹的區間幾何判定。
 */
export function useVisualClues({
  pageId,
  containerRef,
  scrollRef,
  contentKey,
  enabled = true,
}: UseVisualCluesOptions): VisualClueEntry[] {
  const [active, setActive] = useState<VisualClueEntry[]>([]);

  useEffect(() => {
    if (!enabled || !pageId) {
      setActive([]);
      return;
    }
    const container = containerRef.current;
    const scroller = scrollRef.current;
    if (!container || !scroller) {
      setActive([]);
      return;
    }
    const entries = collectVisualClues(container);
    if (entries.length === 0) {
      setActive([]);
      return;
    }

    let raf = 0;
    const evaluate = () => {
      raf = 0;
      const viewport = scroller.getBoundingClientRect();
      // 與 scanline 同一條線：視窗高度 80% 處（rootMargin bottom -20%）
      const scanY = viewport.top + viewport.height * 0.8;
      const next = entries.filter((entry) => {
        const start = entry.startEl.getBoundingClientRect();
        const end = entry.endEl.getBoundingClientRect();
        return start.top <= scanY && end.top > scanY;
      });
      setActive((current) =>
        current.length === next.length &&
        current.every((entry, i) => entry.clueId === next[i].clueId)
          ? current
          : next
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(evaluate);
    };

    evaluate();
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
      setActive([]);
    };
    // ref 物件 identity 穩定不列入 deps；內容變更由 contentKey 驅動
  }, [pageId, contentKey, enabled]);

  return active;
}
