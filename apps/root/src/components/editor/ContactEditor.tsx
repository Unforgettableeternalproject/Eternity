import React, { useState, useCallback } from 'react';
import { Mono, Divider, Field, Input, OutlineRow } from './editorPrimitives';
import ConfirmDialog, {
  type ConfirmDialogState,
  DIALOG_CLOSED,
} from './ConfirmDialog';

// ─── 型別定義（匯出供 RootEditor 共用） ─────────────────────────────
export interface DirectLink {
  key: string; // 顯示標籤，如 "EMAIL"
  value: string; // 顯示值，如 "ptyc4076@gmail.com"
  url: string; // 連結 URL
}

export interface FAQ {
  q: string; // 問題
  a: string; // 答案
}

export interface DevCta {
  heading: string; // 如 "遇到 bug 或想提建議？"
  text: string; // 補充說明
}

// contact singleton 的資料結構
export interface ContactData {
  heroTitle?: string;
  heroIntro?: string;
  subjects?: string[];
  directLinks?: DirectLink[];
  expectation?: string;
  faqs?: FAQ[];
  devCta?: DevCta;
  [key: string]: any;
}

export interface ContactEditorProps {
  dataZh: ContactData | null;
  dataEn: ContactData | null;
  setDataZh: (d: ContactData | null) => void;
  setDataEn: (d: ContactData | null) => void;
  api: (path: string, method: string, body?: any) => Promise<any>;
}

// ─── 左側區塊導航項目定義 ───────────────────────────────────────────
const SECTIONS = [
  { id: 'subjects', num: '01', label: 'Subjects', sub: 'subjects[]' },
  { id: 'directLinks', num: '02', label: 'Direct Links', sub: 'directLinks[]' },
  { id: 'expectation', num: '03', label: 'Expectation', sub: 'expectation' },
  { id: 'faqs', num: '04', label: 'FAQs', sub: 'faqs[]' },
  {
    id: 'devCta',
    num: '05',
    label: 'Dev CTA',
    sub: 'devCta.heading, devCta.text',
  },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

// ─── 陣列項目卡片：帶展開/收合、上下排序、刪除 ──────────────────────
function ArrayCard({
  index,
  total,
  summary,
  children,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  index: number;
  total: number;
  summary: string;
  children: React.ReactNode;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        border: '1px solid var(--qe-line)',
        marginBottom: 8,
        background: open ? 'var(--qe-paper-card)' : 'transparent',
      }}
    >
      {/* 卡片標頭：點擊展開/收合 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <Mono v="fade">{String(index + 1).padStart(2, '0')}</Mono>
        <span
          style={{
            flex: 1,
            fontSize: 12.5,
            color: 'var(--qe-ink-soft)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {summary || '—'}
        </span>
        {/* 排序按鈕 */}
        <button
          className="qe-topbar__btn"
          style={{ padding: '2px 6px', fontSize: 11 }}
          onClick={(e) => {
            e.stopPropagation();
            onMoveUp();
          }}
          disabled={index === 0}
          title="上移"
        >
          ↑
        </button>
        <button
          className="qe-topbar__btn"
          style={{ padding: '2px 6px', fontSize: 11 }}
          onClick={(e) => {
            e.stopPropagation();
            onMoveDown();
          }}
          disabled={index === total - 1}
          title="下移"
        >
          ↓
        </button>
        {/* 刪除按鈕 */}
        <button
          className="qe-topbar__btn qe-topbar__btn--danger"
          style={{ padding: '2px 6px', fontSize: 11 }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="刪除"
        >
          ✕
        </button>
        {/* 展開指示 */}
        <Mono v="fade">{open ? '▲' : '▼'}</Mono>
      </div>

      {/* 展開內容 */}
      {open && (
        <div
          style={{
            padding: '10px 14px 14px',
            borderTop: '1px solid var(--qe-line)',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ─── 陣列項目上下移動工具 ───────────────────────────────────────────
function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ═══════════════════════════════════════════════════════════════════
//  CONTACT EDITOR 主體
// ═══════════════════════════════════════════════════════════════════
export default function ContactEditor({
  dataZh,
  dataEn,
  setDataZh,
  setDataEn,
  api,
}: ContactEditorProps) {
  // 語言切換
  const [lang, setLang] = useState<'zh' | 'en'>('zh');

  // 左側導航：目前選取的區塊
  const [activeSection, setActiveSection] = useState<SectionId>('subjects');

  // 各語言各自的 dirty 追蹤
  const [dirtyZh, setDirtyZh] = useState(false);
  const [dirtyEn, setDirtyEn] = useState(false);
  const [dialog, setDialog] = useState<ConfirmDialogState>(DIALOG_CLOSED);

  // 目前語言的資料與 setter
  const data: ContactData = lang === 'zh' ? dataZh || {} : dataEn || {};
  const setData = lang === 'zh' ? setDataZh : setDataEn;
  const dirty = lang === 'zh' ? dirtyZh : dirtyEn;
  const setDirty = lang === 'zh' ? setDirtyZh : setDirtyEn;

  // 更新欄位（自動標記 dirty）
  const up = useCallback(
    (patch: Partial<ContactData>) => {
      setData({ ...data, ...patch });
      setDirty(true);
    },
    [data, setData, setDirty]
  );

  // 儲存當前語言的 singleton
  const save = useCallback(async () => {
    const key = lang === 'zh' ? 'contact-zh' : 'contact-en';
    const res = await api(`/api/root/singletons/${key}`, 'PUT', {
      content: data,
    });
    if (res.ok) setDirty(false);
  }, [lang, data, api, setDirty]);

  // ─── 各區塊資料解包 ──────────────────────────────────────────────
  const subjects: string[] = Array.isArray(data.subjects) ? data.subjects : [];
  const directLinks: DirectLink[] = Array.isArray(data.directLinks)
    ? data.directLinks
    : [];
  const faqs: FAQ[] = Array.isArray(data.faqs) ? data.faqs : [];
  const devCta: DevCta = data.devCta || { heading: '', text: '' };

  // ─── 各區塊渲染 ──────────────────────────────────────────────────

  /** Subjects：聯絡主旨 tag 列（Hero 已移至 00 頁面文字）*/
  const renderSubjects = () => (
    <div>
      <div className="qe-section-label">—— subjects</div>
      <div className="qe-rule" />
      <p
        style={{ fontSize: 12, color: 'var(--qe-ink-mute)', marginBottom: 12 }}
      >
        聯絡主旨選項清單，每項顯示為 pill/tag。
      </p>
      <div className="qe-tags" style={{ marginBottom: 12 }}>
        {subjects.map((s, i) => (
          <span key={i} className="qe-tag">
            {s}
            <span
              className="qe-tag__x"
              onClick={() =>
                up({ subjects: subjects.filter((_, j) => j !== i) })
              }
            >
              ×
            </span>
          </span>
        ))}
        <button
          className="qe-tag--add"
          onClick={() => {
            setDialog({
              open: true,
              title: lang === 'zh' ? '新增主旨選項' : 'New subject option',
              prompt: true,
              promptPlaceholder:
                lang === 'zh' ? '輸入主旨名稱' : 'Enter subject name',
              confirmLabel: '新增',
              onPromptConfirm: (v) => up({ subjects: [...subjects, v] }),
            });
          }}
        >
          + subject
        </button>
      </div>
    </div>
  );

  /** Direct Links：key / value / url 物件陣列 */
  const renderDirectLinks = () => (
    <div>
      <div className="qe-section-label">—— direct links</div>
      <div className="qe-rule" />
      <p
        style={{ fontSize: 12, color: 'var(--qe-ink-mute)', marginBottom: 12 }}
      >
        每個 link 包含顯示標籤（key）、顯示值（value）、連結 URL。
      </p>
      {directLinks.map((lk, i) => (
        <ArrayCard
          key={i}
          index={i}
          total={directLinks.length}
          summary={lk.key ? `${lk.key}  ${lk.value || ''}` : ''}
          onMoveUp={() => up({ directLinks: moveItem(directLinks, i, i - 1) })}
          onMoveDown={() =>
            up({ directLinks: moveItem(directLinks, i, i + 1) })
          }
          onDelete={() =>
            up({ directLinks: directLinks.filter((_, j) => j !== i) })
          }
        >
          <Field label="key" hint="顯示標籤，如 EMAIL">
            <Input
              value={lk.key}
              onChange={(v) => {
                const next = directLinks.map((x, j) =>
                  j === i ? { ...x, key: v } : x
                );
                up({ directLinks: next });
              }}
              placeholder="EMAIL"
              mono
            />
          </Field>
          <Field label="value" hint="顯示值，如 ptyc4076@gmail.com">
            <Input
              value={lk.value}
              onChange={(v) => {
                const next = directLinks.map((x, j) =>
                  j === i ? { ...x, value: v } : x
                );
                up({ directLinks: next });
              }}
              placeholder="ptyc4076@gmail.com"
            />
          </Field>
          <Field label="url" hint="連結 URL">
            <Input
              value={lk.url}
              onChange={(v) => {
                const next = directLinks.map((x, j) =>
                  j === i ? { ...x, url: v } : x
                );
                up({ directLinks: next });
              }}
              placeholder="mailto:... 或 https://..."
              mono
            />
          </Field>
        </ArrayCard>
      ))}
      <button
        className="qe-tag--add"
        style={{ marginTop: 4 }}
        onClick={() =>
          up({ directLinks: [...directLinks, { key: '', value: '', url: '' }] })
        }
      >
        + add link
      </button>
    </div>
  );

  /** Expectation：預期回應文字 */
  const renderExpectation = () => (
    <div>
      <div className="qe-section-label">—— expectation</div>
      <div className="qe-rule" />
      <Field label="expectation" hint="預期回應段落文字">
        <textarea
          className="qe-desc-textarea"
          rows={6}
          value={data.expectation || ''}
          placeholder={
            lang === 'zh'
              ? '描述預期的回應方式與時間…'
              : 'Describe expected response time and approach…'
          }
          onChange={(e) => up({ expectation: e.target.value })}
        />
      </Field>
    </div>
  );

  /** FAQs：問答陣列 */
  const renderFaqs = () => (
    <div>
      <div className="qe-section-label">—— faqs</div>
      <div className="qe-rule" />
      <p
        style={{ fontSize: 12, color: 'var(--qe-ink-mute)', marginBottom: 12 }}
      >
        常見問題清單，每項包含問題（q）與答案（a）。
      </p>
      {faqs.map((faq, i) => (
        <ArrayCard
          key={i}
          index={i}
          total={faqs.length}
          summary={faq.q ? faq.q.slice(0, 50) : ''}
          onMoveUp={() => up({ faqs: moveItem(faqs, i, i - 1) })}
          onMoveDown={() => up({ faqs: moveItem(faqs, i, i + 1) })}
          onDelete={() => up({ faqs: faqs.filter((_, j) => j !== i) })}
        >
          <Field label="q" hint="問題">
            <textarea
              className="qe-desc-textarea"
              rows={2}
              value={faq.q}
              placeholder={lang === 'zh' ? '問題…' : 'Question…'}
              onChange={(e) => {
                const next = faqs.map((x, j) =>
                  j === i ? { ...x, q: e.target.value } : x
                );
                up({ faqs: next });
              }}
            />
          </Field>
          <Field label="a" hint="答案">
            <textarea
              className="qe-desc-textarea"
              rows={4}
              value={faq.a}
              placeholder={lang === 'zh' ? '答案…' : 'Answer…'}
              onChange={(e) => {
                const next = faqs.map((x, j) =>
                  j === i ? { ...x, a: e.target.value } : x
                );
                up({ faqs: next });
              }}
            />
          </Field>
        </ArrayCard>
      ))}
      <button
        className="qe-tag--add"
        style={{ marginTop: 4 }}
        onClick={() => up({ faqs: [...faqs, { q: '', a: '' }] })}
      >
        + add FAQ
      </button>
    </div>
  );

  /** Dev CTA：heading + text */
  const renderDevCta = () => (
    <div>
      <div className="qe-section-label">—— dev cta</div>
      <div className="qe-rule" />
      <Field label="heading" hint="如「遇到 bug 或想提建議？」">
        <Input
          value={devCta.heading}
          onChange={(v) => up({ devCta: { ...devCta, heading: v } })}
          placeholder={
            lang === 'zh'
              ? '遇到 bug 或想提建議？'
              : 'Found a bug or want to suggest?'
          }
        />
      </Field>
      <Field label="text" hint="補充說明">
        <textarea
          className="qe-desc-textarea"
          rows={4}
          value={devCta.text}
          placeholder={
            lang === 'zh' ? '補充說明文字…' : 'Additional description…'
          }
          onChange={(e) => up({ devCta: { ...devCta, text: e.target.value } })}
        />
      </Field>
    </div>
  );

  // 根據選取的區塊渲染對應編輯器
  const renderCenter = () => {
    switch (activeSection) {
      case 'subjects':
        return renderSubjects();
      case 'directLinks':
        return renderDirectLinks();
      case 'expectation':
        return renderExpectation();
      case 'faqs':
        return renderFaqs();
      case 'devCta':
        return renderDevCta();
    }
  };

  // Inspector 中顯示的欄位數量
  const fieldCount = Object.keys(data).length;

  return (
    <>
      {/* ─── 左側：區塊導航 ─── */}
      <aside className="qe-left">
        <div className="qe-left__header">
          <div>
            <Mono v="navy">—— contact</Mono>
            <div style={{ marginTop: 4 }}>
              <Mono>{lang === 'zh' ? 'contact-zh' : 'contact-en'}</Mono>
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
              sub={s.sub}
              onClick={() => setActiveSection(s.id)}
            />
          ))}
        </div>
      </aside>

      {/* ─── 中央：編輯區 ─── */}
      <main className="qe-center">
        <div className="qe-editor-surface" style={{ maxWidth: 720 }}>
          {/* 頂部語言切換 toggle */}
          <div className="qe-lang-toggle">
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

          <div className="qe-section-label" style={{ marginBottom: 4 }}>
            —— contact · {lang === 'zh' ? 'contact-zh' : 'contact-en'}
          </div>
          <h2 style={{ margin: '4px 0 20px', fontSize: 26, fontWeight: 700 }}>
            {lang === 'zh' ? '聯絡 · Contact' : 'Contact'}
          </h2>

          {renderCenter()}
        </div>
      </main>

      {/* ─── 右側：Inspector ─── */}
      <aside className="qe-right">
        <div className="qe-right__header">
          <Mono v="navy">—— inspector</Mono>
        </div>
        <div className="qe-right__body">
          {/* D1 資訊 */}
          <Divider label="source" />
          <Field label="D1 table">
            <Input value="root_singletons" onChange={() => {}} mono disabled />
          </Field>
          <Field label="key">
            <Input
              value={lang === 'zh' ? 'contact-zh' : 'contact-en'}
              onChange={() => {}}
              mono
              disabled
            />
          </Field>
          <Field label="fields">
            <Input
              value={String(fieldCount)}
              onChange={() => {}}
              mono
              disabled
            />
          </Field>

          {/* 語言 dirty 狀態 */}
          <Divider label="language" />
          <Field label="zh">
            <Input
              value={dirtyZh ? '● unsaved' : 'synced'}
              onChange={() => {}}
              mono
              disabled
            />
          </Field>
          <Field label="en">
            <Input
              value={dirtyEn ? '● unsaved' : 'synced'}
              onChange={() => {}}
              mono
              disabled
            />
          </Field>

          {/* 儲存動作 */}
          <Divider label="actions" />
          <button
            className="qe-topbar__btn qe-topbar__btn--primary"
            style={{ width: '100%' }}
            onClick={save}
            disabled={!dirty}
          >
            <Mono style={{ color: 'inherit' }}>
              {dirty
                ? `● save ${lang === 'zh' ? 'contact-zh' : 'contact-en'}`
                : 'synced'}
            </Mono>
          </button>

          {/* 提示：兩個語言要分開儲存 */}
          <p
            style={{
              fontSize: 11,
              color: 'var(--qe-ink-mute)',
              marginTop: 10,
              lineHeight: 1.6,
            }}
          >
            繁中與英文版資料分開儲存。
            <br />
            切換語言後需各自點擊 save。
          </p>
        </div>
      </aside>
      <ConfirmDialog state={dialog} onClose={() => setDialog(DIALOG_CLOSED)} />
    </>
  );
}
