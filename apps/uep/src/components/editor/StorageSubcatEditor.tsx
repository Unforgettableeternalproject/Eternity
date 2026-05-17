import React from 'react';
import IconPicker from './IconLibrary';
import './StorageSubcatEditor.css';

export interface SubcatDef {
  id: string;
  label: string;
  icon: string;
  description: string;
  hidden: boolean;
}

interface Props {
  subcategories: SubcatDef[];
  onChange: (subcategories: SubcatDef[]) => void;
  accent: string;
}

export default function StorageSubcatEditor({ subcategories, onChange, accent }: Props) {
  function addSubcat() {
    onChange([
      ...subcategories,
      { id: `sc-${Date.now().toString(36)}`, label: '新分類', icon: '', description: '', hidden: false },
    ]);
  }

  function update(id: string, patch: Partial<SubcatDef>) {
    onChange(subcategories.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function remove(id: string) {
    onChange(subcategories.filter((s) => s.id !== id));
  }

  function move(idx: number, dir: -1 | 1) {
    const next = [...subcategories];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  return (
    <div className="sto-sce" style={{ '--sce-accent': accent } as React.CSSProperties}>
      <div className="sto-sce-header">
        <span className="sto-sce-title">分類管理</span>
        <span className="sto-sce-count">{subcategories.length} 項</span>
        <button className="sto-sce-add" onClick={addSubcat}>+ 新增</button>
      </div>
      {subcategories.length === 0 && (
        <div className="sto-sce-empty">尚未建立任何分類。分類會顯示在前台的條目列表中作為分群標題。</div>
      )}
      {subcategories.map((s, i) => (
        <div key={s.id} className={`sto-sce-row ${s.hidden ? 'is-hidden' : ''}`}>
          <div className="sto-sce-row-main">
            <div className="sto-sce-icon-picker">
              <IconPicker
                value={s.icon}
                onChange={(iconId) => update(s.id, { icon: iconId })}
                accent={accent}
              />
            </div>
            <input
              className="sto-sce-label-input"
              value={s.label}
              onChange={(e) => update(s.id, { label: e.target.value })}
              placeholder="分類名稱"
            />
            <label className="sto-sce-hidden-label">
              <input
                type="checkbox"
                checked={s.hidden}
                onChange={(e) => update(s.id, { hidden: e.target.checked })}
              />
              隱藏
            </label>
            <div className="sto-sce-row-actions">
              <button onClick={() => move(i, -1)} disabled={i === 0} title="上移">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === subcategories.length - 1} title="下移">↓</button>
              <button className="sto-sce-remove-btn" onClick={() => remove(s.id)} title="刪除">×</button>
            </div>
          </div>
          <input
            className="sto-sce-desc-input"
            value={s.description}
            onChange={(e) => update(s.id, { description: e.target.value })}
            placeholder="說明（選填，前台會顯示在分類標題下方）"
          />
          <div className="sto-sce-id-hint">id: {s.id}</div>
        </div>
      ))}
    </div>
  );
}
