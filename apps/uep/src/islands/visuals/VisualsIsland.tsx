/**
 * VisualsIsland —「浮動幻影」（S8 下半場 V-C）
 *
 * 事件驅動的典型圖片檢視器：一次展示一整個 gallery（僅陳列走廊 +
 * 鑲框室），無佇列、Visuals zone 內預設閉幕。內容來源三種（映照 /
 * entity 嵌入提示 / Visual Clue），全部經 phantomBridge 進來，島本體
 * 不主動抓資料。
 *
 * 視覺語彙：無設計稿原型（同 History 島前例），第一版功能骨架優先
 * ——除 Concepts 外各島後續會統一重調更 immersive（艾斯維爾 07/19）。
 *
 * 視窗外殼（拖曳/收合/手機 bottom sheet）由 DraggableIsland 提供，
 * 這裡只有 body。收合＝unmount：目前投射存 window（phantomBridge），
 * 展開後續示，與流浪回聲「收合即暫停」的旗標手法同源。
 */
import React, { useEffect, useState } from 'react';

import { getPhantomGallery, UEP_PHANTOM_SHOW_EVENT } from './phantomBridge';
import type { PhantomGallery } from './phantomBridge';

import './VisualsIsland.css';

export default function VisualsIsland() {
  /** 目前投射的 gallery：mount 時讀回 window 值（收合後展開續示） */
  const [gallery, setGallery] = useState<PhantomGallery | null>(() =>
    getPhantomGallery()
  );

  useEffect(() => {
    const onShow = (event: Event) => {
      const detail = (event as CustomEvent<PhantomGallery>).detail;
      if (detail) setGallery(detail);
    };
    window.addEventListener(UEP_PHANTOM_SHOW_EVENT, onShow);
    return () => window.removeEventListener(UEP_PHANTOM_SHOW_EVENT, onShow);
  }, []);

  if (!gallery) {
    return (
      <div className="uep-visland uep-visland--empty">
        畫框裡還是一片空白。
        <br />
        去幻影重現室把畫作映照過來吧。
      </div>
    );
  }

  // 檢視器 UI（大圖 + 箭頭 + caption + 三態縮圖列）於 V-C 檢視器
  // commit 實作；骨架先呈現投射對象確立資料鏈
  return (
    <div className="uep-visland">
      <div className="uep-visland__header">
        <span className="uep-visland__kicker">PROJECTING</span>
        <span className="uep-visland__title">{gallery.title}</span>
      </div>
      <div className="uep-visland__placeholder">
        {gallery.images.length} 幅影像等待顯像……
      </div>
    </div>
  );
}
