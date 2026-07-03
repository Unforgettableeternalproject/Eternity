/**
 * 記錄面板 — TopBar 右上角「記錄」入口（Epic 2 S5）
 *
 * - 訪客：顯示「初入世界的朋友」問候 + 登入 / 建立記錄（互動式註冊）
 * - 已登入：顯示代稱與帳號 + 登出
 * - 視角切換（探索者/觀測者）藏於面板底部——S5 起不再直接露出於 TopBar
 *
 * 註冊採 GitHub 人設創建風格：一步一問（識別名 → 通行密語 →
 * 可選信箱 → roll 初始代稱），最後由世界「命名」。
 */

import React, { useEffect, useRef, useState } from 'react';

import { getReaderAuth, GUEST_ALIAS } from '../../auth';
import { useReaderAuth } from '../../auth';
import ViewSwitch from './ViewSwitch';

import './RecordPanel.css';

type PanelMode = 'menu' | 'login' | 'register';

/* ── 註冊步驟 ── */

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RegisterDraft {
  username: string;
  password: string;
  passwordConfirm: string;
  email: string;
  alias: string | null;
}

const EMPTY_DRAFT: RegisterDraft = {
  username: '',
  password: '',
  passwordConfirm: '',
  email: '',
  alias: null,
};

const REGISTER_STEPS = [
  {
    kicker: 'IDENTIFIER',
    title: '你的識別名',
    hint: '3-32 字元的英數字，可含 - 與 _。這是登入用的帳號，不是你的稱呼。',
  },
  {
    kicker: 'PASSPHRASE',
    title: '你的通行密語',
    hint: '至少 8 字元。世界不會替你記住它。',
  },
  {
    kicker: 'CONTACT',
    title: '留下信使的路徑',
    hint: '可選。之後若忘記密語，這是唯一的找回途徑。',
  },
  {
    kicker: 'NAMING',
    title: '世界將如此稱呼你',
    hint: '這是你在此處的代稱。不滿意的話，可以請世界重新命名。',
  },
] as const;

function RegisterFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<RegisterDraft>(EMPTY_DRAFT);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoRolledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  /* 進入命名步驟時自動 roll 第一個代稱（只自動一次，失敗不無限重試） */
  useEffect(() => {
    if (step === 3 && !autoRolledRef.current) {
      autoRolledRef.current = true;
      void reroll();
    }
  }, [step]);

  async function reroll() {
    setRolling(true);
    const alias = await getReaderAuth().rollAlias();
    setDraft((d) => ({ ...d, alias }));
    setRolling(false);
  }

  function next() {
    setError('');
    if (step === 0) {
      if (!USERNAME_RE.test(draft.username.trim())) {
        setError('識別名需為 3-32 字元的英數字（可含 - 與 _）');
        return;
      }
    }
    if (step === 1) {
      if (draft.password.length < 8) {
        setError('通行密語至少需要 8 字元');
        return;
      }
      if (draft.password !== draft.passwordConfirm) {
        setError('兩次輸入的密語不一致');
        return;
      }
    }
    if (step === 2) {
      const email = draft.email.trim();
      if (email && !EMAIL_RE.test(email)) {
        setError('信箱格式看起來不太對');
        return;
      }
    }
    setStep((s) => s + 1);
  }

  async function submit() {
    setError('');
    setBusy(true);
    const result = await getReaderAuth().register({
      username: draft.username.trim(),
      password: draft.password,
      email: draft.email.trim() || undefined,
      alias: draft.alias || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || '建立記錄失敗');
      return;
    }
    window.__uepToastManager?.info(
      `記錄已建立。歡迎，${getReaderAuth().displayAlias()}。`
    );
    onDone();
  }

  const meta = REGISTER_STEPS[step];

  return (
    <div className="uep-record__flow">
      <div className="uep-record__steps" aria-hidden="true">
        {REGISTER_STEPS.map((_, i) => (
          <span
            key={i}
            className={`uep-record__step-dot${i <= step ? ' is-active' : ''}`}
          />
        ))}
      </div>
      <div className="uep-record__kicker">{meta.kicker}</div>
      <div className="uep-record__step-title">{meta.title}</div>

      {step === 0 && (
        <input
          ref={inputRef}
          className="uep-record__input"
          type="text"
          value={draft.username}
          autoComplete="username"
          placeholder="辨識符"
          onChange={(e) => setDraft({ ...draft, username: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && next()}
        />
      )}

      {step === 1 && (
        <>
          <input
            ref={inputRef}
            className="uep-record__input"
            type="password"
            value={draft.password}
            autoComplete="new-password"
            placeholder="通行密語"
            onChange={(e) => setDraft({ ...draft, password: e.target.value })}
          />
          <input
            className="uep-record__input"
            type="password"
            value={draft.passwordConfirm}
            autoComplete="new-password"
            placeholder="再輸入一次"
            onChange={(e) =>
              setDraft({ ...draft, passwordConfirm: e.target.value })
            }
            onKeyDown={(e) => e.key === 'Enter' && next()}
          />
        </>
      )}

      {step === 2 && (
        <input
          ref={inputRef}
          className="uep-record__input"
          type="email"
          value={draft.email}
          autoComplete="email"
          placeholder="信箱（可留白）"
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && next()}
        />
      )}

      {step === 3 && (
        <div className="uep-record__naming">
          <div className="uep-record__alias" aria-live="polite">
            {rolling ? '⋯' : (draft.alias ?? '（將由世界替你命名）')}
          </div>
          <button
            type="button"
            className="uep-record__reroll"
            onClick={() => void reroll()}
            disabled={rolling}
          >
            ↻ 請世界重新命名
          </button>
        </div>
      )}

      <div className="uep-record__hint">{meta.hint}</div>
      {error && <div className="uep-record__error">{error}</div>}

      <div className="uep-record__actions">
        {step > 0 && (
          <button
            type="button"
            className="uep-record__btn"
            onClick={() => {
              setError('');
              setStep((s) => s - 1);
            }}
          >
            ← 上一步
          </button>
        )}
        {step < 3 ? (
          <button
            type="button"
            className="uep-record__btn uep-record__btn--primary"
            onClick={next}
          >
            繼續 →
          </button>
        ) : (
          <button
            type="button"
            className="uep-record__btn uep-record__btn--primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? '銘刻中⋯' : '以此名銘刻記錄'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── 登入 ── */

function LoginFlow({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit() {
    setError('');
    if (!username.trim() || !password) {
      setError('識別名與通行密語都需要填寫');
      return;
    }
    setBusy(true);
    const result = await getReaderAuth().login(username.trim(), password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || '登入失敗');
      return;
    }
    window.__uepToastManager?.info(
      `記錄已接續。歡迎回來，${getReaderAuth().displayAlias()}。`
    );
    onDone();
  }

  return (
    <div className="uep-record__flow">
      <div className="uep-record__kicker">RESUME RECORD</div>
      <div className="uep-record__step-title">接續你的記錄</div>
      <input
        ref={inputRef}
        className="uep-record__input"
        type="text"
        value={username}
        autoComplete="username"
        placeholder="辨識符"
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className="uep-record__input"
        type="password"
        value={password}
        autoComplete="current-password"
        placeholder="通行密語"
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />
      {error && <div className="uep-record__error">{error}</div>}
      <div className="uep-record__actions">
        <button
          type="button"
          className="uep-record__btn uep-record__btn--primary"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? '驗證中⋯' : '接續記錄'}
        </button>
      </div>
    </div>
  );
}

/* ── 主面板 ── */

export default function RecordPanel() {
  const session = useReaderAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PanelMode>('menu');
  const rootRef = useRef<HTMLDivElement>(null);

  /* 點擊面板外 / Escape 關閉 */
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /* 面板每次開啟回到選單 */
  useEffect(() => {
    if (open) setMode('menu');
  }, [open]);

  function close() {
    setOpen(false);
  }

  async function handleLogout() {
    await getReaderAuth().logout();
    window.__uepToastManager?.info('記錄已闔上。你的足跡仍會留在此處。');
    setMode('menu');
  }

  return (
    <div className="uep-record" ref={rootRef}>
      <button
        className="btn-outline uep-record__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={session ? '你的記錄' : '登入或建立記錄'}
      >
        ✎ 記錄
        {session && <span className="uep-record__dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="uep-record__panel" role="dialog" aria-label="記錄">
          {mode === 'menu' && (
            <div className="uep-record__flow">
              <div className="uep-record__kicker">RECORD</div>
              <div className="uep-record__greeting">
                {session ? (
                  <>
                    <div className="uep-record__alias-line">
                      {getReaderAuth().displayAlias()}
                    </div>
                    <div className="uep-record__sub">@{session.username}</div>
                  </>
                ) : (
                  <>
                    <div className="uep-record__alias-line">{GUEST_ALIAS}</div>
                    <div className="uep-record__sub">
                      尚未銘刻——足跡僅存於此地
                    </div>
                  </>
                )}
              </div>

              {session ? (
                <div className="uep-record__actions">
                  <button
                    type="button"
                    className="uep-record__btn"
                    onClick={() => void handleLogout()}
                  >
                    闔上記錄（登出）
                  </button>
                </div>
              ) : (
                <div className="uep-record__actions">
                  <button
                    type="button"
                    className="uep-record__btn"
                    onClick={() => setMode('login')}
                  >
                    接續記錄
                  </button>
                  <button
                    type="button"
                    className="uep-record__btn uep-record__btn--primary"
                    onClick={() => setMode('register')}
                  >
                    建立記錄
                  </button>
                </div>
              )}

              <div className="uep-record__sep" />
              <div className="uep-record__view-row">
                <span className="uep-record__view-label">觀看世界的方式</span>
                <ViewSwitch />
              </div>
            </div>
          )}

          {mode === 'login' && (
            <>
              <button
                type="button"
                className="uep-record__back"
                onClick={() => setMode('menu')}
              >
                ← 返回
              </button>
              <LoginFlow onDone={close} />
            </>
          )}

          {mode === 'register' && (
            <>
              <button
                type="button"
                className="uep-record__back"
                onClick={() => setMode('menu')}
              >
                ← 返回
              </button>
              <RegisterFlow onDone={close} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
