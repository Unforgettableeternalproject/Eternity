import React from 'react';
import UepAvatar from './UepAvatar';

type UepEffect =
  | 'shimmer'
  | 'glow'
  | 'halo'
  | 'glitch'
  | 'flicker'
  | 'fade'
  | 'echo'
  | 'static';

interface UepDialogueProps {
  side?: 'left' | 'right';
  text: string;
  effects?: UepEffect[];
  avatarSize?: number;
}

export default function UepDialogue({
  side = 'left',
  text,
  effects = ['shimmer', 'halo'],
  avatarSize = 52,
}: UepDialogueProps) {
  const isRight = side === 'right';
  const voiceClass = [
    'uep-voice',
    effects.includes('shimmer') && 'uep-voice--shimmer',
    effects.includes('glow') && 'uep-voice--glow',
    effects.includes('glitch') && 'uep-voice--glitch',
    effects.includes('flicker') && 'uep-voice--flicker',
    effects.includes('fade') && 'uep-voice--fade',
    effects.includes('echo') && 'uep-voice--echo',
    effects.includes('static') && 'uep-voice--static',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: isRight ? 'row-reverse' : 'row',
        gap: 14,
        alignItems: 'flex-start',
        maxWidth: 640,
        margin: isRight ? '14px 0 14px auto' : '14px 0',
      }}
    >
      <UepAvatar size={avatarSize} halo={effects.includes('halo')} />
      <div
        style={{
          position: 'relative',
          background:
            'linear-gradient(180deg, rgba(213,182,24,0.05), rgba(213,182,24,0.02))',
          border: '1px solid rgba(213,182,24,0.30)',
          borderRadius: 14,
          padding: '12px 16px',
          fontFamily: 'var(--font-serif-tc)',
          fontSize: 15,
          lineHeight: 1.7,
          textAlign: isRight ? 'right' : 'left',
        }}
      >
        {/* speech tail — clip-path 三角形，避免旋轉方塊邊框問題 */}
        <div
          style={{
            position: 'absolute',
            top: 16,
            [isRight ? 'right' : 'left']: -8,
            width: 10,
            height: 14,
            clipPath: isRight
              ? 'polygon(0 0, 100% 50%, 0 100%)'
              : 'polygon(100% 0, 0 50%, 100% 100%)',
            background: 'rgba(213,182,24,0.30)',
          }}
        />
        <div className={voiceClass}>{text}</div>
      </div>
    </div>
  );
}
