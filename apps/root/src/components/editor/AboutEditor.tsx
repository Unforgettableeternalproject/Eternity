import React, { useState, useCallback } from 'react';
import { TipTapEditor } from './RootEditor';
import ImagePickerDialog from './ImagePickerDialog';
import ConfirmDialog, {
  type ConfirmDialogState,
  DIALOG_CLOSED,
} from './ConfirmDialog';
import {
  Mono,
  Divider,
  Field,
  Input,
  Toggle,
  TagEditor,
  OutlineRow,
} from './editorPrimitives';

// ─── 型別定義 ────────────────────────────────────────────────────────
interface Skill {
  id: string;
  name: string;
  en: string;
  brief: string;
  description: string;
  selfAssessment: string;
}

interface Experience {
  title: string;
  company: string;
  period: string;
  location: string;
  description: string;
  stack: string[];
  current: boolean;
}

export interface AboutEditorProps {
  dataZh: any;
  dataEn: any;
  currently: any;
  setDataZh: (d: any) => void;
  setDataEn: (d: any) => void;
  setCurrently: (d: any) => void;
  api: (path: string, method: string, body?: any) => Promise<any>;
  apiBase: string;
  token: string;
}

// ─── 區塊列表定義 ────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'fullBio', num: '01', label: 'Full Bio' },
  { id: 'skills', num: '02', label: 'Skills' },
  { id: 'experience', num: '03', label: 'Experience' },
  { id: 'social', num: '04', label: 'Social & CTA' },
  { id: 'currently', num: '05', label: 'Currently' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

// ─── 排序輔助按鈕 ────────────────────────────────────────────────────
function SortButtons({
  idx,
  total,
  onMove,
}: {
  idx: number;
  total: number;
  onMove: (from: number, to: number) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <button
        className="qe-topbar__btn"
        style={{ padding: '3px 8px', opacity: idx === 0 ? 0.3 : 1 }}
        disabled={idx === 0}
        onClick={() => onMove(idx, idx - 1)}
        title="上移"
      >
        <Mono>↑</Mono>
      </button>
      <button
        className="qe-topbar__btn"
        style={{ padding: '3px 8px', opacity: idx === total - 1 ? 0.3 : 1 }}
        disabled={idx === total - 1}
        onClick={() => onMove(idx, idx + 1)}
        title="下移"
      >
        <Mono>↓</Mono>
      </button>
    </div>
  );
}

// ─── 圖片 URL 輔助（編輯器內預覽用） ────────────────────────────────
function editorAssetUrl(apiBase: string, key: string): string {
  if (!key) return '';
  if (key.startsWith('http')) return key;
  let k = key;
  if (k.startsWith('/api/root/assets/'))
    k = k.slice('/api/root/assets/'.length);
  else if (k.startsWith('/')) k = k.slice(1);
  try {
    k = decodeURIComponent(k);
  } catch {
    /* already decoded */
  }
  const encoded = k
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  return `${apiBase}/api/root/assets/${encoded}`;
}

// ─── Full Bio 區塊編輯器（重用 RootEditor 的 TipTapEditor）──────────
function FullBioSection({
  data,
  onChange,
  apiBase,
  token,
}: {
  data: any;
  onChange: (patch: any) => void;
  apiBase: string;
  token: string;
}) {
  const bio: string = data?.fullBio || '';
  const bioPhoto: string = data?.bioPhoto || '';
  const bioPhotoCaption: string = data?.bioPhotoCaption || '';
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div>
      <div className="qe-section-label">—— full bio</div>
      <div className="qe-rule" />

      <Field label="fullBio（富文字編輯）" hint={`${bio.length} 字元`}>
        <TipTapEditor
          content={bio}
          onUpdate={(html) => onChange({ fullBio: html })}
          placeholder="開始撰寫自傳…"
          apiBase={apiBase}
          token={token}
        />
      </Field>

      <Divider label="個人照片" />

      {/* 照片預覽與操作 */}
      <Field label="bioPhoto（照片）" hint="顯示在自傳右側">
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {/* 預覽框 */}
          <div
            style={{
              width: 140,
              aspectRatio: '3/4',
              border: '1px solid var(--qe-line)',
              background: 'var(--qe-paper-card)',
              overflow: 'hidden',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {bioPhoto ? (
              <img
                src={editorAssetUrl(apiBase, bioPhoto)}
                alt="個人照片預覽"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
            ) : (
              <Mono
                v="fade"
                style={{ fontSize: 10, textAlign: 'center', padding: 8 }}
              >
                尚未設定
              </Mono>
            )}
          </div>

          {/* 按鈕 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              className="qe-topbar__btn"
              style={{ padding: '6px 12px' }}
              onClick={() => setShowPicker(true)}
            >
              <Mono>{bioPhoto ? '更換照片' : '選擇照片'}</Mono>
            </button>
            {bioPhoto && (
              <button
                className="qe-topbar__btn"
                style={{ padding: '6px 12px' }}
                onClick={() => onChange({ bioPhoto: '', bioPhotoCaption: '' })}
              >
                <Mono style={{ color: 'var(--qe-coral)' }}>移除照片</Mono>
              </button>
            )}
            {bioPhoto && (
              <div style={{ marginTop: 4 }}>
                <Mono v="fade" style={{ fontSize: 9, wordBreak: 'break-all' }}>
                  {bioPhoto}
                </Mono>
              </div>
            )}
          </div>
        </div>
      </Field>

      {/* 照片標題文字 */}
      {bioPhoto && (
        <Field
          label="bioPhotoCaption（照片標題）"
          hint="留空使用預設「↑ 這是我」"
        >
          <Input
            value={bioPhotoCaption}
            onChange={(v) => onChange({ bioPhotoCaption: v })}
            placeholder="↑ 這是我"
          />
        </Field>
      )}

      {/* 圖片選擇對話框 */}
      {showPicker && (
        <ImagePickerDialog
          apiBase={apiBase}
          token={token}
          onInsert={(key) => {
            onChange({ bioPhoto: key });
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

// ─── Skills 區塊編輯器 ───────────────────────────────────────────────
function SkillsSection({
  data,
  onChange,
}: {
  data: any;
  onChange: (patch: any) => void;
}) {
  const skills: Skill[] = data?.skills || [];
  // 追蹤哪個項目展開
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [dialog, setDialog] = useState<ConfirmDialogState>(DIALOG_CLOSED);

  const updateSkill = (idx: number, patch: Partial<Skill>) => {
    const next = skills.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange({ skills: next });
  };

  const removeSkill = (idx: number) => {
    onChange({ skills: skills.filter((_, i) => i !== idx) });
    if (expandedIdx === idx) setExpandedIdx(null);
  };

  const moveSkill = (from: number, to: number) => {
    const next = [...skills];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange({ skills: next });
  };

  const addSkill = () => {
    const newSkill: Skill = {
      id: String(skills.length + 1).padStart(2, '0'),
      name: '新技能',
      en: 'New Skill',
      brief: '',
      description: '',
      selfAssessment: '',
    };
    onChange({ skills: [...skills, newSkill] });
    setExpandedIdx(skills.length);
  };

  return (
    <div>
      <div className="qe-section-label">—— skills · {skills.length} 項</div>
      <div className="qe-rule" />

      {skills.map((skill, idx) => (
        <div
          key={idx}
          style={{
            border: '1px solid var(--qe-line)',
            marginBottom: 8,
            background: 'var(--qe-paper-card)',
          }}
        >
          {/* 卡片標題列 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              cursor: 'pointer',
              borderBottom:
                expandedIdx === idx ? '1px solid var(--qe-line)' : 'none',
            }}
            onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
          >
            <Mono v="navy">{skill.id || String(idx + 1).padStart(2, '0')}</Mono>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
              {skill.name || '（未命名）'}
            </span>
            <Mono v="fade">{skill.en}</Mono>
            <SortButtons idx={idx} total={skills.length} onMove={moveSkill} />
            <button
              className="qe-topbar__btn"
              style={{ padding: '3px 8px' }}
              onClick={(e) => {
                e.stopPropagation();
                setDialog({
                  open: true,
                  title: `刪除技能「${skill.name}」？`,
                  confirmLabel: '刪除',
                  danger: true,
                  onConfirm: () => removeSkill(idx),
                });
              }}
            >
              <Mono style={{ color: 'var(--qe-coral)' }}>✕</Mono>
            </button>
            <Mono v="fade">{expandedIdx === idx ? '▲' : '▼'}</Mono>
          </div>

          {/* 展開內容 */}
          {expandedIdx === idx && (
            <div
              style={{
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <Field label="id">
                  <Input
                    value={skill.id}
                    onChange={(v) => updateSkill(idx, { id: v })}
                    mono
                    placeholder="01"
                  />
                </Field>
                <Field label="name（中文）">
                  <Input
                    value={skill.name}
                    onChange={(v) => updateSkill(idx, { name: v })}
                    placeholder="技能名稱"
                  />
                </Field>
                <Field label="en（英文）">
                  <Input
                    value={skill.en}
                    onChange={(v) => updateSkill(idx, { en: v })}
                    placeholder="Skill Name"
                  />
                </Field>
              </div>
              <Field label="brief（一句話簡介）">
                <Input
                  value={skill.brief}
                  onChange={(v) => updateSkill(idx, { brief: v })}
                  placeholder="一句話簡介"
                />
              </Field>
              <Field label="description（完整描述）">
                <textarea
                  className="qe-desc-textarea"
                  value={skill.description}
                  rows={3}
                  placeholder="完整描述"
                  onChange={(e) =>
                    updateSkill(idx, { description: e.target.value })
                  }
                />
              </Field>
              <Field label="selfAssessment（自我評估）">
                <textarea
                  className="qe-desc-textarea"
                  value={skill.selfAssessment}
                  rows={3}
                  placeholder="自我評估文字"
                  onChange={(e) =>
                    updateSkill(idx, { selfAssessment: e.target.value })
                  }
                />
              </Field>
            </div>
          )}
        </div>
      ))}

      {/* 新增按鈕 */}
      <button
        className="qe-left__add"
        style={{
          display: 'block',
          width: '100%',
          marginTop: 8,
          cursor: 'pointer',
          textAlign: 'center',
        }}
        onClick={addSkill}
      >
        ＋ new skill
      </button>
      <ConfirmDialog state={dialog} onClose={() => setDialog(DIALOG_CLOSED)} />
    </div>
  );
}

// ─── Experience 區塊編輯器 ───────────────────────────────────────────
function ExperienceSection({
  data,
  onChange,
}: {
  data: any;
  onChange: (patch: any) => void;
}) {
  const experience: Experience[] = data?.experience || [];
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [dialog, setDialog] = useState<ConfirmDialogState>(DIALOG_CLOSED);

  const updateExp = (idx: number, patch: Partial<Experience>) => {
    const next = experience.map((e, i) => (i === idx ? { ...e, ...patch } : e));
    onChange({ experience: next });
  };

  const removeExp = (idx: number) => {
    onChange({ experience: experience.filter((_, i) => i !== idx) });
    if (expandedIdx === idx) setExpandedIdx(null);
  };

  const moveExp = (from: number, to: number) => {
    const next = [...experience];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange({ experience: next });
  };

  const addExp = () => {
    const newExp: Experience = {
      title: '新職位',
      company: '',
      period: '',
      location: '',
      description: '',
      stack: [],
      current: false,
    };
    onChange({ experience: [...experience, newExp] });
    setExpandedIdx(experience.length);
  };

  return (
    <div>
      <div className="qe-section-label">
        —— experience · {experience.length} 項
      </div>
      <div className="qe-rule" />

      {experience.map((exp, idx) => (
        <div
          key={idx}
          style={{
            border: '1px solid var(--qe-line)',
            marginBottom: 8,
            background: 'var(--qe-paper-card)',
          }}
        >
          {/* 卡片標題列 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              cursor: 'pointer',
              borderBottom:
                expandedIdx === idx ? '1px solid var(--qe-line)' : 'none',
            }}
            onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
          >
            <Mono v={exp.current ? 'navy' : 'fade'}>
              {exp.current ? '● ' : '○ '}
              {String(idx + 1).padStart(2, '0')}
            </Mono>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {exp.title || '（未命名）'}
              </div>
              {exp.company && (
                <div style={{ fontSize: 11, color: 'var(--qe-ink-mute)' }}>
                  {exp.company}
                  {exp.period ? ` · ${exp.period}` : ''}
                </div>
              )}
            </div>
            <SortButtons idx={idx} total={experience.length} onMove={moveExp} />
            <button
              className="qe-topbar__btn"
              style={{ padding: '3px 8px' }}
              onClick={(e) => {
                e.stopPropagation();
                setDialog({
                  open: true,
                  title: `刪除職位「${exp.title}」？`,
                  confirmLabel: '刪除',
                  danger: true,
                  onConfirm: () => removeExp(idx),
                });
              }}
            >
              <Mono style={{ color: 'var(--qe-coral)' }}>✕</Mono>
            </button>
            <Mono v="fade">{expandedIdx === idx ? '▲' : '▼'}</Mono>
          </div>

          {/* 展開內容 */}
          {expandedIdx === idx && (
            <div
              style={{
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <Field label="title（職稱）">
                  <Input
                    value={exp.title}
                    onChange={(v) => updateExp(idx, { title: v })}
                    placeholder="職稱"
                  />
                </Field>
                <Field label="company（公司）">
                  <Input
                    value={exp.company}
                    onChange={(v) => updateExp(idx, { company: v })}
                    placeholder="公司名稱"
                  />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Field label="period（期間）">
                  <Input
                    value={exp.period}
                    onChange={(v) => updateExp(idx, { period: v })}
                    placeholder="2023 — present"
                    mono
                  />
                </Field>
                <Field label="location（地點）">
                  <Input
                    value={exp.location}
                    onChange={(v) => updateExp(idx, { location: v })}
                    placeholder="台北, 台灣"
                  />
                </Field>
              </div>
              <Field label="description（描述）">
                <textarea
                  className="qe-desc-textarea"
                  value={exp.description}
                  rows={3}
                  placeholder="工作內容描述"
                  onChange={(e) =>
                    updateExp(idx, { description: e.target.value })
                  }
                />
              </Field>
              <Field label="stack（技術標籤）">
                <TagEditor
                  tags={exp.stack}
                  onChange={(t) => updateExp(idx, { stack: t })}
                />
              </Field>
              <Toggle
                label="current（目前在職）"
                checked={exp.current}
                onChange={(v) => updateExp(idx, { current: v })}
              />
            </div>
          )}
        </div>
      ))}

      {/* 新增按鈕 */}
      <button
        className="qe-left__add"
        style={{
          display: 'block',
          width: '100%',
          marginTop: 8,
          cursor: 'pointer',
          textAlign: 'center',
        }}
        onClick={addExp}
      >
        ＋ new experience
      </button>
      <ConfirmDialog state={dialog} onClose={() => setDialog(DIALOG_CLOSED)} />
    </div>
  );
}

// ─── Social & CTA 區塊編輯器 ─────────────────────────────────────────
function SocialSection({
  data,
  onChange,
}: {
  data: any;
  onChange: (patch: any) => void;
}) {
  const social = data?.social || {};
  const cta = data?.cta || {};

  return (
    <div>
      <div className="qe-section-label">—— social & cta</div>
      <div className="qe-rule" />

      <Divider label="social links" />
      <Field label="social.github">
        <Input
          value={social.github || ''}
          onChange={(v) => onChange({ social: { ...social, github: v } })}
          mono
          placeholder="https://github.com/..."
        />
      </Field>
      <Field label="social.email">
        <Input
          value={social.email || ''}
          onChange={(v) => onChange({ social: { ...social, email: v } })}
          mono
          placeholder="you@example.com"
        />
      </Field>

      <Divider label="call to action" />
      <Field label="cta.heading">
        <Input
          value={cta.heading || ''}
          onChange={(v) => onChange({ cta: { ...cta, heading: v } })}
          placeholder="聯絡標題"
        />
      </Field>
      <Field label="cta.text">
        <textarea
          className="qe-desc-textarea"
          value={cta.text || ''}
          rows={3}
          placeholder="Call-to-action 文字"
          onChange={(e) => onChange({ cta: { ...cta, text: e.target.value } })}
        />
      </Field>
    </div>
  );
}

// ─── Currently 區塊編輯器 ────────────────────────────────────────────
function CurrentlySection({
  data,
  onChange,
}: {
  data: any;
  onChange: (patch: any) => void;
}) {
  const FIELDS: { key: string; label: string; placeholder: string }[] = [
    {
      key: 'working',
      label: 'working（目前在做什麼）',
      placeholder: '目前在做的事',
    },
    {
      key: 'learning',
      label: 'learning（正在學什麼）',
      placeholder: '正在學的東西',
    },
    {
      key: 'listening',
      label: 'listening（正在聽什麼）',
      placeholder: '正在聽的音樂 / Podcast',
    },
    {
      key: 'playing',
      label: 'playing（正在玩什麼）',
      placeholder: '正在玩的遊戲',
    },
    {
      key: 'reading',
      label: 'reading（正在看什麼）',
      placeholder: '正在看的書 / 文章',
    },
    { key: 'status', label: 'status（狀態）', placeholder: '目前狀態' },
  ];

  return (
    <div>
      <div className="qe-section-label">
        —— currently（獨立 singleton，不分語言）
      </div>
      <div className="qe-rule" />
      {FIELDS.map(({ key, label, placeholder }) => (
        <Field key={key} label={label}>
          <Input
            value={(data || {})[key] || ''}
            onChange={(v) => onChange({ [key]: v })}
            placeholder={placeholder}
          />
        </Field>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  主元件
// ═══════════════════════════════════════════════════════════════════
export default function AboutEditor({
  dataZh,
  dataEn,
  currently,
  setDataZh,
  setDataEn,
  setCurrently,
  api,
  apiBase,
  token,
}: AboutEditorProps) {
  // 語言切換
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  // 目前選擇的區塊
  const [activeSection, setActiveSection] = useState<SectionId>('fullBio');
  // 各語言及 currently 的 dirty 狀態
  const [dirtyZh, setDirtyZh] = useState(false);
  const [dirtyEn, setDirtyEn] = useState(false);
  const [dirtyCurrently, setDirtyCurrently] = useState(false);

  // 取得目前語言的資料及其 setter
  const currentData = lang === 'zh' ? dataZh : dataEn;
  const isDirty = lang === 'zh' ? dirtyZh : dirtyEn;

  // 更新語言相關欄位
  const updateField = useCallback(
    (patch: any) => {
      if (lang === 'zh') {
        setDataZh({ ...(dataZh || {}), ...patch });
        setDirtyZh(true);
      } else {
        setDataEn({ ...(dataEn || {}), ...patch });
        setDirtyEn(true);
      }
    },
    [lang, dataZh, dataEn, setDataZh, setDataEn]
  );

  // 更新 currently 欄位
  const updateCurrently = useCallback(
    (patch: any) => {
      setCurrently({ ...(currently || {}), ...patch });
      setDirtyCurrently(true);
    },
    [currently, setCurrently]
  );

  // 儲存主 About（依語言）
  const saveAbout = useCallback(async () => {
    const singletonKey = lang === 'zh' ? 'about-zh' : 'about-en';
    const res = await api(`/api/root/singletons/${singletonKey}`, 'PUT', {
      content: currentData,
    });
    if (res.ok) {
      if (lang === 'zh') setDirtyZh(false);
      else setDirtyEn(false);
    }
  }, [lang, currentData, api]);

  // 儲存 currently
  const saveCurrently = useCallback(async () => {
    const res = await api('/api/root/singletons/currently', 'PUT', {
      content: currently,
    });
    if (res.ok) setDirtyCurrently(false);
  }, [currently, api]);

  // 計算目前語言的欄位數（頂層 key 數）
  const fieldCount = Object.keys(currentData || {}).length;
  const currentlyFieldCount = Object.keys(currently || {}).length;

  return (
    <>
      {/* ─── 左側面板 — 區塊導航 ─── */}
      <aside className="qe-left">
        <div className="qe-left__header">
          <div>
            <Mono v="navy">—— about</Mono>
            <div style={{ marginTop: 4 }}>
              <Mono>singleton · {lang === 'zh' ? 'about-zh' : 'about-en'}</Mono>
            </div>
          </div>
        </div>

        {/* 區塊列表 */}
        <div className="qe-left__body">
          {SECTIONS.map((s) => (
            <OutlineRow
              key={s.id}
              active={activeSection === s.id}
              num={s.num}
              label={s.label}
              sub={
                s.id === 'currently'
                  ? 'singleton · currently'
                  : s.id === 'skills'
                    ? `${(currentData?.skills || []).length} 項`
                    : s.id === 'experience'
                      ? `${(currentData?.experience || []).length} 項`
                      : undefined
              }
              onClick={() => setActiveSection(s.id)}
            />
          ))}
        </div>
      </aside>

      {/* ─── 中央編輯區 ─── */}
      <main className="qe-center">
        <div className="qe-editor-surface" style={{ maxWidth: 800 }}>
          {/* 顯示目前編輯的語言標記（Currently 不分語言） */}
          {activeSection !== 'currently' && (
            <div style={{ marginBottom: 16 }}>
              <div
                className="qe-lang-toggle"
                style={{ display: 'inline-flex' }}
              >
                <button
                  className={`qe-lang-toggle__btn${lang === 'zh' ? ' qe-lang-toggle__btn--active' : ''}`}
                  onClick={() => setLang('zh')}
                >
                  繁中
                </button>
                <button
                  className={`qe-lang-toggle__btn${lang === 'en' ? ' qe-lang-toggle__btn--active' : ''}`}
                  onClick={() => setLang('en')}
                >
                  EN
                </button>
              </div>
            </div>
          )}

          {/* 各區塊的專屬編輯器（Hero 已移至 00 頁面文字） */}
          {activeSection === 'fullBio' && (
            <FullBioSection
              data={currentData}
              onChange={updateField}
              apiBase={apiBase}
              token={token}
            />
          )}
          {activeSection === 'skills' && (
            <SkillsSection data={currentData} onChange={updateField} />
          )}
          {activeSection === 'experience' && (
            <ExperienceSection data={currentData} onChange={updateField} />
          )}
          {activeSection === 'social' && (
            <SocialSection data={currentData} onChange={updateField} />
          )}
          {activeSection === 'currently' && (
            <CurrentlySection data={currently} onChange={updateCurrently} />
          )}
        </div>
      </main>

      {/* ─── 右側 Inspector ─── */}
      <aside className="qe-right">
        <div className="qe-right__header">
          <Mono v="navy">—— inspector</Mono>
        </div>
        <div className="qe-right__body">
          {/* D1 資訊 */}
          <Divider label="source" />
          <Field label="D1 table">
            <input
              className="qe-input qe-input--mono"
              value="root_singletons"
              readOnly
              disabled
            />
          </Field>
          <Field label="singleton key">
            <input
              className="qe-input qe-input--mono"
              value={
                activeSection === 'currently'
                  ? 'currently'
                  : lang === 'zh'
                    ? 'about-zh'
                    : 'about-en'
              }
              readOnly
              disabled
            />
          </Field>
          <Field label="fields">
            <input
              className="qe-input qe-input--mono"
              value={String(
                activeSection === 'currently' ? currentlyFieldCount : fieldCount
              )}
              readOnly
              disabled
            />
          </Field>

          <Divider label="current section" />
          <Field label="section">
            <input
              className="qe-input"
              value={SECTIONS.find((s) => s.id === activeSection)?.label || '—'}
              readOnly
              disabled
            />
          </Field>

          <Divider label="actions" />

          {/* About Save 按鈕（非 currently 時顯示） */}
          {activeSection !== 'currently' && (
            <button
              className="qe-topbar__btn qe-topbar__btn--primary"
              style={{ width: '100%', marginBottom: 8 }}
              onClick={saveAbout}
              disabled={!isDirty}
            >
              <Mono style={{ color: 'inherit' }}>
                {isDirty ? `● save about-${lang}` : `synced · about-${lang}`}
              </Mono>
            </button>
          )}

          {/* Currently Save 按鈕（currently 區塊時顯示，或永遠在底部顯示） */}
          {activeSection === 'currently' ? (
            <button
              className="qe-topbar__btn qe-topbar__btn--primary"
              style={{ width: '100%' }}
              onClick={saveCurrently}
              disabled={!dirtyCurrently}
            >
              <Mono style={{ color: 'inherit' }}>
                {dirtyCurrently ? '● save currently' : 'synced · currently'}
              </Mono>
            </button>
          ) : (
            <>
              <Divider label="currently" />
              <button
                className={`qe-topbar__btn${dirtyCurrently ? ' qe-topbar__btn--primary' : ''}`}
                style={{ width: '100%' }}
                onClick={saveCurrently}
                disabled={!dirtyCurrently}
              >
                <Mono style={{ color: 'inherit' }}>
                  {dirtyCurrently ? '● save currently' : 'synced · currently'}
                </Mono>
              </button>
            </>
          )}

          {/* 語言 dirty 狀態摘要 */}
          {(dirtyZh || dirtyEn || dirtyCurrently) && (
            <>
              <Divider label="unsaved" />
              {dirtyZh && (
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--qe-coral)',
                    fontFamily: 'var(--qe-mono)',
                    marginBottom: 4,
                  }}
                >
                  ● about-zh
                </div>
              )}
              {dirtyEn && (
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--qe-coral)',
                    fontFamily: 'var(--qe-mono)',
                    marginBottom: 4,
                  }}
                >
                  ● about-en
                </div>
              )}
              {dirtyCurrently && (
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--qe-coral)',
                    fontFamily: 'var(--qe-mono)',
                    marginBottom: 4,
                  }}
                >
                  ● currently
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
