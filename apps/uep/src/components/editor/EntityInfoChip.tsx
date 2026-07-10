/**
 * EntityInfoChip — 編輯器內已嵌入實體的浮動資訊 chip（S7 驗收 #8）
 *
 * 游標/選取落在 uepEntity 標記內時，於標記上方浮出小 chip 顯示
 * kind 與 ref（如 entity:xavier-colsono），附「編輯」與「移除」
 * 快捷按鈕——點擊已嵌入文字即有互動性回饋，不需要再去翻工具列。
 *
 * 定位：coordsAtPos 取 viewport 座標 + position: fixed + portal 到
 * body（逃出編輯器容器的 overflow 裁切）。捲動時透過 capture 階段的
 * scroll listener 重算位置。按鈕用 onMouseDown preventDefault 防止
 * 編輯器失焦（blur 會先於 click 觸發把 chip 收掉）。
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';

/** kind 顯示標籤（與 embed/marks 的 ENTITY_KINDS 對齊） */
const ENTITY_KIND_LABELS: Record<string, string> = {
  character: '角色',
  location: '地點',
  term: '名詞',
};

interface ChipState {
  kind: string;
  ref: string;
  top: number;
  left: number;
}

interface EntityInfoChipProps {
  editor: Editor;
  /** 「編輯」快捷：開啟 ◈ entity 面板（預填當前屬性由呼叫端處理） */
  onEdit?: () => void;
}

export default function EntityInfoChip({
  editor,
  onEdit,
}: EntityInfoChipProps) {
  const [chip, setChip] = useState<ChipState | null>(null);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      if (editor.isDestroyed) {
        setChip(null);
        return;
      }
      if (!editor.isActive('uepEntity')) {
        setChip(null);
        return;
      }
      const attrs = editor.getAttributes('uepEntity');
      const ref = typeof attrs.ref === 'string' ? attrs.ref : '';
      const kind = typeof attrs.kind === 'string' ? attrs.kind : 'term';
      let coords: { top: number; left: number };
      try {
        coords = editor.view.coordsAtPos(editor.state.selection.from);
      } catch {
        setChip(null);
        return;
      }
      setChip({ kind, ref, top: coords.top, left: coords.left });
    };

    const hide = () => setChip(null);

    editor.on('selectionUpdate', update);
    editor.on('focus', update);
    editor.on('blur', hide);
    // 捲動時重算（capture：編輯器容器的內部捲動也要接到）
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('focus', update);
      editor.off('blur', hide);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor]);

  if (!chip || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="ned-entity-chip"
      style={{ top: chip.top, left: chip.left }}
      /* 防止點 chip 時編輯器失焦（blur 會把 chip 收掉） */
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="ned-entity-chip-kind">
        ◈ {ENTITY_KIND_LABELS[chip.kind] ?? chip.kind}
      </span>
      <span className="ned-entity-chip-ref" title={chip.ref}>
        {chip.ref}
      </span>
      {onEdit && (
        <button
          type="button"
          className="ned-entity-chip-btn"
          title="編輯嵌入屬性"
          onClick={onEdit}
        >
          ✎
        </button>
      )}
      <button
        type="button"
        className="ned-entity-chip-btn ned-entity-chip-btn--del"
        title="移除嵌入標記（文字保留）"
        onClick={() => editor.chain().focus().unsetUepEntity().run()}
      >
        ✕
      </button>
    </div>,
    document.body
  );
}
