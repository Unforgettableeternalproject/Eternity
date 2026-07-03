/**
 * embed/marks 測試 — 嵌入標記格式共用層（Epic 2 S3）
 *
 * 這層是序列化格式的唯一事實來源：
 * 編輯器（TipTap mark）與前台 dispatcher（S4）都依賴這裡的合約。
 */

import { describe, it, expect } from 'vitest';

import {
  UEP_ENTITY_ATTR,
  UEP_CUE_ATTR,
  UEP_REF_ATTR,
  isValidRef,
  parseRef,
  readEmbedFromElement,
  collectEmbeds,
} from '../marks';

function elementFromHtml(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.firstElementChild as Element;
}

describe('isValidRef', () => {
  it('接受 area/slug 形狀', () => {
    expect(isValidRef('concepts/log')).toBe(true);
    expect(isValidRef('concepts/log/characters')).toBe(true);
    expect(isValidRef('echoes/main-theme')).toBe(true);
    expect(isValidRef('visuals/gallery_01')).toBe(true);
  });

  it('接受條目錨點', () => {
    expect(isValidRef('concepts/log#entry:asvere')).toBe(true);
  });

  it('拒絕無效形狀', () => {
    expect(isValidRef('')).toBe(false);
    expect(isValidRef('concepts')).toBe(false); // 缺 slug
    expect(isValidRef('concepts/')).toBe(false);
    expect(isValidRef('concepts/log#entry:')).toBe(false); // 空錨點
    expect(isValidRef('concepts/log#bad:x')).toBe(false); // 非 entry 錨點
    expect(isValidRef('concepts/log#entry:a#b')).toBe(false); // 多個 #
    expect(isValidRef('has space/slug')).toBe(false);
  });
});

describe('parseRef', () => {
  it('無錨點時只回傳 pageId', () => {
    expect(parseRef('concepts/log')).toEqual({ pageId: 'concepts/log' });
  });

  it('有錨點時拆出 entryId', () => {
    expect(parseRef('concepts/log#entry:asvere')).toEqual({
      pageId: 'concepts/log',
      entryId: 'asvere',
    });
  });
});

describe('readEmbedFromElement', () => {
  it('讀取 entity 標記', () => {
    const el = elementFromHtml(
      `<span ${UEP_ENTITY_ATTR}="character" ${UEP_REF_ATTR}="concepts/log">諾薇亞</span>`
    );
    expect(readEmbedFromElement(el)).toEqual({
      type: 'entity',
      embed: { kind: 'character', ref: 'concepts/log', text: '諾薇亞' },
    });
  });

  it('讀取 cue 標記', () => {
    const el = elementFromHtml(
      `<span ${UEP_CUE_ATTR}="song" ${UEP_REF_ATTR}="echoes/theme">主題曲</span>`
    );
    expect(readEmbedFromElement(el)).toEqual({
      type: 'cue',
      embed: { kind: 'song', ref: 'echoes/theme', text: '主題曲' },
    });
  });

  it('非嵌入標記回傳 null', () => {
    expect(readEmbedFromElement(elementFromHtml('<span>普通文字</span>'))).toBe(
      null
    );
  });
});

describe('collectEmbeds', () => {
  it('彙整並去重（kind+ref 為鍵）', () => {
    const container = document.createElement('div');
    container.innerHTML = [
      `<p><span ${UEP_ENTITY_ATTR}="character" ${UEP_REF_ATTR}="concepts/a">甲</span></p>`,
      `<p><span ${UEP_ENTITY_ATTR}="character" ${UEP_REF_ATTR}="concepts/a">甲再次登場</span></p>`,
      `<p><span ${UEP_ENTITY_ATTR}="location" ${UEP_REF_ATTR}="concepts/b">乙地</span></p>`,
      `<p><span ${UEP_CUE_ATTR}="song" ${UEP_REF_ATTR}="echoes/c">丙曲</span></p>`,
    ].join('');

    const summary = collectEmbeds(container);
    expect(summary.related).toHaveLength(2);
    expect(summary.related[0]).toMatchObject({
      kind: 'character',
      ref: 'concepts/a',
      text: '甲',
    });
    expect(summary.related[1]).toMatchObject({
      kind: 'location',
      ref: 'concepts/b',
    });
    expect(summary.cues).toEqual([
      { kind: 'song', ref: 'echoes/c', text: '丙曲' },
    ]);
  });

  it('略過無效 ref 的標記', () => {
    const container = document.createElement('div');
    container.innerHTML = `<span ${UEP_ENTITY_ATTR}="term" ${UEP_REF_ATTR}="badref">壞引用</span>`;
    const summary = collectEmbeds(container);
    expect(summary.related).toHaveLength(0);
    expect(summary.cues).toHaveLength(0);
  });

  it('空容器回傳空摘要', () => {
    const container = document.createElement('div');
    expect(collectEmbeds(container)).toEqual({ related: [], cues: [] });
  });
});
