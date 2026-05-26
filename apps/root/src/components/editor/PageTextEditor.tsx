import React, { useState, useCallback } from 'react';
import { Mono, Divider, Field, Input, OutlineRow } from './editorPrimitives';

// ─── 型別定義 ────────────────────────────────────────────────────────

export interface PageTextEditorProps {
  homeZh: any;
  homeEn: any;
  projectsZh: any;
  projectsEn: any;
  updatesZh: any;
  updatesEn: any;
  linksZh: any;
  linksEn: any;
  aboutZh: any;
  aboutEn: any;
  contactZh: any;
  contactEn: any;
  setHomeZh: (d: any) => void;
  setHomeEn: (d: any) => void;
  setProjectsZh: (d: any) => void;
  setProjectsEn: (d: any) => void;
  setUpdatesZh: (d: any) => void;
  setUpdatesEn: (d: any) => void;
  setLinksZh: (d: any) => void;
  setLinksEn: (d: any) => void;
  setAboutZh: (d: any) => void;
  setAboutEn: (d: any) => void;
  setContactZh: (d: any) => void;
  setContactEn: (d: any) => void;
  api: (path: string, method: string, body?: any) => Promise<any>;
}

// ─── 左側面板頁面定義 ────────────────────────────────────────────────
type PageId = 'home' | 'projects' | 'updates' | 'links' | 'about' | 'contact';

const PAGES: { id: PageId; num: string; label: string; sub: string }[] = [
  {
    id: 'home',
    num: '00',
    label: '首頁 Home',
    sub: 'page-home-zh / page-home-en',
  },
  {
    id: 'projects',
    num: '01',
    label: '專案 Projects',
    sub: 'page-projects-zh / page-projects-en',
  },
  {
    id: 'updates',
    num: '02',
    label: '動態 Updates',
    sub: 'page-updates-zh / page-updates-en',
  },
  {
    id: 'links',
    num: '03',
    label: '連結 Links',
    sub: 'page-links-zh / page-links-en',
  },
  {
    id: 'about',
    num: '04',
    label: '關於 About',
    sub: 'page-about-zh / page-about-en',
  },
  {
    id: 'contact',
    num: '05',
    label: '聯絡 Contact',
    sub: 'page-contact-zh / page-contact-en',
  },
];

// ─── Singleton key 對應 ──────────────────────────────────────────────
function singletonKey(page: PageId, lang: 'zh' | 'en'): string {
  return `page-${page}-${lang}`;
}

// ─── 首頁（Home）欄位定義 ─────────────────────────────────────────────
const HOME_FIELDS: {
  key: string;
  label: string;
  type: 'input' | 'textarea';
  placeholder?: string;
}[] = [
  {
    key: 'heroLabel',
    label: 'heroLabel',
    type: 'input',
    placeholder: 'e.g. UNFORGETTABLE ETERNAL PROJECT',
  },
  {
    key: 'heroTitle',
    label: 'heroTitle',
    type: 'input',
    placeholder: '主標題大字',
  },
  {
    key: 'heroSubtitle',
    label: 'heroSubtitle',
    type: 'textarea',
    placeholder: '副標題段落文字…',
  },
  {
    key: 'heroCta1',
    label: 'heroCta1',
    type: 'input',
    placeholder: 'e.g. 探索作品',
  },
  {
    key: 'heroCta2',
    label: 'heroCta2',
    type: 'input',
    placeholder: 'e.g. 關於我',
  },
  {
    key: 'projectsLabel',
    label: 'projectsLabel',
    type: 'input',
    placeholder: 'e.g. PROJECTS',
  },
  {
    key: 'projectsTitle',
    label: 'projectsTitle',
    type: 'input',
    placeholder: '專案區塊標題',
  },
  {
    key: 'projectsCta',
    label: 'projectsCta',
    type: 'input',
    placeholder: 'e.g. 瀏覽全部作品',
  },
  {
    key: 'aboutLabel',
    label: 'aboutLabel',
    type: 'input',
    placeholder: 'e.g. ABOUT',
  },
  {
    key: 'aboutTitle',
    label: 'aboutTitle',
    type: 'input',
    placeholder: 'About 標題',
  },
  {
    key: 'aboutContent',
    label: 'aboutContent',
    type: 'textarea',
    placeholder: 'About 內文段落…',
  },
  {
    key: 'aboutCta',
    label: 'aboutCta',
    type: 'input',
    placeholder: 'e.g. 閱讀更多關於我',
  },
  {
    key: 'updatesLabel',
    label: 'updatesLabel',
    type: 'input',
    placeholder: 'e.g. UPDATES',
  },
  {
    key: 'updatesTitle',
    label: 'updatesTitle',
    type: 'input',
    placeholder: '動態區塊標題',
  },
  {
    key: 'updatesCta',
    label: 'updatesCta',
    type: 'input',
    placeholder: 'e.g. 查看所有動態',
  },
];

// ─── 專案（Projects）欄位定義 ─────────────────────────────────────────
const PROJECTS_FIELDS: {
  key: string;
  label: string;
  type: 'input' | 'textarea';
  placeholder?: string;
}[] = [
  {
    key: 'heroLabel',
    label: 'heroLabel',
    type: 'input',
    placeholder: 'e.g. PROJECTS',
  },
  {
    key: 'heroTitle',
    label: 'heroTitle',
    type: 'input',
    placeholder: '頁面主標題',
  },
  {
    key: 'heroSubtitle',
    label: 'heroSubtitle',
    type: 'textarea',
    placeholder: '副標題段落文字…',
  },
  {
    key: 'bottomTitle',
    label: 'bottomTitle',
    type: 'input',
    placeholder: '頁底標題',
  },
  {
    key: 'bottomSubtitle',
    label: 'bottomSubtitle',
    type: 'textarea',
    placeholder: '頁底副標題段落…',
  },
];

// ─── 動態（Updates）欄位定義 ─────────────────────────────────────────
const UPDATES_FIELDS: {
  key: string;
  label: string;
  type: 'input' | 'textarea';
  placeholder?: string;
}[] = [
  {
    key: 'heroLabel',
    label: 'heroLabel',
    type: 'input',
    placeholder: 'e.g. UPDATES',
  },
  {
    key: 'heroTitle',
    label: 'heroTitle',
    type: 'input',
    placeholder: '頁面主標題',
  },
  {
    key: 'heroSubtitle',
    label: 'heroSubtitle',
    type: 'textarea',
    placeholder: '副標題段落文字…',
  },
];

// ─── 連結（Links）欄位定義 ────────────────────────────────────────────
const LINKS_FIELDS: {
  key: string;
  label: string;
  type: 'input' | 'textarea';
  placeholder?: string;
}[] = [
  {
    key: 'heroLabel',
    label: 'heroLabel',
    type: 'input',
    placeholder: 'e.g. LINKS',
  },
  {
    key: 'heroTitle',
    label: 'heroTitle',
    type: 'input',
    placeholder: '頁面主標題',
  },
  {
    key: 'heroSubtitle',
    label: 'heroSubtitle',
    type: 'textarea',
    placeholder: '副標題段落文字…',
  },
  {
    key: 'bottomTitle',
    label: 'bottomTitle',
    type: 'input',
    placeholder: '頁底標題',
  },
  {
    key: 'bottomSubtitle',
    label: 'bottomSubtitle',
    type: 'textarea',
    placeholder: '頁底副標題段落…',
  },
];

// ─── 關於（About）欄位定義 ────────────────────────────────────────────
const ABOUT_FIELDS: typeof HOME_FIELDS = [
  {
    key: 'heroLabel',
    label: 'heroLabel',
    type: 'input',
    placeholder: '—— 03 / about · 個人簡介',
  },
  {
    key: 'heroTitle',
    label: 'heroTitle（支援 HTML）',
    type: 'textarea',
    placeholder: '頁面主標題（可含 <br/> 和 <span>）',
  },
  {
    key: 'heroIntro',
    label: 'heroIntro',
    type: 'textarea',
    placeholder: 'Hero 介紹段落',
  },
];

// ─── 聯絡（Contact）欄位定義 ──────────────────────────────────────────
const CONTACT_FIELDS: typeof HOME_FIELDS = [
  {
    key: 'heroLabel',
    label: 'heroLabel',
    type: 'input',
    placeholder: '—— 06 / contact · 寫信給我',
  },
  {
    key: 'heroTitle',
    label: 'heroTitle（支援 HTML）',
    type: 'textarea',
    placeholder: '頁面主標題（可含 <br/> 和 <span>）',
  },
  {
    key: 'heroIntro',
    label: 'heroIntro',
    type: 'textarea',
    placeholder: 'Hero 介紹段落',
  },
];

// ─── 欄位定義映射 ────────────────────────────────────────────────────
const PAGE_FIELDS: Record<PageId, typeof HOME_FIELDS> = {
  home: HOME_FIELDS,
  projects: PROJECTS_FIELDS,
  updates: UPDATES_FIELDS,
  links: LINKS_FIELDS,
  about: ABOUT_FIELDS,
  contact: CONTACT_FIELDS,
};

// ─── 頁面欄位編輯器：依欄位定義列出 Input/textarea ──────────────────
function PageFields({
  fields,
  data,
  onChange,
}: {
  fields: typeof HOME_FIELDS;
  data: any;
  onChange: (patch: any) => void;
}) {
  return (
    <>
      {fields.map(({ key, label, type, placeholder }) =>
        type === 'textarea' ? (
          <Field key={key} label={label}>
            <textarea
              className="qe-desc-textarea"
              value={(data || {})[key] || ''}
              rows={4}
              placeholder={placeholder}
              onChange={(e) => onChange({ [key]: e.target.value })}
            />
          </Field>
        ) : (
          <Field key={key} label={label}>
            <Input
              value={(data || {})[key] || ''}
              onChange={(v) => onChange({ [key]: v })}
              placeholder={placeholder}
            />
          </Field>
        )
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  主元件
// ═══════════════════════════════════════════════════════════════════
export default function PageTextEditor({
  homeZh,
  homeEn,
  projectsZh,
  projectsEn,
  updatesZh,
  updatesEn,
  linksZh,
  linksEn,
  aboutZh,
  aboutEn,
  contactZh,
  contactEn,
  setHomeZh,
  setHomeEn,
  setProjectsZh,
  setProjectsEn,
  setUpdatesZh,
  setUpdatesEn,
  setLinksZh,
  setLinksEn,
  setAboutZh,
  setAboutEn,
  setContactZh,
  setContactEn,
  api,
}: PageTextEditorProps) {
  // 目前選取的頁面
  const [activePage, setActivePage] = useState<PageId>('home');

  // 語言切換（中央頂部）
  const [lang, setLang] = useState<'zh' | 'en'>('zh');

  // 每個頁面各語言的 dirty 狀態
  const [dirtyHomeZh, setDirtyHomeZh] = useState(false);
  const [dirtyHomeEn, setDirtyHomeEn] = useState(false);
  const [dirtyProjectsZh, setDirtyProjectsZh] = useState(false);
  const [dirtyProjectsEn, setDirtyProjectsEn] = useState(false);
  const [dirtyUpdatesZh, setDirtyUpdatesZh] = useState(false);
  const [dirtyUpdatesEn, setDirtyUpdatesEn] = useState(false);
  const [dirtyLinksZh, setDirtyLinksZh] = useState(false);
  const [dirtyLinksEn, setDirtyLinksEn] = useState(false);
  const [dirtyAboutZh, setDirtyAboutZh] = useState(false);
  const [dirtyAboutEn, setDirtyAboutEn] = useState(false);
  const [dirtyContactZh, setDirtyContactZh] = useState(false);
  const [dirtyContactEn, setDirtyContactEn] = useState(false);

  // ─── 取得當前頁面的資料與 setter ────────────────────────────────
  function getCurrentData(): any {
    if (activePage === 'home') return lang === 'zh' ? homeZh : homeEn;
    if (activePage === 'projects')
      return lang === 'zh' ? projectsZh : projectsEn;
    if (activePage === 'updates') return lang === 'zh' ? updatesZh : updatesEn;
    if (activePage === 'about') return lang === 'zh' ? aboutZh : aboutEn;
    if (activePage === 'contact') return lang === 'zh' ? contactZh : contactEn;
    return lang === 'zh' ? linksZh : linksEn;
  }

  function getCurrentSetter(): (d: any) => void {
    if (activePage === 'home') return lang === 'zh' ? setHomeZh : setHomeEn;
    if (activePage === 'projects')
      return lang === 'zh' ? setProjectsZh : setProjectsEn;
    if (activePage === 'updates')
      return lang === 'zh' ? setUpdatesZh : setUpdatesEn;
    if (activePage === 'about') return lang === 'zh' ? setAboutZh : setAboutEn;
    if (activePage === 'contact')
      return lang === 'zh' ? setContactZh : setContactEn;
    return lang === 'zh' ? setLinksZh : setLinksEn;
  }

  function getCurrentDirty(): boolean {
    if (activePage === 'home') return lang === 'zh' ? dirtyHomeZh : dirtyHomeEn;
    if (activePage === 'projects')
      return lang === 'zh' ? dirtyProjectsZh : dirtyProjectsEn;
    if (activePage === 'updates')
      return lang === 'zh' ? dirtyUpdatesZh : dirtyUpdatesEn;
    if (activePage === 'about')
      return lang === 'zh' ? dirtyAboutZh : dirtyAboutEn;
    if (activePage === 'contact')
      return lang === 'zh' ? dirtyContactZh : dirtyContactEn;
    return lang === 'zh' ? dirtyLinksZh : dirtyLinksEn;
  }

  function setCurrentDirty(v: boolean) {
    if (activePage === 'home') {
      if (lang === 'zh') setDirtyHomeZh(v);
      else setDirtyHomeEn(v);
      return;
    }
    if (activePage === 'projects') {
      if (lang === 'zh') setDirtyProjectsZh(v);
      else setDirtyProjectsEn(v);
      return;
    }
    if (activePage === 'updates') {
      if (lang === 'zh') setDirtyUpdatesZh(v);
      else setDirtyUpdatesEn(v);
      return;
    }
    if (activePage === 'about') {
      if (lang === 'zh') setDirtyAboutZh(v);
      else setDirtyAboutEn(v);
      return;
    }
    if (activePage === 'contact') {
      if (lang === 'zh') setDirtyContactZh(v);
      else setDirtyContactEn(v);
      return;
    }
    if (lang === 'zh') setDirtyLinksZh(v);
    else setDirtyLinksEn(v);
  }

  // ─── 更新欄位 ────────────────────────────────────────────────────
  const updateField = useCallback(
    (patch: any) => {
      const data = getCurrentData();
      const setter = getCurrentSetter();
      setter({ ...(data || {}), ...patch });
      setCurrentDirty(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activePage,
      lang,
      homeZh,
      homeEn,
      projectsZh,
      projectsEn,
      updatesZh,
      updatesEn,
      linksZh,
      linksEn,
      aboutZh,
      aboutEn,
      contactZh,
      contactEn,
    ]
  );

  // ─── 儲存當前頁面 + 語言的 singleton ────────────────────────────
  const save = useCallback(async () => {
    const key = singletonKey(activePage, lang);
    const data = getCurrentData();
    const res = await api(`/api/root/singletons/${key}`, 'PUT', {
      content: data,
    });
    if (res.ok) setCurrentDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activePage,
    lang,
    homeZh,
    homeEn,
    projectsZh,
    projectsEn,
    updatesZh,
    updatesEn,
    linksZh,
    linksEn,
    aboutZh,
    aboutEn,
    contactZh,
    contactEn,
    api,
  ]);

  // ─── Inspector 欄位數量 ──────────────────────────────────────────
  const fieldCount = Object.keys(getCurrentData() || {}).length;
  const currentKey = singletonKey(activePage, lang);
  const isDirty = getCurrentDirty();

  // ─── 所有 dirty 狀態（unsaved 摘要用）────────────────────────────
  const allDirty = [
    { key: 'page-home-zh', dirty: dirtyHomeZh },
    { key: 'page-home-en', dirty: dirtyHomeEn },
    { key: 'page-projects-zh', dirty: dirtyProjectsZh },
    { key: 'page-projects-en', dirty: dirtyProjectsEn },
    { key: 'page-updates-zh', dirty: dirtyUpdatesZh },
    { key: 'page-updates-en', dirty: dirtyUpdatesEn },
    { key: 'page-links-zh', dirty: dirtyLinksZh },
    { key: 'page-links-en', dirty: dirtyLinksEn },
    { key: 'page-about-zh', dirty: dirtyAboutZh },
    { key: 'page-about-en', dirty: dirtyAboutEn },
    { key: 'page-contact-zh', dirty: dirtyContactZh },
    { key: 'page-contact-en', dirty: dirtyContactEn },
  ].filter((d) => d.dirty);

  return (
    <>
      {/* ─── 左側面板：頁面導航 ─── */}
      <aside className="qe-left">
        <div className="qe-left__header">
          <div>
            <Mono v="navy">—— page text</Mono>
            <div style={{ marginTop: 4 }}>
              <Mono>singleton · page-*</Mono>
            </div>
          </div>
        </div>

        {/* 頁面列表（不放語言切換） */}
        <div className="qe-left__body">
          {PAGES.map((p) => (
            <OutlineRow
              key={p.id}
              active={activePage === p.id}
              num={p.num}
              label={p.label}
              sub={p.sub}
              onClick={() => setActivePage(p.id)}
            />
          ))}
        </div>
      </aside>

      {/* ─── 中央編輯區 ─── */}
      <main className="qe-center">
        <div className="qe-editor-surface" style={{ maxWidth: 720 }}>
          {/* 頂部語言切換 toggle（與 ContactEditor/AboutEditor 風格一致） */}
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

          {/* 頁面標題指示 */}
          <div className="qe-section-label" style={{ marginBottom: 4 }}>
            —— {PAGES.find((p) => p.id === activePage)?.label} · {currentKey}
          </div>
          <h2 style={{ margin: '4px 0 20px', fontSize: 26, fontWeight: 700 }}>
            {PAGES.find((p) => p.id === activePage)?.label}
          </h2>

          {/* 依目前頁面渲染欄位 */}
          <PageFields
            fields={PAGE_FIELDS[activePage]}
            data={getCurrentData()}
            onChange={updateField}
          />
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
              value={currentKey}
              readOnly
              disabled
            />
          </Field>
          <Field label="fields">
            <input
              className="qe-input qe-input--mono"
              value={String(fieldCount)}
              readOnly
              disabled
            />
          </Field>

          {/* 語言 dirty 狀態 */}
          <Divider label="language" />
          <Field label="zh">
            <input
              className="qe-input qe-input--mono"
              value={
                activePage === 'home'
                  ? dirtyHomeZh
                    ? '● unsaved'
                    : 'synced'
                  : activePage === 'projects'
                    ? dirtyProjectsZh
                      ? '● unsaved'
                      : 'synced'
                    : activePage === 'updates'
                      ? dirtyUpdatesZh
                        ? '● unsaved'
                        : 'synced'
                      : dirtyLinksZh
                        ? '● unsaved'
                        : 'synced'
              }
              readOnly
              disabled
            />
          </Field>
          <Field label="en">
            <input
              className="qe-input qe-input--mono"
              value={
                activePage === 'home'
                  ? dirtyHomeEn
                    ? '● unsaved'
                    : 'synced'
                  : activePage === 'projects'
                    ? dirtyProjectsEn
                      ? '● unsaved'
                      : 'synced'
                    : activePage === 'updates'
                      ? dirtyUpdatesEn
                        ? '● unsaved'
                        : 'synced'
                      : dirtyLinksEn
                        ? '● unsaved'
                        : 'synced'
              }
              readOnly
              disabled
            />
          </Field>

          {/* 儲存動作 */}
          <Divider label="actions" />
          <button
            className="qe-topbar__btn qe-topbar__btn--primary"
            style={{ width: '100%' }}
            onClick={save}
            disabled={!isDirty}
          >
            <Mono style={{ color: 'inherit' }}>
              {isDirty ? `● save ${currentKey}` : 'synced'}
            </Mono>
          </button>

          {/* 提示：兩語言需分開儲存 */}
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

          {/* unsaved 摘要 */}
          {allDirty.length > 0 && (
            <>
              <Divider label="unsaved" />
              {allDirty.map(({ key }) => (
                <div
                  key={key}
                  style={{
                    fontSize: 10,
                    color: 'var(--qe-coral)',
                    fontFamily: 'var(--qe-mono)',
                    marginBottom: 4,
                  }}
                >
                  ● {key}
                </div>
              ))}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
