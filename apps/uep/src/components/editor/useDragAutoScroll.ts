/* eslint-disable no-undef */
/**
 * useDragAutoScroll — 編輯器內原生拖曳靠近上下緣時自動捲動（S8 驗收 #5）
 *
 * TipTap 的 draggable atom（Visual Clue／Echo Spot／Progress Marker 的
 * 起訖錨點）走 ProseMirror 原生 HTML5 拖曳。原生拖曳「不會」在可捲容器
 * 邊緣自動捲動——起訖錨點橫跨長段落時，使用者必須先手動捲到目標位置
 * 才能放下，長距離拖曳極不直覺（驗收反饋 #5）。
 *
 * 本 hook 在 scroll 容器上監聽 `dragover`，偵測游標與容器上下緣的距離；
 * 進入感應帶（edgeSize）就以 requestAnimationFrame 迴圈捲動容器，越接近
 * 邊緣捲得越快（線性加速），`dragend`／`drop`／離開容器時收束。
 *
 * 注意：自動捲動是「拖曳可達性」的功能需求（不是裝飾動畫），
 * 因此不受 reduced-motion 影響——否則使用者根本搆不到遠處放置點。
 */

import { useEffect, type RefObject } from 'react';

interface DragAutoScrollOptions {
  /** 邊緣感應帶高度（px）；游標進入容器上／下緣此距離內即開始捲動 */
  edgeSize?: number;
  /** 貼齊邊緣時的每幀最大捲動量（px/frame） */
  maxSpeed?: number;
}

export function useDragAutoScroll(
  ref: RefObject<HTMLElement | null>,
  { edgeSize = 64, maxSpeed = 18 }: DragAutoScrollOptions = {}
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let velocity = 0; // 每幀捲動量：負=向上、正=向下、0=停

    const step = () => {
      if (velocity === 0) {
        raf = 0;
        return;
      }
      el.scrollTop += velocity;
      raf = requestAnimationFrame(step);
    };

    const ensureLoop = () => {
      if (velocity !== 0 && raf === 0) raf = requestAnimationFrame(step);
    };

    const handleDragOver = (e: DragEvent) => {
      const rect = el.getBoundingClientRect();
      const topDist = e.clientY - rect.top;
      const bottomDist = rect.bottom - e.clientY;
      const canScrollUp = el.scrollTop > 0;
      const canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight;

      if (topDist >= 0 && topDist < edgeSize && canScrollUp) {
        // 越接近上緣 ratio 越大（0→1），捲動越快
        const ratio = 1 - topDist / edgeSize;
        velocity = -Math.max(1, Math.ceil(ratio * maxSpeed));
      } else if (bottomDist >= 0 && bottomDist < edgeSize && canScrollDown) {
        const ratio = 1 - bottomDist / edgeSize;
        velocity = Math.max(1, Math.ceil(ratio * maxSpeed));
      } else {
        velocity = 0;
      }
      ensureLoop();
    };

    const stop = () => {
      velocity = 0;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      // 只有真正離開容器才停；游標移進子元素觸發的 dragleave 忽略
      const next = e.relatedTarget as Node | null;
      if (next && el.contains(next)) return;
      stop();
    };

    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragend', stop);
    el.addEventListener('drop', stop);
    el.addEventListener('dragleave', handleDragLeave);

    return () => {
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('dragend', stop);
      el.removeEventListener('drop', stop);
      el.removeEventListener('dragleave', handleDragLeave);
      stop();
    };
  }, [ref, edgeSize, maxSpeed]);
}
