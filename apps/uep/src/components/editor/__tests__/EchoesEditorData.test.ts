import { describe, expect, it } from 'vitest';
import {
  collectOtherEchoesEntityKeys,
  parseEchoesData,
  serializeEchoesData,
} from '../EchoesEditorBody';

describe('Echoes editor metadata contract', () => {
  it('舊 gate 字串只遷移為 spoilerGate，不再覆蓋 GateCondition', () => {
    const parsed = parseEchoesData({
      gate: '讀完第三章',
      category: 'character',
    });
    expect(parsed.spoilerGate).toBe('讀完第三章');
    const serialized = serializeEchoesData(parsed);
    expect(serialized.spoilerGate).toBe('讀完第三章');
    expect(serialized).not.toHaveProperty('gate');
  });

  it('gate 物件不被誤當文案，entityKey 與降級鏈可 round-trip', () => {
    const parsed = parseEchoesData({
      gate: { requiresFlags: ['completed:history/a'] },
      spoilerGate: '會暴雷',
      entityKey: 'xavier-colsono',
      spoilerRevisions: [
        { targetLevel: 2, gate: { requiresFlags: ['met:x'] } },
      ],
    });
    expect(parsed.spoilerGate).toBe('會暴雷');
    expect(serializeEchoesData(parsed)).toEqual(
      expect.objectContaining({
        entityKey: 'xavier-colsono',
        spoilerRevisions: [
          { sourceLevel: 3, gate: { requiresFlags: ['met:x'] } },
        ],
      })
    );
  });

  it('沒有離開條件時靜態 spoilerLevel 視為 L0', () => {
    const parsed = parseEchoesData({
      category: 'character',
      spoilerLevel: 2,
    });
    expect(parsed.spoilerLevel).toBe(0);
    expect(serializeEchoesData(parsed).spoilerLevel).toBe(0);
  });
  it('劇情歌不保存 spoiler level、提示文案或降級條件', () => {
    const parsed = parseEchoesData({
      category: 'story',
      spoilerLevel: 3,
      spoilerGate: '舊提示',
      spoilerRevisions: [
        { sourceLevel: 3, gate: { requiresFlags: ['story:seen'] } },
      ],
    });
    expect(parsed.spoilerLevel).toBe(0);
    expect(parsed.spoilerRevisions).toEqual([]);
    expect(serializeEchoesData(parsed)).toEqual(
      expect.objectContaining({ category: 'story', spoilerLevel: 0 })
    );
    expect(serializeEchoesData(parsed)).not.toHaveProperty('spoilerGate');
    expect(serializeEchoesData(parsed)).not.toHaveProperty('spoilerRevisions');
  });

  it('唯一性查核會排除 encoded tree id 對應的 decoded 當前歌曲', () => {
    const keys = collectOtherEchoesEntityKeys(
      [
        {
          id: 'echoes/characters/core_chara',
          pageType: 'subcategory',
          children: [
            {
              id: 'echoes/characters/core_chara/%E6%B8%AC%E8%A9%A6%E6%AD%8C%E6%9B%B2',
              pageType: 'song',
              metadata: { entityKey: 'a-man' },
            },
            {
              id: 'echoes/characters/core_chara/another-song',
              pageType: 'song',
              metadata: { entityKey: 'another-entity' },
            },
          ],
        },
      ],
      'echoes/characters/core_chara/測試歌曲'
    );

    expect([...keys.entityKeys]).toEqual(['another-entity']);
  });

  it('兩種 key 分別收集，互不混入', () => {
    const keys = collectOtherEchoesEntityKeys(
      [
        {
          id: 'echoes/stories/arc',
          pageType: 'subcategory',
          children: [
            {
              id: 'echoes/stories/arc/story-song',
              pageType: 'song',
              metadata: { storyKey: 'rain-sea-finale' },
            },
            {
              id: 'echoes/characters/core/char-song',
              pageType: 'song',
              metadata: { entityKey: 'xavier-colsono' },
            },
          ],
        },
      ],
      'echoes/stories/arc/current'
    );

    expect([...keys.storyKeys]).toEqual(['rain-sea-finale']);
    expect([...keys.entityKeys]).toEqual(['xavier-colsono']);
  });

  it('分類依 cluster 推導，metadata 裡的過期值不生效', () => {
    // metadata 說是 character，但頁面實際在 stories cluster 底下
    const parsed = parseEchoesData(
      { category: 'character', spoilerLevel: 3 },
      'echoes/stories/arc/some-song'
    );
    expect(parsed.category).toBe('story');
    // 劇情歌的差別待遇跟著套用
    expect(parsed.spoilerLevel).toBe(0);
  });

  it('storyKey 只在劇情歌輸出，entityKey 只在非劇情歌輸出', () => {
    const story = parseEchoesData(
      { entityKey: 'should-drop', storyKey: 'rain-sea-finale' },
      'echoes/stories/arc/song'
    );
    const serializedStory = serializeEchoesData(story);
    expect(serializedStory.storyKey).toBe('rain-sea-finale');
    expect(serializedStory.entityKey).toBeUndefined();

    const character = parseEchoesData(
      { entityKey: 'xavier-colsono', storyKey: 'should-drop' },
      'echoes/characters/core/song'
    );
    const serializedCharacter = serializeEchoesData(character);
    expect(serializedCharacter.entityKey).toBe('xavier-colsono');
    expect(serializedCharacter.storyKey).toBeUndefined();
  });
});
