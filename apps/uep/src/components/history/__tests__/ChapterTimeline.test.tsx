/**
 * ChapterTimeline 元件測試
 *
 * 涵蓋：
 * - 依 childType 過濾（arc 頁只列 section、chapter 頁只列 arc）
 * - 狀態呈現：completed / available / progression / flag / static
 * - 進度鏈隱藏：依賴頁仍鎖定的下游 progressPage 不顯示
 * - 互動：可讀項目點擊 → onNavigate；鎖定項目不觸發
 * - 空容器 → 不 render
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ChapterTimeline } from '../ChapterTimeline';
import type { ProgressTreeAdapter } from '../../../progress';
import { createInitialState } from '../../../progress';
import type { ProgressState } from '../../../progress';

interface TestNode {
  id: string;
  title: string;
  pageType: string;
  metadata: Record<string, unknown>;
  children?: TestNode[];
}

function stateWith(overrides: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...overrides };
}

/** 建立以 flat 節點清單為底的 tree adapter（沿用 effectiveGate.test 的模式） */
function makeAdapter(nodes: TestNode[]): {
  adapter: ProgressTreeAdapter;
  resolve: (id: string) => TestNode | undefined;
} {
  // 遞迴 flatten 建 byId，涵蓋所有子孫節點
  const flat: TestNode[] = [];
  const flatten = (list: TestNode[]) => {
    for (const n of list) {
      flat.push(n);
      if (n.children) flatten(n.children);
    }
  };
  flatten(nodes);
  const byId = new Map(flat.map((n) => [n.id, n]));

  // 建立 parentId 索引
  const parentOf = new Map<string, string | null>();
  const walk = (list: TestNode[], parent: string | null) => {
    for (const n of list) {
      parentOf.set(n.id, parent);
      if (n.children) walk(n.children, n.id);
    }
  };
  walk(nodes, null);

  const isProgressNode = (n: TestNode) => n.metadata.progressPage === true;
  const siblingsOf = (id: string): TestNode[] => {
    const parentId = parentOf.get(id) ?? null;
    if (parentId === null) return nodes.filter((n) => parentOf.get(n.id) === null);
    return byId.get(parentId)?.children ?? [];
  };
  const collectLeaves = (id: string, acc: string[] = []): string[] => {
    const node = byId.get(id);
    if (!node?.children?.length) return acc;
    for (const child of node.children) {
      if (child.children?.length) collectLeaves(child.id, acc);
      else if (isProgressNode(child)) acc.push(child.id);
    }
    return acc;
  };

  const adapter: ProgressTreeAdapter = {
    getNode: (id) => byId.get(id),
    getParent: (id) => {
      const pid = parentOf.get(id);
      return pid ? byId.get(pid) : undefined;
    },
    getParentId: (id) => parentOf.get(id) ?? null,
    getPreviousProgressSiblingId: (id) => {
      const siblings = siblingsOf(id);
      const idx = siblings.findIndex((s) => s.id === id);
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (isProgressNode(siblings[i])) return siblings[i].id;
      }
      return undefined;
    },
    getProgressDescendantIds: (id) => collectLeaves(id),
  };
  return { adapter, resolve: (id) => byId.get(id) };
}

describe('ChapterTimeline — 基本渲染', () => {
  const chapter: TestNode = {
    id: 'ch1',
    title: '不見天日的礦場',
    pageType: 'chapter',
    metadata: {},
    children: [
      {
        id: 'arc-01',
        title: '序 你所追求的真相',
        pageType: 'arc',
        metadata: { description: '故事的起點' },
      },
      {
        id: 'arc-02',
        title: '艾斯維爾與神',
        pageType: 'arc',
        metadata: { progressPage: true, description: '初遇' },
      },
      // 非 arc（不該出現）
      {
        id: 'page-note',
        title: '編註',
        pageType: 'page',
        metadata: {},
      },
    ],
  };

  it('chapter 頁只列 arc，過濾非 arc 子項', () => {
    const { adapter, resolve } = makeAdapter([chapter]);
    render(
      <ChapterTimeline
        containerNode={chapter}
        childType="arc"
        progress={createInitialState()}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText('序 你所追求的真相')).toBeInTheDocument();
    expect(screen.getByText('艾斯維爾與神')).toBeInTheDocument();
    expect(screen.queryByText('編註')).not.toBeInTheDocument();
  });

  it('空容器 → 回傳 null（不 render list）', () => {
    const empty: TestNode = {
      id: 'empty',
      title: '空章',
      pageType: 'chapter',
      metadata: {},
      children: [],
    };
    const { adapter, resolve } = makeAdapter([empty]);
    const { container } = render(
      <ChapterTimeline
        containerNode={empty}
        childType="arc"
        progress={createInitialState()}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('ChapterTimeline — 狀態呈現', () => {
  const tree: TestNode[] = [
    {
      id: 'ch1',
      title: 'CH1',
      pageType: 'chapter',
      metadata: {},
      children: [
        {
          id: 'A',
          title: '第一章',
          pageType: 'arc',
          metadata: { progressPage: true },
        },
        {
          id: 'B',
          title: '第二章',
          pageType: 'arc',
          metadata: { progressPage: true },
        },
        {
          id: 'C',
          title: '第三章',
          pageType: 'arc',
          metadata: { progressPage: true },
        },
        {
          id: 'X',
          title: '秘話',
          pageType: 'arc',
          metadata: { gate: { pristineOnly: true } },
        },
        {
          id: 'S',
          title: '靜態鎖章',
          pageType: 'arc',
          metadata: { locked: true },
        },
      ],
    },
  ];

  it('completed 節點顯示 is-completed 樣式', () => {
    const { adapter, resolve } = makeAdapter(tree);
    const state = stateWith({ flags: ['completed:A'] });
    const { container } = render(
      <ChapterTimeline
        containerNode={tree[0]}
        childType="arc"
        progress={state}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={() => {}}
      />
    );
    const items = container.querySelectorAll('.history-timeline-item');
    // A 為 completed
    expect(items[0].className).toContain('is-completed');
    // B 是 available（因 A completed）
    expect(items[1].className).toContain('is-available');
  });

  it('progression 鎖：標題 blurred + is-progression 樣式', () => {
    const { adapter, resolve } = makeAdapter(tree);
    const { container } = render(
      <ChapterTimeline
        containerNode={tree[0]}
        childType="arc"
        progress={createInitialState()}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={() => {}}
      />
    );
    const items = container.querySelectorAll('.history-timeline-item');
    // A 是進度鏈第一個 → available；B 依賴 A（未完成）→ progression 但依賴頁本身仍可讀 → 顯示
    expect(items[0].className).toContain('is-available');
    expect(items[1].className).toContain('is-progression');
    // 標題模糊 class
    expect(
      container.querySelector('.history-tree-title--blurred')
    ).toBeInTheDocument();
  });

  it('循序漸進隱藏：C 依賴 B、B 依賴 A，A 未完成時 C 不出現', () => {
    const { adapter, resolve } = makeAdapter(tree);
    const { container } = render(
      <ChapterTimeline
        containerNode={tree[0]}
        childType="arc"
        progress={createInitialState()}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={() => {}}
      />
    );
    // C 依賴 B、B 又鎖 → C 應被鏈隱藏
    expect(screen.queryByText('第三章')).not.toBeInTheDocument();
  });

  it('flag 鎖：標題顯示 ？？？ + is-flag 樣式', () => {
    const { adapter, resolve } = makeAdapter(tree);
    const { container } = render(
      <ChapterTimeline
        containerNode={tree[0]}
        childType="arc"
        progress={stateWith({ observerEver: true })}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={() => {}}
      />
    );
    // X 因 pristineOnly + 有印記 → flag lock
    expect(container.querySelector('.is-flag')).toBeInTheDocument();
    expect(screen.getAllByText('？？？').length).toBeGreaterThan(0);
    // 原標題「秘話」不應顯示
    expect(screen.queryByText('秘話')).not.toBeInTheDocument();
  });

  it('static 鎖：is-static 樣式且按鈕 disabled', () => {
    const { adapter, resolve } = makeAdapter(tree);
    const { container } = render(
      <ChapterTimeline
        containerNode={tree[0]}
        childType="arc"
        progress={createInitialState()}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={() => {}}
      />
    );
    const staticItem = container.querySelector('.is-static');
    expect(staticItem).toBeInTheDocument();
    const button = staticItem?.querySelector('button');
    expect(button).toBeDisabled();
  });
});

describe('ChapterTimeline — 互動', () => {
  const tree: TestNode[] = [
    {
      id: 'ch1',
      title: 'CH1',
      pageType: 'chapter',
      metadata: {},
      children: [
        {
          id: 'A',
          title: '第一章',
          pageType: 'arc',
          metadata: { progressPage: true },
        },
        {
          id: 'B',
          title: '第二章',
          pageType: 'arc',
          metadata: { progressPage: true },
        },
      ],
    },
  ];

  it('可讀項目點擊 → onNavigate 被呼叫', () => {
    const { adapter, resolve } = makeAdapter(tree);
    const onNavigate = vi.fn();
    render(
      <ChapterTimeline
        containerNode={tree[0]}
        childType="arc"
        progress={createInitialState()}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={onNavigate}
      />
    );
    fireEvent.click(screen.getByText('第一章'));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0][0].id).toBe('A');
  });

  it('鎖定項目 disabled → 點擊不觸發 onNavigate', () => {
    const { adapter, resolve } = makeAdapter(tree);
    const onNavigate = vi.fn();
    const { container } = render(
      <ChapterTimeline
        containerNode={tree[0]}
        childType="arc"
        progress={createInitialState()}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={onNavigate}
      />
    );
    // B 是 progression lock，button 是 disabled
    const items = container.querySelectorAll('.history-timeline-item');
    const disabledBtn = items[1].querySelector('button');
    expect(disabledBtn).toBeDisabled();
    fireEvent.click(disabledBtn!);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('currentId 相符 → 標記 is-current 並 aria-current', () => {
    const { adapter, resolve } = makeAdapter(tree);
    const { container } = render(
      <ChapterTimeline
        containerNode={tree[0]}
        childType="arc"
        progress={createInitialState()}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={() => {}}
        currentId="A"
      />
    );
    const items = container.querySelectorAll('.history-timeline-item');
    expect(items[0].getAttribute('aria-current')).toBe('true');
    expect(items[0].className).toContain('is-current');
  });
});

describe('ChapterTimeline — Arc 頁列 section', () => {
  const tree: TestNode[] = [
    {
      id: 'arc-1',
      title: 'Arc 1',
      pageType: 'arc',
      metadata: {},
      children: [
        {
          id: 'sec-1-1',
          title: '第一節',
          pageType: 'section',
          metadata: { description: '節一' },
        },
        {
          id: 'sec-1-2',
          title: '第二節',
          pageType: 'section',
          metadata: {},
        },
        // arc 下再有 arc（應該不出現在 section 列表）
        {
          id: 'nested-arc',
          title: '嵌套弧',
          pageType: 'arc',
          metadata: {},
        },
      ],
    },
  ];

  it('arc 頁的 childType=section，只列直屬 section', () => {
    const { adapter, resolve } = makeAdapter(tree);
    render(
      <ChapterTimeline
        containerNode={tree[0]}
        childType="section"
        progress={createInitialState()}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText('第一節')).toBeInTheDocument();
    expect(screen.getByText('第二節')).toBeInTheDocument();
    expect(screen.queryByText('嵌套弧')).not.toBeInTheDocument();
  });

  it('metadata.description 呈現為 desc 行', () => {
    const { adapter, resolve } = makeAdapter(tree);
    render(
      <ChapterTimeline
        containerNode={tree[0]}
        childType="section"
        progress={createInitialState()}
        progressTree={adapter}
        resolvePageById={resolve}
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText('節一')).toBeInTheDocument();
  });
});
