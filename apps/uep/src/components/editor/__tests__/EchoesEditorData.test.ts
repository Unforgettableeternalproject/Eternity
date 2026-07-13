import { describe, expect, it } from 'vitest';
import { parseEchoesData, serializeEchoesData } from '../EchoesEditorBody';

describe('Echoes editor metadata contract', () => {
  it('舊 gate 字串只遷移為 spoilerGate，不再覆蓋 GateCondition', () => {
    const parsed = parseEchoesData({ gate: '讀完第三章', category: 'story' });
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
          { targetLevel: 2, gate: { requiresFlags: ['met:x'] } },
        ],
      })
    );
  });
});
