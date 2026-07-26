/**
 * dock chip 注意力聚合純函式測試（S9-D.5）
 *
 * 只測 computeChipAttentions() 這支純讀取函式，事件驅動重渲染的
 * useChipAttentions() hook 由 IslandDock 測試間接覆蓋。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearAllChipAttention, markChipAttention } from '../chipAttention';
import {
  pushEntityActivate,
  resetEntityActivateBridge,
} from '../concepts/terminalBridge';
import { setEchoSpotWaiting } from '../echoes/echoPreview';
import {
  clearEchoSuggestion,
  pushEchoSuggestion,
} from '../echoes/echoSuggestionBridge';
import { computeChipAttentions } from '../useChipAttention';
import {
  clearPhantomSuggestion,
  pushPhantomSuggestion,
  setClueWaitingCount,
} from '../visuals/phantomBridge';
import type { PhantomGallery } from '../visuals/phantomBridge';

function samplePhantomGallery(): PhantomGallery {
  return { id: 'visuals/g', title: '樣本畫廊', images: [], source: 'embed' };
}

function sampleEchoTrack() {
  return {
    source: 'embed' as const,
    songId: 'song-1',
    title: '樣本曲目',
    url: 'https://example.test/a.mp3',
    clusterId: 'special',
    spoilerLevel: 0 as const,
  };
}

function resetAllSources(): void {
  clearAllChipAttention();
  setClueWaitingCount(0);
  clearPhantomSuggestion();
  setEchoSpotWaiting(false);
  clearEchoSuggestion();
  resetEntityActivateBridge();
}

describe('computeChipAttentions', () => {
  beforeEach(resetAllSources);
  afterEach(resetAllSources);

  it('沒有任何來源成立時回傳空物件', () => {
    expect(computeChipAttentions()).toEqual({});
  });

  it('visuals：有等待中的視覺線索時視為 waiting', () => {
    setClueWaitingCount(2);
    expect(computeChipAttentions().visuals).toBe('有視覺線索等待中');
  });

  it('visuals：無 clue 等待時，相關畫廊提示也算 waiting', () => {
    pushPhantomSuggestion(samplePhantomGallery());
    expect(computeChipAttentions().visuals).toBe('有相關畫廊等待查看');
  });

  it('echoes：Echo Spot 等待插播時視為 waiting', () => {
    setEchoSpotWaiting(true);
    expect(computeChipAttentions().echoes).toBe('有回聲等待插播');
  });

  it('echoes：無 Echo Spot 時，相關回聲提示也算 waiting', () => {
    pushEchoSuggestion(sampleEchoTrack());
    expect(computeChipAttentions().echoes).toBe('有相關回聲等待查看');
  });

  it('concepts：terminalBridge 有 pending entity 時視為 waiting', () => {
    pushEntityActivate({ kind: 'character', ref: 'entity:test-char' });
    expect(computeChipAttentions().concepts).toBe('有條目等待查閱');
  });

  it('同一座島衍生型與標記型同時成立時，衍生型的說明優先', () => {
    setClueWaitingCount(1);
    markChipAttention('visuals', '剛剛有東西動了');
    expect(computeChipAttentions().visuals).toBe('有視覺線索等待中');
  });

  it('沒有衍生型來源時，退回讀標記', () => {
    markChipAttention('history', '閱讀進度已更新');
    expect(computeChipAttentions().history).toBe('閱讀進度已更新');
  });

  it('storage 沒有定義任何衍生型來源，只可能出現標記', () => {
    markChipAttention('storage', '便條已更新');
    expect(computeChipAttentions().storage).toBe('便條已更新');
  });
});
