import React, { type ReactNode } from 'react';

interface SidebarCardProps {
  children: ReactNode;
  id: string;
}

export default function SidebarCard({ children, id }: SidebarCardProps) {
  return (
    <div
      style={{
        marginBottom: '16px',
        transition: 'all 0.3s ease',
      }}
      data-card-id={id}
    >
      <div
        style={{
          backgroundColor: 'transparent',
          borderRadius: '12px',
          border: '1px solid rgba(148, 163, 184, 0.15)',
          overflow: 'hidden',
          boxShadow: 'none',
        }}
      >
        {/* 拖動把手 - 完全透明 */}
        <div
          className="drag-handle"
          style={{
            backgroundColor: 'transparent',
            padding: '6px 12px',
            cursor: 'grab',
            borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            minHeight: '28px',
          }}
        >
          <span style={{ fontSize: '14px', color: '#94a3b8', opacity: 0.4 }}>
            ⋮⋮
          </span>
        </div>
        {/* 卡片內容 */}
        <div style={{ padding: '16px' }}>{children}</div>
      </div>
    </div>
  );
}
