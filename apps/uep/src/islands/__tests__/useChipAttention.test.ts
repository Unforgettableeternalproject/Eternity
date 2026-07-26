/**
 * dock chip 注意力聚合純函式測試（S9-D.5）
 *
 * 只測 computeChipAttentions() 這支純讀取函式，事件驅動重渲染的
 * useChipAttentions() hook 由 IslandDock 測試間接覆蓋。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearAllChipPulses, flashChip } from '../chipAttention';
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
  clearAllChipPulses();
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
    expect(computeChipAttentions().visuals).toEqual({
      kind: 'waiting',
      reason: '有視覺線索等待中',
    });
  });

  it('visuals：無 clue 等待時，相關畫廊提示也算 waiting', () => {
    pushPhantomSuggestion(samplePhantomGallery());
    expect(computeChipAttentions().visuals).toEqual({
      kind: 'waiting',
      reason: '有相關畫廊等待查看',
    });
  });

  it('echoes：Echo Spot 等待插播時視為 waiting', () => {
    setEchoSpotWaiting(true);
    expect(computeChipAttentions().echoes).toEqual({
      kind: 'waiting',
      reason: '有回聲等待插播',
    });
  });

  it('echoes：無 Echo Spot 時，相關回聲提示也算 waiting', () => {
    pushEchoSuggestion(sampleEchoTrack());
    expect(computeChipAttentions().echoes).toEqual({
      kind: 'waiting',
      reason: '有相關回聲等待查看',
    });
  });

  it('concepts：terminalBridge 有 pending entity 時視為 waiting', () => {
    pushEntityActivate({ kind: 'character', ref: 'entity:test-char' });
    expect(computeChipAttentions().concepts).toEqual({
      kind: 'waiting',
      reason: '有條目等待查閱',
    });
  });

  it('同一座島 waiting 與 pulse 同時成立時，waiting 優先於 pulse', () => {
    setClueWaitingCount(1);
    flashChip('visuals', '剛剛有東西動了');
    expect(computeChipAttentions().visuals).toEqual({
      kind: 'waiting',
      reason: '有視覺線索等待中',
    });
  });

  it('沒有 waiting 來源時，退回讀 pulse（瞬時事件）', () => {
    flashChip('history', '閱讀進度已更新');
    expect(computeChipAttentions().history).toEqual({
      kind: 'pulse',
      reason: '閱讀進度已更新',
    });
  });

  it('storage 沒有定義任何 waiting 來源，只可能出現 pulse', () => {
    flashChip('storage', '便條已更新');
    expect(computeChipAttentions().storage).toEqual({
      kind: 'pulse',
      reason: '便條已更新',
    });
  });
});
