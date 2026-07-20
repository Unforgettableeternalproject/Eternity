import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import EchoSpotNode, { collectEchoSpotIssues } from '../EchoSpotNode';

describe('EchoSpotNode persistence contract', () => {
  let editor: Editor | undefined;

  afterEach(() => editor?.destroy());

  it('把穩定 spot id、歌曲快照與 spoiler revisions 寫入 HTML 並可讀回', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, EchoSpotNode],
      content: '<p>前文</p>',
    });

    editor.commands.setEchoSpot({
      spotId: 'spot-fixed-id',
      songId: 'echoes/characters/xavier/theme',
      songUrlKey: 'audio/echoes/xavier-theme.mp3',
      entityKey: 'xavier-colsono',
      title: '那道回聲',
      clusterId: 'characters',
      songType: 'character',
      duration: 92,
      spoilerLevel: 3,
      spoilerRevisions: [
        { targetLevel: 2, gate: { requiresFlags: ['met:xavier'] } },
      ],
    });

    const html = editor.getHTML();
    expect(html).toContain('data-role="echo-spot"');
    expect(html).toContain('data-spot-id="spot-fixed-id"');
    expect(html).toContain('data-song-url-key="audio/echoes/xavier-theme.mp3"');
    expect(html).toContain('data-song-type="character"');

    const restored = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, EchoSpotNode],
      content: html,
    });
    const spot = restored
      .getJSON()
      .content?.find((node) => node.type === 'echoSpot');
    expect(spot?.attrs).toEqual(
      expect.objectContaining({
        spotId: 'spot-fixed-id',
        entityKey: 'xavier-colsono',
        duration: 92,
        songType: 'character',
        spoilerLevel: 3,
        spoilerRevisions: [
          { targetLevel: 2, gate: { requiresFlags: ['met:xavier'] } },
        ],
      })
    );
    restored.destroy();
  });
});

describe('collectEchoSpotIssues — spotId 唯一性存檔閘（回歸 #9）', () => {
  let editor: Editor | undefined;

  afterEach(() => editor?.destroy());

  function spotHtml(spotId: string): string {
    return (
      `<div data-role="echo-spot" data-spot-id="${spotId}" ` +
      'data-song-id="echoes/characters/x/theme" ' +
      'data-song-url-key="audio/x.mp3"></div>'
    );
  }

  function buildEditor(content: string): Editor {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, EchoSpotNode],
      content,
    });
    return editor;
  }

  it('spotId 皆唯一 → 無問題', () => {
    const e = buildEditor(`<p>前文</p>${spotHtml('a')}${spotHtml('b')}`);
    expect(collectEchoSpotIssues(e.state.doc)).toEqual([]);
  });

  it('複製貼上造成重複 spotId → 回報並指出 id', () => {
    const e = buildEditor(
      `${spotHtml('dup-id')}<p>中間</p>${spotHtml('dup-id')}`
    );
    const issues = collectEchoSpotIssues(e.state.doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('dup-id');
    expect(issues[0]).toContain('重複');
  });

  it('spotId 空白 → 回報缺少 spotId', () => {
    const e = buildEditor(spotHtml(''));
    const issues = collectEchoSpotIssues(e.state.doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('缺少 spotId');
  });
});
