import { describe, expect, it } from 'vitest';
import { parseEchoesData, serializeEchoesData } from '../EchoesEditorBody';

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
});
