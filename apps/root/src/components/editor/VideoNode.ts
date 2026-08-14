/**
 * TipTap 擴充：讓編輯器認得 <video> 節點。
 *
 * TipTap 會把 schema 未定義的節點在載入 HTML 時靜默剝離，存檔後即永久遺失。
 * 內容中的動畫素材以 <video> 呈現（比同畫面的 GIF 小一到兩個數量級），
 * 因此編輯器必須保留這個節點，即使目前沒有提供插入影片的 UI。
 */
import { Node, mergeAttributes } from '@tiptap/core';

export interface VideoOptions {
  HTMLAttributes: Record<string, unknown>;
}

/**
 * HTML 布林屬性（autoplay、loop…）只看「有沒有出現」，值是什麼都不影響。
 *
 * ⚠️ 必須定義在 attribute 層而非 node 層的 getAttrs：TipTap 會用各 attribute
 * 自己的 parseHTML（預設是 getAttribute）覆蓋 node 層的結果，而布林屬性的
 * getAttribute 回傳空字串 —— falsy，於是屬性在 round-trip 中全數遺失。
 *
 * 輸出端同理：值為 false 時必須整個省略屬性，寫成 autoplay="false"
 * 瀏覽器依然視為開啟。
 */
function booleanAttribute(name: string, defaultValue: boolean) {
  return {
    default: defaultValue,
    parseHTML: (element: HTMLElement) => element.hasAttribute(name),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes[name] ? { [name]: '' } : {},
  };
}

export const Video = Node.create<VideoOptions>({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      src: { default: null },
      poster: { default: null },
      // 動畫素材取代 GIF，預設沿用「自動播放、循環、靜音、行內播放」的行為
      autoplay: booleanAttribute('autoplay', true),
      loop: booleanAttribute('loop', true),
      muted: booleanAttribute('muted', true),
      playsinline: booleanAttribute('playsinline', true),
      controls: booleanAttribute('controls', false),
    };
  },

  parseHTML() {
    return [{ tag: 'video[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ];
  },
});

export default Video;
