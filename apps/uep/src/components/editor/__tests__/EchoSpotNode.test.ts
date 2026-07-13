import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import EchoSpotNode from '../EchoSpotNode';

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
        spoilerLevel: 3,
        spoilerRevisions: [
          { targetLevel: 2, gate: { requiresFlags: ['met:xavier'] } },
        ],
      })
    );
    restored.destroy();
  });
});
