import { describe, expect, it } from 'vitest';
import { formatInterlinkKey } from '../editorHelpers';

/**
 * Echo Spot 與 Visual Clue 的 bubble 引用同一套命名空間，字樣必須一致；
 * 兩邊各自寫死文案時曾出現「無 entityKey」對上「插圖 xxx」的分歧。
 */
describe('formatInterlinkKey', () => {
  it('story 命名空間顯示劇情點', () => {
    expect(formatInterlinkKey('story', 'rain-sea-finale')).toBe(
      '劇情點 rain-sea-finale'
    );
  });

  it('entity 命名空間顯示實體', () => {
    expect(formatInterlinkKey('entity', 'xavier-colsono')).toBe(
      '實體 xavier-colsono'
    );
  });

  it('缺 key 時指名缺的是哪一種', () => {
    expect(formatInterlinkKey('story')).toBe('無 storyKey');
    expect(formatInterlinkKey('entity', '  ')).toBe('無 entityKey');
  });
});
