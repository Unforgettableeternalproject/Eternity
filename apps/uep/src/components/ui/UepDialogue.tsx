import React from 'react';
import UepAvatar from './UepAvatar';

/** 「U.E.P」稱號的各種寫法——是一個名字，不可被斷行拆開 */
const UEP_TOKEN_SOURCE = 'U\\.E\\.P\\.?|UEP';

/**
 * 括號起頭的顏文字候選：全形／半形括號 + 短內文 + 可黏著的尾綴
 * （`و✧`、`ﾉﾞ` 這類手勢與星星）。是不是真顏文字由 isKaomoji 再驗。
 */
const PAREN_RUN_SOURCE =
  '[（(][^（）()\\n]{1,22}[）)]' +
  '[^\\s\\u4e00-\\u9fffA-Za-z0-9，。、！？!?,.;：:「」『』“”‘’"\'（）()]{0,6}';

const ATOMIC_TOKEN_REGEX = new RegExp(
  `(${UEP_TOKEN_SOURCE}|${PAREN_RUN_SOURCE})`,
  'g'
);

/**
 * 括號段是否為顏文字：內含至少一個「符號類」字元
 * （非 CJK、非 ASCII 字母數字、非常用標點）。一般的中文夾註
 * （像「（笑）」）不算，維持原樣參與斷行。
 */
function isKaomoji(run: string): boolean {
  // U+4E00–U+9FFF = CJK 統一表意文字；U+3000–U+303F = CJK 標點——
  // 全形空白（U+3000）用跳脫寫法，字面字元會被 no-irregular-whitespace 擋下
  return /[^\u4e00-\u9fff\u3000-\u303fA-Za-z0-9\s（）()，。、！？!?,.;：:'"~\-·]/.test(
    run
  );
}

/**
 * 把不可拆行的原子片段（U.E.P 稱號、顏文字）包進 nowrap span
 * （Ariel 2026-08-12 排版建議：「UEP」與表情符號不應該被斷行拆開）。
 * 其餘文字原樣輸出，斷行行為不變。
 */
export function renderNoBreakTokens(text: string): React.ReactNode {
  const parts = text.split(ATOMIC_TOKEN_REGEX);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    // split 的奇數位是捕獲組（候選 token）
    const isToken = i % 2 === 1 && (/^U/.test(part) ? true : isKaomoji(part));
    return isToken ? (
      <span key={i} style={{ whiteSpace: 'nowrap' }}>
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    );
  });
}

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
        display: 'flex',
        flexDirection: isRight ? 'row-reverse' : 'row',
        gap: 20,
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
            [isRight ? 'right' : 'left']: -14,
            width: 10,
            height: 14,
            clipPath: isRight
              ? 'polygon(0 0, 100% 50%, 0 100%)'
              : 'polygon(100% 0, 0 50%, 100% 100%)',
            background: 'rgba(213,182,24,0.30)',
          }}
        />
        <div className={voiceClass}>{renderNoBreakTokens(text)}</div>
      </div>
    </div>
  );
}
