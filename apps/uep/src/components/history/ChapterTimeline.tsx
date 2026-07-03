/**
 * ChapterTimeline — Chapter / Arc 頁的自動時間軸目錄
 *
 * 依父容器層級呈現子項目：
 * - Chapter 頁：列出直屬 arc（不含 section）
 * - Arc 頁：列出直屬 section
 *
 * 視覺形式為垂直時間軸——左側節點、右側標題與摘要。狀態表現：
 * - completed：實心點（金）
 * - available：空心點，可點擊
 * - progression：虛化實心點 + 標題模糊
 * - flag：問號節點 + 標題「？？？」
 * - static：🔒 節點 + 半透明
 *
 * 手寫連結與此目錄可共存（articleHtml 依然渲染）。
 */
import React from 'react';

import { renderIcon } from '../editor/IconLibrary';
import { isEffectivelyCompleted } from '../../progress';
import type { ProgressState, ProgressTreeAdapter } from '../../progress';
import {
  getLockKind,
  isHidden,
  isProgressionChainHidden,
} from '../zone/contentVisibility';
import type { LockKind } from '../zone/contentVisibility';

interface TimelineNode {
  id: string;
  title: string;
  pageType: string;
  metadata: Record<string, unknown>;
  children?: TimelineNode[];
}

export interface ChapterTimelineProps {
  containerNode: TimelineNode;
  /** 要列出的子類型：'arc'（chapter 頁使用）或 'section'（arc 頁使用） */
  childType: 'arc' | 'section';
  progress: ProgressState;
  progressTree: ProgressTreeAdapter;
  resolvePageById: (id: string) => TimelineNode | undefined;
  onNavigate: (child: TimelineNode) => void;
  /** 目前正在閱讀的頁面 id，用於「當前節點」高亮（可選） */
  currentId?: string | null;
}

interface NodeState {
  kind: 'completed' | 'available' | LockKind;
  current: boolean;
}

function computeState(
  node: TimelineNode,
  progress: ProgressState,
  progressTree: ProgressTreeAdapter,
  currentId?: string | null
): NodeState {
  const current = currentId === node.id;
  const lockKind = getLockKind(node, progress, node.id, progressTree);
  if (lockKind) return { kind: lockKind, current };
  const completed = isEffectivelyCompleted(node.id, progress, progressTree);
  return { kind: completed ? 'completed' : 'available', current };
}

function nodeMarker(state: NodeState, node: TimelineNode): React.ReactNode {
  switch (state.kind) {
    case 'completed':
      return <span className="history-timeline-dot is-completed" aria-hidden />;
    case 'progression':
      return <span className="history-timeline-dot is-progression" aria-hidden />;
    case 'flag':
      return (
        <span className="history-timeline-dot is-flag" aria-hidden>
          ❖
        </span>
      );
    case 'static':
      return (
        <span className="history-timeline-dot is-static" aria-hidden>
          🔒
        </span>
      );
    case 'available':
    default:
      return (
        <span
          className={`history-timeline-dot is-available${state.current ? ' is-current' : ''}`}
          aria-hidden
        >
          {renderIcon(node.metadata?.icon as string, 12) || null}
        </span>
      );
  }
}

function nodeTitleClass(state: NodeState): string | undefined {
  if (state.kind === 'progression') return 'history-tree-title--blurred';
  if (state.kind === 'flag') return 'history-tree-title--veiled';
  return undefined;
}

function nodeTitle(state: NodeState, node: TimelineNode): React.ReactNode {
  if (state.kind === 'flag') return '？？？';
  return node.title;
}

export function ChapterTimeline({
  containerNode,
  childType,
  progress,
  progressTree,
  resolvePageById,
  onNavigate,
  currentId,
}: ChapterTimelineProps) {
  const children = (containerNode.children || []).filter((child) => {
    if (child.pageType !== childType) return false;
    if (isHidden(child)) return false;
    if (
      isProgressionChainHidden(
        child,
        progress,
        resolvePageById,
        child.id,
        progressTree
      )
    )
      return false;
    return true;
  });

  if (children.length === 0) return null;

  const label = childType === 'arc' ? '章節時間軸' : '段落時間軸';

  return (
    <ol
      className={`history-timeline history-timeline--${childType}`}
      aria-label={label}
    >
      {children.map((child) => {
        const state = computeState(child, progress, progressTree, currentId);
        const locked = state.kind !== 'completed' && state.kind !== 'available';
        const description =
          typeof child.metadata?.description === 'string'
            ? (child.metadata.description as string)
            : '';
        const displayDesc = state.kind === 'flag' ? '？？？' : description;

        return (
          <li
            key={child.id}
            className={`history-timeline-item is-${state.kind}${state.current ? ' is-current' : ''}`}
            aria-current={state.current ? 'true' : undefined}
          >
            <button
              type="button"
              className="history-timeline-button"
              disabled={locked}
              aria-disabled={locked || undefined}
              onClick={() => {
                if (!locked) onNavigate(child);
              }}
            >
              <span className="history-timeline-marker">
                {nodeMarker(state, child)}
              </span>
              <span className="history-timeline-body">
                <span
                  className={`history-timeline-title ${nodeTitleClass(state) || ''}`.trim()}
                >
                  {nodeTitle(state, child)}
                </span>
                {displayDesc && (
                  <span
                    className={`history-timeline-desc ${state.kind === 'flag' ? 'history-tree-title--veiled' : ''}`.trim()}
                  >
                    {displayDesc}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default ChapterTimeline;
