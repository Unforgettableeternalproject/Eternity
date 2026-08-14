import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import VisualClueNode, { collectVisualClueIssues } from '../VisualClueNode';

function makeEditor(content: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, VisualClueNode],
    content,
  });
}

describe('VisualClueNode persistence contract', () => {
  let editor: Editor | undefined;

  afterEach(() => editor?.destroy());

  it('成對插入寫入起訖 data-role 與目標引用，並可讀回', () => {
    editor = makeEditor('<p>前文</p>');
    editor.commands.insertVisualCluePair({
      clueId: 'clue-fixed-id',
      targetType: 'story',
      targetKey: 'scene-first-light',
      galleryId: 'visuals/illustrations/first-light',
      title: '初光',
      imageId: 'dawn',
      imageTitle: '黎明',
      imageFile: 'images/first-light/dawn.png',
    });

    const html = editor.getHTML();
    expect(html).toContain('data-role="visual-clue-start"');
    expect(html).toContain('data-role="visual-clue-end"');
    expect(html).toContain('data-clue-id="clue-fixed-id"');
    expect(html).toContain('data-target-type="story"');
    expect(html).toContain('data-target-key="scene-first-light"');
    expect(html).toContain(
      'data-gallery-id="visuals/illustrations/first-light"'
    );
    expect(html).toContain('data-image-file="images/first-light/dawn.png"');

    const restored = makeEditor(html);
    const clues = restored
      .getJSON()
      .content?.filter((node) => node.type === 'visualClue');
    expect(clues).toHaveLength(2);
    expect(clues?.map((node) => node.attrs?.edge)).toEqual(['start', 'end']);
    expect(clues?.[0]?.attrs).toEqual(
      expect.objectContaining({
        clueId: 'clue-fixed-id',
        targetType: 'story',
        targetKey: 'scene-first-light',
        galleryId: 'visuals/illustrations/first-light',
        title: '初光',
        imageFile: 'images/first-light/dawn.png',
      })
    );
    restored.destroy();
  });

  it('entity 目標預設值與 data-target-type 序列化正確', () => {
    editor = makeEditor('<p></p>');
    editor.commands.insertVisualCluePair({
      clueId: 'clue-entity',
      targetType: 'entity',
      targetKey: 'xavier-colsono',
      galleryId: 'visuals/profiles/xavier',
      title: '艾斯維爾',
    });
    expect(editor.getHTML()).toContain('data-target-type="entity"');
  });
});

describe('collectVisualClueIssues — 配對驗證（存檔閘第一層防禦）', () => {
  let editor: Editor | undefined;

  afterEach(() => editor?.destroy());

  const START = (clueId: string, targetKey = 'k1', targetType = 'entity') =>
    `<div data-role="visual-clue-start" data-clue-id="${clueId}" data-target-type="${targetType}" data-target-key="${targetKey}"></div>`;
  const END = (clueId: string, targetKey = 'k1', targetType = 'entity') =>
    `<div data-role="visual-clue-end" data-clue-id="${clueId}" data-target-type="${targetType}" data-target-key="${targetKey}"></div>`;

  it('正常成對（起前訖後、目標一致）無問題', () => {
    editor = makeEditor(`${START('c1')}<p>橋段</p>${END('c1')}`);
    expect(collectVisualClueIssues(editor.state.doc)).toEqual([]);
  });

  it('孤兒起點錨點回報不成對', () => {
    editor = makeEditor(`${START('c1')}<p>橋段</p>`);
    const issues = collectVisualClueIssues(editor.state.doc);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('不成對');
  });

  it('重複起點（同 clueId 兩個 start）回報不成對', () => {
    editor = makeEditor(`${START('c1')}${START('c1')}${END('c1')}`);
    expect(collectVisualClueIssues(editor.state.doc)[0].message).toContain(
      '不成對'
    );
  });

  it('訖點在起點之前回報順序錯誤', () => {
    editor = makeEditor(`${END('c1')}<p>橋段</p>${START('c1')}`);
    expect(collectVisualClueIssues(editor.state.doc)[0].message).toContain(
      '起點在訖點之後'
    );
  });

  it('目標缺失回報缺少目標', () => {
    editor = makeEditor(`${START('c1', '')}<p></p>${END('c1', '')}`);
    expect(collectVisualClueIssues(editor.state.doc)[0].message).toContain(
      '缺少目標'
    );
  });

  it('起訖目標不一致回報', () => {
    editor = makeEditor(`${START('c1', 'a')}<p></p>${END('c1', 'b')}`);
    expect(collectVisualClueIssues(editor.state.doc)[0].message).toContain(
      '目標不一致'
    );
  });

  it('多組 clue 各自獨立驗證、互不干擾', () => {
    editor = makeEditor(
      `${START('c1')}<p></p>${END('c1')}${START('c2')}<p></p>`
    );
    const issues = collectVisualClueIssues(editor.state.doc);
    expect(issues).toHaveLength(1);
    expect(issues[0].clueId).toBe('c2');
  });

  it('gallery 模式允許區間內指定圖片 gate', () => {
    editor = makeEditor(
      `${START('c1')}<p></p><div data-role="visual-clue-gate" data-clue-id="c1" data-target-type="entity" data-target-key="k1" data-image-id="img-2"></div><p></p>${END('c1')}`
    );
    expect(collectVisualClueIssues(editor.state.doc)).toEqual([]);
  });
});
