import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Video } from './VideoNode';

/**
 * 這組測試守的是一個會靜默毀損內容的行為：
 * TipTap 載入 HTML 時會剝離 schema 未定義的節點，畫面上沒有任何提示，
 * 但只要在 admin 開啟該筆內容再存檔，<video> 就永久消失。
 */

function roundTrip(html: string, withVideo = true) {
  const editor = new Editor({
    extensions: withVideo ? [StarterKit, Image, Video] : [StarterKit, Image],
    content: html,
  });
  const out = editor.getHTML();
  editor.destroy();
  return out;
}

const SRC = '/api/root/assets/images/projects/demo/data_processing.mp4';

describe('VideoNode', () => {
  it('沒有 video extension 時，<video> 會被剝離（這正是要防的行為）', () => {
    const out = roundTrip(`<p>前</p><video src="${SRC}"></video>`, false);
    expect(out).not.toContain('<video');
  });

  it('round-trip 保留 video 與 src', () => {
    const out = roundTrip(`<p>前</p><video src="${SRC}"></video>`);
    expect(out).toContain('<video');
    expect(out).toContain(SRC);
  });

  it('保留 autoplay/loop/muted/playsinline 布林屬性', () => {
    const out = roundTrip(
      `<video src="${SRC}" autoplay loop muted playsinline></video>`
    );
    for (const attr of ['autoplay', 'loop', 'muted', 'playsinline']) {
      expect(out).toContain(attr);
    }
  });

  it('未宣告的布林屬性不會被輸出成 controls="false"', () => {
    const out = roundTrip(`<video src="${SRC}" autoplay></video>`);
    expect(out).not.toContain('controls');
    expect(out).not.toContain('"false"');
  });

  it('與既有 <img> 內容共存，不影響圖片', () => {
    const out = roundTrip(
      `<p><img src="/api/root/assets/images/a.webp"></p><video src="${SRC}"></video>`
    );
    expect(out).toContain('<img');
    expect(out).toContain('a.webp');
    expect(out).toContain('<video');
  });
});
