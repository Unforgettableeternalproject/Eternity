import React, { useState } from 'react';

interface EchoesEditorBodyProps {
  accent: string;
  initialData: EchoesData;
  onDataChange: (data: EchoesData) => void;
  onDirty: () => void;
}

export interface EchoesData {
  subtitle: string;
  category: string;
  spoilerLevel: number;
  gate: string;
  audioFile: string | null;
  audioMeta: { size?: number; duration?: number; info?: string } | null;
  appreciation: string[];
  appreciationLocked: string;
}

export function parseEchoesData(metadata: Record<string, any>): EchoesData {
  return {
    subtitle: metadata?.subtitle || '',
    category: metadata?.category || 'character',
    spoilerLevel: metadata?.spoilerLevel ?? 0,
    gate: metadata?.gate || '',
    audioFile: metadata?.audioFile || null,
    audioMeta: metadata?.audioMeta || null,
    appreciation: metadata?.appreciation || [''],
    appreciationLocked: metadata?.appreciationLocked || '',
  };
}

export function serializeEchoesData(data: EchoesData): Record<string, any> {
  return {
    subtitle: data.subtitle || undefined,
    category: data.category,
    spoilerLevel: data.spoilerLevel,
    gate: data.gate || undefined,
    audioFile: data.audioFile || undefined,
    audioMeta: data.audioMeta || undefined,
    appreciation: data.appreciation.filter((p) => p.trim()),
    appreciationLocked: data.appreciationLocked || undefined,
  };
}

const SPOILER_LEVELS = [
  { l: 0, n: '無' },
  { l: 1, n: '霧化' },
  { l: 2, n: '遮罩' },
  { l: 3, n: '雜訊' },
];

const CATEGORIES = [
  { value: 'area', label: '場景主題曲' },
  { value: 'character', label: '角色主題曲' },
  { value: 'story', label: '劇情歌' },
  { value: 'special', label: '特殊曲目' },
];

export default function EchoesEditorBody({
  accent,
  initialData,
  onDataChange,
  onDirty,
}: EchoesEditorBodyProps) {
  const [data, setData] = useState<EchoesData>(initialData);

  const update = (patch: Partial<EchoesData>) => {
    const next = { ...data, ...patch };
    setData(next);
    onDataChange(next);
    onDirty();
  };

  const updateAppreciation = (index: number, value: string) => {
    const next = [...data.appreciation];
    next[index] = value;
    update({ appreciation: next });
  };

  const addAppreciation = () => {
    update({ appreciation: [...data.appreciation, ''] });
  };

  const removeAppreciation = (index: number) => {
    update({ appreciation: data.appreciation.filter((_, i) => i !== index) });
  };

  return (
    <div className="ned-echoes-body">
      {/* 副標題 */}
      <label className="ned-field-label">副標題</label>
      <input
        className="ned-field"
        type="text"
        value={data.subtitle}
        placeholder="副標題"
        onChange={(e) => update({ subtitle: e.target.value })}
      />

      {/* 分類 + 遮蔽等級 */}
      <div className="ned-echoes-row">
        <div>
          <label className="ned-field-label">分類</label>
          <select
            className="ned-field"
            value={data.category}
            onChange={(e) => update({ category: e.target.value })}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ned-field-label">
            遮蔽等級 (Spoiler Level)
          </label>
          <div className="ned-spoiler-buttons">
            {SPOILER_LEVELS.map((o) => (
              <button
                key={o.l}
                className={`ned-spoiler-btn ${data.spoilerLevel === o.l ? 'is-active' : ''}`}
                style={{
                  borderColor:
                    data.spoilerLevel === o.l
                      ? accent
                      : 'var(--hairline-strong)',
                  background:
                    data.spoilerLevel === o.l ? `${accent}12` : 'transparent',
                  color: data.spoilerLevel === o.l ? accent : 'var(--ink-soft)',
                }}
                onClick={() => update({ spoilerLevel: o.l })}
                type="button"
              >
                L{o.l}
                <span className="ned-spoiler-btn-label">{o.n}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 解鎖條件 */}
      <label className="ned-field-label">
        解鎖條件 (劇情前置)
      </label>
      <input
        className="ned-field"
        type="text"
        value={data.gate}
        placeholder="哪段劇情解鎖這首歌"
        onChange={(e) => update({ gate: e.target.value })}
      />

      {/* 音檔 */}
      <label className="ned-field-label">音檔</label>
      <div className="ned-audio-zone">
        {data.audioFile ? (
          <>
            <div
              className="ned-audio-icon"
              style={{ borderColor: accent, color: accent }}
            >
              {data.audioMeta?.size
                ? `${Math.round((data.audioMeta.size || 0) / 1024 / 1024)}MB`
                : '?'}
            </div>
            <div className="ned-audio-info">
              <div className="ned-audio-name">{data.audioFile}</div>
              <div className="ned-audio-meta">
                {data.audioMeta?.info || 'uploaded'}
              </div>
            </div>
            <button
              className="ned-btn-ghost"
              type="button"
              onClick={() => update({ audioFile: null, audioMeta: null })}
            >
              刪除
            </button>
          </>
        ) : (
          <div className="ned-audio-empty">
            尚未上傳音檔
          </div>
        )}
      </div>

      {/* 賞析（可多段）*/}
      <div className="ned-appreciation-header">
        <label className="ned-field-label" style={{ margin: 0 }}>
          賞析（可多段）
        </label>
        <button
          className="ned-btn-ghost ned-btn-sm"
          type="button"
          onClick={addAppreciation}
        >
          + 新增段落
        </button>
      </div>
      <div className="ned-appreciation-list">
        {data.appreciation.map((p, i) => (
          <div key={i} className="ned-appreciation-row">
            <span className="ned-appreciation-num">{i + 1}</span>
            <textarea
              className="ned-field ned-field--textarea ned-appreciation-text"
              value={p}
              onChange={(e) => updateAppreciation(i, e.target.value)}
            />
            <button
              className="ned-appreciation-remove"
              type="button"
              onClick={() => removeAppreciation(i)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* 賞析（鎖定時顯示）*/}
      <label className="ned-field-label">
        賞析（鎖定時顯示）
      </label>
      <textarea
        className="ned-field ned-field--textarea ned-field--italic"
        value={data.appreciationLocked}
        placeholder="鎖定時顯示的替代文字"
        onChange={(e) => update({ appreciationLocked: e.target.value })}
      />
    </div>
  );
}
