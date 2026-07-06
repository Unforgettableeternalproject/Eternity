/**
 * embed/interactive 測試 — 前台啟用層（Epic 2 S4，S7-C 新語意）
 *
 * 驗證三件事：
 * 1. isEntityUnlocked：新格式一律解鎖；舊格式 met:{ref} fallback + 觀測者 bypass
 * 2. decorateInteractiveHtml：concepts 島掛載 → 全部啟用；未掛載/觀測者 → 普通文字
 * 3. dispatchEntityActivate：事件 detail 合約（新格式帶 entityKey、舊格式帶 pageId）
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { createInitialState } from '../../progress/types';
import type { ProgressState } from '../../progress/types';
import {
  UEP_ENTITY_ACTIVE_ATTR,
  UEP_ENTITY_ACTIVATE_EVENT,
  isEntityUnlocked,
  decorateInteractiveHtml,
  dispatchEntityActivate,
} from '../interactive';
import type { EntityActivateDetail } from '../interactive';
import { metFlag } from '../marks';

const REF = 'concepts/log#entry:asvere';
const KEY_REF = 'entity:xavier-colsono';

function stateWith(partial: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...partial };
}

/** concepts 島掛載中的探索者（decorate 守門通過的基準狀態） */
function mountedState(partial: Partial<ProgressState> = {}): ProgressState {
  return stateWith({ islandsUnlocked: ['concepts'], ...partial });
}

function parseHtml(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

const entitySpan = (ref: string = REF, text = '艾斯維爾') =>
  `<span data-uep-entity="character" data-ref="${ref}">${text}</span>`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isEntityUnlocked（S7-C：僅剩舊格式 fallback 語意）', () => {
  it('新格式 entity:{key} 一律解鎖（旗標不卡，revision 卡內容）', () => {
    expect(isEntityUnlocked(stateWith({}), KEY_REF)).toBe(true);
  });

  it('舊格式未持有 met 旗標 → 未解鎖', () => {
    expect(isEntityUnlocked(stateWith({}), REF)).toBe(false);
  });

  it('舊格式持有 met:{ref} 旗標 → 解鎖', () => {
    expect(isEntityUnlocked(stateWith({ flags: [metFlag(REF)] }), REF)).toBe(
      true
    );
  });

  it('舊格式觀測者視角 bypass（全知）', () => {
    expect(
      isEntityUnlocked(stateWith({ view: 'observer', observerEver: true }), REF)
    ).toBe(true);
  });

  it('無效 ref 一律 false，觀測者也一樣（前台容錯）', () => {
    const observer = stateWith({ view: 'observer', observerEver: true });
    expect(isEntityUnlocked(observer, 'badref')).toBe(false);
    expect(isEntityUnlocked(stateWith({}), '')).toBe(false);
    expect(isEntityUnlocked(stateWith({}), 'entity:Bad Key')).toBe(false);
  });
});

describe('decorateInteractiveHtml（S7-C：島掛載守門，全可點）', () => {
  it('無 entity 標記的 HTML 原樣返回（不經 DOMParser）', () => {
    const html = '<p>普通段落，<strong>沒有</strong>嵌入。</p>';
    expect(decorateInteractiveHtml(html, mountedState())).toBe(html);
  });

  it('島掛載時所有合法 entity 附加啟用 + a11y 屬性（不看旗標）', () => {
    const out = decorateInteractiveHtml(
      `<p>${entitySpan()}</p>`,
      mountedState() // 無任何 met 旗標
    );
    const span = parseHtml(out).querySelector('span')!;
    expect(span.getAttribute(UEP_ENTITY_ACTIVE_ATTR)).toBe('true');
    expect(span.getAttribute('role')).toBe('button');
    expect(span.getAttribute('tabindex')).toBe('0');
    expect(span.getAttribute('aria-label')).toBe('開啟角色引用：艾斯維爾');
  });

  it('新格式 ref 同樣啟用', () => {
    const out = decorateInteractiveHtml(
      `<p>${entitySpan(KEY_REF)}</p>`,
      mountedState()
    );
    expect(
      parseHtml(out).querySelector(`[${UEP_ENTITY_ACTIVE_ATTR}]`)
    ).not.toBeNull();
  });

  it('島未解鎖時維持普通文字（旗標再多也不啟用）', () => {
    const out = decorateInteractiveHtml(
      `<p>${entitySpan()}</p>`,
      stateWith({ flags: [metFlag(REF)] }) // islandsUnlocked 為空
    );
    const span = parseHtml(out).querySelector('span')!;
    expect(span.hasAttribute(UEP_ENTITY_ACTIVE_ATTR)).toBe(false);
    expect(span.hasAttribute('role')).toBe(false);
    expect(span.hasAttribute('tabindex')).toBe(false);
    // 原始標記屬性保留（進度變化後重算需要）
    expect(span.getAttribute('data-uep-entity')).toBe('character');
  });

  it('島被使用者停用時不啟用', () => {
    const out = decorateInteractiveHtml(
      `<p>${entitySpan()}</p>`,
      mountedState({ islandsDisabled: ['concepts'] })
    );
    expect(
      parseHtml(out).querySelector(`[${UEP_ENTITY_ACTIVE_ATTR}]`)
    ).toBeNull();
  });

  it('觀測者視角不啟用（無浮島 = 無消費端，維持普通文字）', () => {
    const out = decorateInteractiveHtml(
      `<p>${entitySpan()}</p>`,
      mountedState({ view: 'observer', observerEver: true })
    );
    expect(
      parseHtml(out).querySelector(`[${UEP_ENTITY_ACTIVE_ATTR}]`)
    ).toBeNull();
  });

  it('無效 ref 的 entity 不啟用（島掛載也一樣）', () => {
    const out = decorateInteractiveHtml(
      `<p>${entitySpan('badref', '壞引用')}</p>`,
      mountedState()
    );
    expect(
      parseHtml(out).querySelector(`[${UEP_ENTITY_ACTIVE_ATTR}]`)
    ).toBeNull();
  });

  it('冪等：殘留的啟用屬性在島未掛載時被清除（防禦外部資料）', () => {
    const stale =
      `<p><span data-uep-entity="character" data-ref="${REF}" ` +
      `${UEP_ENTITY_ACTIVE_ATTR}="true" role="button" tabindex="0">甲</span></p>`;
    const out = decorateInteractiveHtml(stale, stateWith({}));
    const span = parseHtml(out).querySelector('span')!;
    expect(span.hasAttribute(UEP_ENTITY_ACTIVE_ATTR)).toBe(false);
    expect(span.hasAttribute('role')).toBe(false);
    expect(span.hasAttribute('tabindex')).toBe(false);
  });

  it('不影響其他內容（UEP 對話節點、一般 HTML）', () => {
    const html =
      `<div data-role="uep" data-side="left">對話</div>` +
      `<p>${entitySpan()}</p><hr><p>結尾</p>`;
    const out = decorateInteractiveHtml(html, stateWith({}));
    const container = parseHtml(out);
    expect(container.querySelector('[data-role="uep"]')?.textContent).toBe(
      '對話'
    );
    expect(container.querySelectorAll('hr')).toHaveLength(1);
    expect(container.textContent).toContain('結尾');
  });
});

describe('dispatchEntityActivate', () => {
  it('非啟用元素 → null 且不 dispatch', () => {
    const listener = vi.fn();
    window.addEventListener(UEP_ENTITY_ACTIVATE_EVENT, listener);
    const el = parseHtml(entitySpan()).querySelector('span')!;
    expect(dispatchEntityActivate(el)).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(UEP_ENTITY_ACTIVATE_EVENT, listener);
  });

  it('舊格式啟用元素 → dispatch 完整 detail（pageId + entryId）', () => {
    const received: EntityActivateDetail[] = [];
    const listener = (event: Event) =>
      received.push((event as CustomEvent<EntityActivateDetail>).detail);
    window.addEventListener(UEP_ENTITY_ACTIVATE_EVENT, listener);

    const decorated = decorateInteractiveHtml(
      `<p>${entitySpan()}</p>`,
      mountedState()
    );
    const el = parseHtml(decorated).querySelector(
      `[${UEP_ENTITY_ACTIVE_ATTR}]`
    )!;
    const detail = dispatchEntityActivate(el, 'history/u/1-1');

    expect(detail).toEqual({
      kind: 'character',
      ref: REF,
      pageId: 'concepts/log',
      entryId: 'asvere',
      text: '艾斯維爾',
      sourcePageId: 'history/u/1-1',
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(detail);
    window.removeEventListener(UEP_ENTITY_ACTIVATE_EVENT, listener);
  });

  it('新格式啟用元素 → detail 帶 entityKey、不帶 pageId（S7-C 合約）', () => {
    const decorated = decorateInteractiveHtml(
      `<p>${entitySpan(KEY_REF)}</p>`,
      mountedState()
    );
    const el = parseHtml(decorated).querySelector(
      `[${UEP_ENTITY_ACTIVE_ATTR}]`
    )!;
    expect(dispatchEntityActivate(el, 'history/u/1-1')).toEqual({
      kind: 'character',
      ref: KEY_REF,
      entityKey: 'xavier-colsono',
      text: '艾斯維爾',
      sourcePageId: 'history/u/1-1',
    });
  });

  it('無錨點 ref → detail 不含 entryId；未提供來源頁 → 不含 sourcePageId', () => {
    const ref = 'concepts/log';
    const decorated = decorateInteractiveHtml(
      `<p>${entitySpan(ref, '雨海塔')}</p>`,
      mountedState()
    );
    const el = parseHtml(decorated).querySelector(
      `[${UEP_ENTITY_ACTIVE_ATTR}]`
    )!;
    expect(dispatchEntityActivate(el)).toEqual({
      kind: 'character',
      ref,
      pageId: 'concepts/log',
      text: '雨海塔',
    });
  });

  it('帶啟用屬性但 ref 無效（外部資料破壞） → null', () => {
    const el = parseHtml(
      `<span data-uep-entity="term" data-ref="bad" ` +
        `${UEP_ENTITY_ACTIVE_ATTR}="true">壞</span>`
    ).querySelector('span')!;
    expect(dispatchEntityActivate(el)).toBeNull();
  });
});
