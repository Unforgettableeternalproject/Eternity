/**
 * MiniEditor — 輕量 TipTap 編輯器（條目富文本用）
 *
 * 從 ConceptsEditorBody 抽出（S7-B）：RevisionModal 的 PatchEditor
 * 也需要同一顆編輯器，直接從 ConceptsEditorBody import 會形成循環依賴。
 *
 * 注意：content 只在編輯器建立時讀取一次（useEditor 無 deps），
 * 呼叫端切換編輯對象時要用 key 強制 remount，否則會殘留舊內容。
 */

import { Placeholder } from '@tiptap/extension-placeholder';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import React, { useCallback, useRef } from 'react';

export default function MiniEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const initialized = useRef(false);
  const handleUpdate = useCallback(
    ({ editor: e }: { editor: { getHTML: () => string } }) => {
      // 跳過初始化時的第一次 onUpdate
      if (!initialized.current) {
        initialized.current = true;
        return;
      }
      const html = e.getHTML();
      onChange(html === '<p></p>' ? '' : html);
    },
    [onChange]
  );

  const editor = useEditor({
    // TipTap v3 預設不在 transaction 時重渲染，會讓工具列 isActive 狀態凍結
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ heading: false }),
      Placeholder.configure({ placeholder: placeholder || '輸入內容...' }),
    ],
    content: value || '',
    onUpdate: handleUpdate,
  });

  if (!editor) return null;

  return (
    <div className="ced-mini-editor">
      <div className="ced-mini-toolbar">
        <button
          type="button"
          className={editor.isActive('bold') ? 'active' : ''}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleBold().run();
          }}
          title="粗體"
        >
          <b>B</b>
        </button>
        <button
          type="button"
          className={editor.isActive('italic') ? 'active' : ''}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleItalic().run();
          }}
          title="斜體"
        >
          <i>I</i>
        </button>
        <button
          type="button"
          className={editor.isActive('strike') ? 'active' : ''}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleStrike().run();
          }}
          title="刪除線"
        >
          <s>S</s>
        </button>
        <button
          type="button"
          className={editor.isActive('bulletList') ? 'active' : ''}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleBulletList().run();
          }}
          title="列表"
        >
          •
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
