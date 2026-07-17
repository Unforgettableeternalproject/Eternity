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

    expect([...keys]).toEqual(['another-entity']);
  });
});
