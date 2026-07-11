/**
 * EchoesIsland — 流浪回聲（S8）
 *
 * B-2 骨架：先讓島可經 IslandHost lazy 掛載。
 * 播放器本體（黑色回聲球視覺、播放控制、佇列）在 B-3 接上，
 * 視覺依 Eternity-Design/components/echoes-island.jsx 定案稿。
 */
import React from 'react';

export default function EchoesIsland() {
  return (
    <div
      style={{
        padding: '24px 16px',
        textAlign: 'center',
        fontStyle: 'italic',
        opacity: 0.6,
        fontSize: 13,
      }}
    >
      回聲正在漂流過來的路上……
    </div>
  );
}
