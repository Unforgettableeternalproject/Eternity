/**
 * TipTap 擴充：攔截 Markdown 純文字貼上，自動解析為 rich text。
 * 需搭配 @tiptap/markdown 使用（提供 editor.storage.markdown.manager）。
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Slice } from '@tiptap/pm/model';

/** 簡易判斷：文字中是否包含明顯的 Markdown 語法 */
function looksLikeMarkdown(text: string): boolean {
  return (
    /(?:^|\n)#{1,6}\s/.test(text) || // 標題
    /(?:^|\n)[-*+] /.test(text) || // 無序列表
    /(?:^|\n)\d+\. /.test(text) || // 有序列表
    /\*\*[^*]+\*\*/.test(text) || // 粗體
    /(?:^|\n)>\s/.test(text) || // 引用
    /(?:^|\n)```/.test(text) || // 程式碼塊
    /(?:^|\n)---\s*$/m.test(text) // 水平線
  );
}

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste(view, event) {
            const html = event.clipboardData?.getData('text/html');
            const text = event.clipboardData?.getData('text/plain');

            // 只在「純文字貼上」（沒有 HTML 格式）且內容像 Markdown 時才介入
            if (!text || html?.trim()) return false;
            if (!looksLikeMarkdown(text)) return false;

            // 透過 @tiptap/markdown 提供的 manager 解析
            const mgr = editor.storage.markdown?.manager;
            if (!mgr) return false;

            try {
              const parsed = mgr.parse(text);
              if (!parsed?.content?.length) return false;

              const doc = view.state.schema.nodeFromJSON({
                type: 'doc',
                content: parsed.content,
              });
              const tr = view.state.tr.replaceSelection(
                new Slice(doc.content, 0, 0)
              );
              view.dispatch(tr);
              return true;
            } catch {
              // 解析失敗就 fallback 到預設行為
              return false;
            }
          },
        },
      }),
    ];
  },
});
