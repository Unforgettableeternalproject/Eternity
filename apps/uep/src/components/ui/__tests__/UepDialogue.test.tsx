/**
 * UepDialogue 原子片段斷行測試（Ariel 2026-08-12 排版建議）
 *
 * 「U.E.P」稱號與顏文字是不可拆行的單位——渲染層把它們包進
 * nowrap span，其餘文字原樣輸出。
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { renderNoBreakTokens } from '../UepDialogue';

/** 取出所有 nowrap span 的文字內容 */
function nowrapTokens(text: string): string[] {
  const html = renderToStaticMarkup(<>{renderNoBreakTokens(text)}</>);
  return [...html.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
}

describe('renderNoBreakTokens', () => {
  it('U.E.P 稱號包進 nowrap（含縮寫變體）', () => {
    expect(nowrapTokens('根據U.E.P所說的，這些回聲被分為四種。')).toEqual([
      'U.E.P',
    ]);
    expect(nowrapTokens('UEP 是這裡的管理者。')).toEqual(['UEP']);
  });

  it('顏文字連同尾綴符號整段包進 nowrap', () => {
    expect(nowrapTokens('我很自豪喔! (๑•̀ㅂ•́)و✧ 繼續走吧。')).toEqual([
      '(๑•̀ㅂ•́)و✧',
    ]);
  });

  it('一般中文夾註不包（維持原斷行行為）', () => {
    expect(nowrapTokens('她說完就走了（笑），留下一室安靜。')).toEqual([]);
  });

  it('無 token 的純文字原樣輸出', () => {
    const text = '一段完全普通的敘述文字。';
    expect(renderNoBreakTokens(text)).toBe(text);
  });

  it('同一句多個 token 各自獨立包裹', () => {
    expect(nowrapTokens('U.E.P 揮揮手 (ﾉ´∀`)ﾉ 說再見。')).toEqual([
      'U.E.P',
      '(ﾉ´∀`)ﾉ',
    ]);
  });
});
