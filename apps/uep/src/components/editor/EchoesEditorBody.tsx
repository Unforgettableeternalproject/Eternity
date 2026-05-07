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
  { l: 0, n: '\u7121' },
  { l: 1, n: '\u9727\u5316' },
  { l: 2, n: '\u906E\u7F69' },
  { l: 3, n: '\u96DC\u8A0A' },
];

const CATEGORIES = [
  { value: 'area', label: '\u5834\u666F\u4E3B\u984C\u66F2' },
  { value: 'character', label: '\u89D2\u8272\u4E3B\u984C\u66F2' },
  { value: 'story', label: '\u5287\u60C5\u6B4C' },
  { value: 'special', label: '\u7279\u6B8A\u66F2\u76EE' },
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
      {/* Subtitle */}
      <label className="ned-field-label">\u526F\u6A19\u984C</label>
      <input
        className="ned-field"
        type="text"
        value={data.subtitle}
        placeholder="\u526F\u6A19\u984C"
        onChange={(e) => update({ subtitle: e.target.value })}
      />

      {/* Category + Spoiler Level */}
      <div className="ned-echoes-row">
        <div>
          <label className="ned-field-label">\u5206\u985E</label>
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
            \u906E\u853D\u7B49\u7D1A (Spoiler Level)
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
                  color:
                    data.spoilerLevel === o.l ? accent : 'var(--ink-soft)',
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

      {/* Gate */}
      <label className="ned-field-label">
        \u89E3\u9396\u689D\u4EF6 (\u5287\u60C5\u524D\u7F6E)
      </label>
      <input
        className="ned-field"
        type="text"
        value={data.gate}
        placeholder="\u54EA\u6BB5\u5287\u60C5\u89E3\u9396\u9019\u9996\u6B4C"
        onChange={(e) => update({ gate: e.target.value })}
      />

      {/* Audio file */}
      <label className="ned-field-label">\u97F3\u6A94</label>
      <div className="ned-audio-zone">
        {data.audioFile ? (
          <>
            <div className="ned-audio-icon" style={{ borderColor: accent, color: accent }}>
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
              \u522A\u9664
            </button>
          </>
        ) : (
          <div className="ned-audio-empty">
            \u5C1A\u672A\u4E0A\u50B3\u97F3\u6A94
          </div>
        )}
      </div>

      {/* Appreciation paragraphs */}
      <div className="ned-appreciation-header">
        <label className="ned-field-label" style={{ margin: 0 }}>
          \u8CDE\u6790\uFF08\u53EF\u591A\u6BB5\uFF09
        </label>
        <button
          className="ned-btn-ghost ned-btn-sm"
          type="button"
          onClick={addAppreciation}
        >
          + \u65B0\u589E\u6BB5\u843D
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
              \u00d7
            </button>
          </div>
        ))}
      </div>

      {/* Locked appreciation */}
      <label className="ned-field-label">
        \u8CDE\u6790\uFF08\u9396\u5B9A\u6642\u986F\u793A\uFF09
      </label>
      <textarea
        className="ned-field ned-field--textarea ned-field--italic"
        value={data.appreciationLocked}
        placeholder="\u9396\u5B9A\u6642\u986F\u793A\u7684\u66FF\u4EE3\u6587\u5B57"
        onChange={(e) => update({ appreciationLocked: e.target.value })}
      />
    </div>
  );
}
