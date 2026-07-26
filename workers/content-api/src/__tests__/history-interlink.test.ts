import { describe, it, expect } from 'vitest';

import { scanHistoryInterlinkAnchors } from '../history-interlink';

/**
 * History 互聯標記掃描器測試（Epic 2 S10-1 T-E1）
 *
 * 掃描器直接對序列化 HTML 做 regex 比對，邊界情況（屬性順序、
 * 跳脫字元、CJK 文字、殘缺屬性）比一般純函式多，測試著重在這些。
 */

/** 包成 ContentBlock[] JSON 字串（D1 實際的儲存形狀） */
function asContent(...html: string[]): string {
  return JSON.stringify(html.map((h) => ({ type: 'rich_text', content: h })));
}

const entityMark = (ref: string, text = '艾斯維爾') =>
  `<span data-uep-entity="concept" data-ref="${ref}">${text}</span>`;

const echoSpot = (attrs: string) =>
  `<div data-role="echo-spot" ${attrs}></div>`;

const visualClue = (edge: 'start' | 'gate' | 'end', attrs: string) =>
  `<div data-role="visual-clue-${edge}" ${attrs}></div>`;

describe('scanHistoryInterlinkAnchors — entity mark', () => {
  it('收新格式 entity:{key} ref，帶出顯示文字', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(`<p>那時候${entityMark('entity:xavier-colsono')}還在。</p>`)
    );
    expect(anchors).toEqual([
      {
        anchorKind: 'entity-mark',
        anchorId: null,
        keyType: 'entity',
        keyValue: 'xavier-colsono',
        label: '艾斯維爾',
      },
    ]);
  });

  it('舊格式路徑 ref 不進索引', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(entityMark('concepts/records/character_list#entry:abc'))
    );
    expect(anchors).toEqual([]);
  });

  it('非法 key 格式不進索引', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        entityMark('entity:Not_Kebab_Case'),
        entityMark('entity:'),
        entityMark('entity:has spaces')
      )
    );
    expect(anchors).toEqual([]);
  });

  it('同一頁多次提及同一個 key → 只留一列，label 取第一次', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        entityMark('entity:xavier-colsono', '艾斯維爾'),
        entityMark('entity:xavier-colsono', '他'),
        entityMark('entity:xavier-colsono', '那個男人')
      )
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0].label).toBe('艾斯維爾');
  });

  it('顯示文字含巢狀標籤時取純文字', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        '<span data-uep-entity="concept" data-ref="entity:invera"><strong>茵</strong>薇拉</span>'
      )
    );
    expect(anchors[0].label).toBe('茵薇拉');
  });

  it('屬性順序顛倒仍可解析', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        '<span data-ref="entity:invera" class="uep-entity" data-uep-entity="concept">茵薇拉</span>'
      )
    );
    expect(anchors[0].keyValue).toBe('invera');
  });
});

describe('scanHistoryInterlinkAnchors — echo spot', () => {
  it('劇情歌走 storyKey', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        echoSpot(
          'data-spot-id="spot-1" data-song-type="story" data-story-key="rain-sea-finale" data-song-title="雨海終曲"'
        )
      )
    );
    expect(anchors).toEqual([
      {
        anchorKind: 'echo-spot',
        anchorId: 'spot-1',
        keyType: 'story',
        keyValue: 'rain-sea-finale',
        label: '雨海終曲',
      },
    ]);
  });

  it('角色歌走 entityKey', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        echoSpot(
          'data-spot-id="spot-2" data-song-type="character" data-entity-key="xavier-colsono" data-song-title="X 的主題曲"'
        )
      )
    );
    expect(anchors[0]).toMatchObject({
      keyType: 'entity',
      keyValue: 'xavier-colsono',
      anchorId: 'spot-2',
    });
  });

  it('劇情歌沒有 storyKey → 不產生索引列', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        echoSpot(
          'data-spot-id="spot-3" data-song-type="story" data-song-title="無主劇情曲"'
        )
      )
    );
    expect(anchors).toEqual([]);
  });

  it('劇情歌不吃誤填的 entityKey', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        echoSpot(
          'data-spot-id="spot-4" data-song-type="story" data-entity-key="stray-key"'
        )
      )
    );
    expect(anchors).toEqual([]);
  });

  it('同 key 的多個 spot 各自成列（有穩定 id，不去重）', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        echoSpot(
          'data-spot-id="a" data-song-type="story" data-story-key="shared-point"'
        ),
        echoSpot(
          'data-spot-id="b" data-song-type="story" data-story-key="shared-point"'
        )
      )
    );
    expect(anchors.map((a) => a.anchorId)).toEqual(['a', 'b']);
  });
});

describe('scanHistoryInterlinkAnchors — visual clue', () => {
  it('三種 edge 各自成列，共用同一個 clueId', () => {
    const attrs =
      'data-clue-id="clue-1" data-target-type="story" data-target-key="rain-sea-finale" data-gallery-title="雨海"';
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        visualClue('start', attrs),
        visualClue('gate', attrs),
        visualClue('end', attrs)
      )
    );
    expect(anchors.map((a) => a.anchorKind)).toEqual([
      'visual-clue-start',
      'visual-clue-gate',
      'visual-clue-end',
    ]);
    expect(anchors.every((a) => a.anchorId === 'clue-1')).toBe(true);
    expect(anchors[0].keyType).toBe('story');
  });

  it('targetType=entity 走 entity 命名空間', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        visualClue(
          'start',
          'data-clue-id="c" data-target-type="entity" data-target-key="xavier-colsono"'
        )
      )
    );
    expect(anchors[0].keyType).toBe('entity');
  });

  it('未知的 targetType 退為 entity（不猜第三種命名空間）', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        visualClue(
          'start',
          'data-clue-id="c" data-target-type="illustration" data-target-key="legacy-key"'
        )
      )
    );
    expect(anchors[0].keyType).toBe('entity');
  });

  it('缺 targetKey → 不進索引', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        visualClue('start', 'data-clue-id="c" data-target-type="story"')
      )
    );
    expect(anchors).toEqual([]);
  });
});

describe('scanHistoryInterlinkAnchors — 容錯與輸入形狀', () => {
  it('跳脫字元的 label 會被解回原文', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        echoSpot(
          'data-spot-id="s" data-song-type="story" data-story-key="k" data-song-title="A &amp; B &quot;引號&quot;"'
        )
      )
    );
    expect(anchors[0].label).toBe('A & B "引號"');
  });

  it('接受未包成 ContentBlock 的裸 HTML 字串', () => {
    const anchors = scanHistoryInterlinkAnchors(
      `<p>${entityMark('entity:invera')}</p>`
    );
    expect(anchors).toHaveLength(1);
  });

  it('接受已解析的 ContentBlock 陣列', () => {
    const anchors = scanHistoryInterlinkAnchors([
      { type: 'rich_text', content: entityMark('entity:invera') },
    ]);
    expect(anchors).toHaveLength(1);
  });

  it('空內容 / null / 非陣列 → 空結果，不拋例外', () => {
    expect(scanHistoryInterlinkAnchors(null)).toEqual([]);
    expect(scanHistoryInterlinkAnchors(undefined)).toEqual([]);
    expect(scanHistoryInterlinkAnchors('')).toEqual([]);
    expect(scanHistoryInterlinkAnchors('[]')).toEqual([]);
    expect(scanHistoryInterlinkAnchors({ nope: true })).toEqual([]);
  });

  it('多個 block 的標記會合併，跨 block 的 entity mark 一樣去重', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        entityMark('entity:invera', '茵薇拉'),
        echoSpot(
          'data-spot-id="s" data-song-type="story" data-story-key="rain-sea-finale"'
        ),
        entityMark('entity:invera', '她')
      )
    );
    expect(anchors).toHaveLength(2);
    expect(anchors.filter((a) => a.anchorKind === 'entity-mark')).toHaveLength(
      1
    );
  });

  it('沒有任何標記的一般文章 → 空結果', () => {
    const anchors = scanHistoryInterlinkAnchors(
      asContent(
        '<p>一段沒有任何互聯標記的中文內容，含 <strong>粗體</strong>。</p>'
      )
    );
    expect(anchors).toEqual([]);
  });
});
