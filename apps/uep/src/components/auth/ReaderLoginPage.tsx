/**
 * 讀者登入 / 註冊頁 — /login 全屏儀式感頁面（Epic 2 S5）
 *
 * 承接原 RecordPanel 內的 LoginFlow / RegisterFlow，改造為獨立頁面：
 * - 三 mode：choice（雙路口）/ login / register
 * - 註冊沿用 GitHub 人設創建風格分步：識別名 → 通行密語 → 信箱 → roll 代稱
 * - 完成後導回 ?return= 指定的來源頁（預設 /）
 * - 已登入者由 useEffect 立即彈回，避免二次登入
 */

import React, { useEffect, useRef, useState } from 'react';

import {
  getReaderAuth,
  GUEST_ALIAS,
  useReaderAuth,
  WITNESSED_PREFIX,
} from '../../auth';
import { WELCOME_PENDING_KEY } from '../ui/GlobalWelcomeHost';

import './ReaderLoginPage.css';

type Mode = 'choice' | 'login' | 'register';

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  /** 站內 return 路徑；不合法（外站、跨網域）一律視為 '/' */
  returnUrl?: string;
}

/** 站內合法性：必須以 / 開頭，且不能是 //（協定相對）或 /login 自己 */
function sanitizeReturn(raw: string | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  if (raw.startsWith('/login')) return '/';
  return raw;
}

/**
 * 回跳目標是不是主頁。sanitizeReturn 保證是站內絕對路徑，但可能帶
 * query 或 hash（`/?x=1`、`/#journey`），所以不能只比對字串相等。
 */
export function isHomeReturn(target: string): boolean {
  const path = target.split(/[?#]/)[0];
  return path === '/' || path === '';
}

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

/* ─────────────────────────── 註冊分步 ─────────────────────────── */

function RegisterFlow({
  onDone,
  onBack,
}: {
  onDone: (alias: string) => void;
  onBack: () => void;
}) {
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
    /* 儀式接手——不再吐 toast，交給 WelcomeCeremony 顯示 alias */
    onDone(getReaderAuth().displayAlias());
  }

  const meta = REGISTER_STEPS[step];

  return (
    <div className="uep-login__flow">
      <div className="uep-login__steps" aria-hidden="true">
        {REGISTER_STEPS.map((_, i) => (
          <span
            key={i}
            className={`uep-login__step-dot${i <= step ? ' is-active' : ''}`}
          />
        ))}
      </div>
      <div className="uep-login__kicker">{meta.kicker}</div>
      <div className="uep-login__step-title">{meta.title}</div>

      {step === 0 && (
        <input
          ref={inputRef}
          className="uep-login__input"
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
            className="uep-login__input"
            type="password"
            value={draft.password}
            autoComplete="new-password"
            placeholder="通行密語"
            onChange={(e) => setDraft({ ...draft, password: e.target.value })}
          />
          <input
            className="uep-login__input"
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
          className="uep-login__input"
          type="email"
          value={draft.email}
          autoComplete="email"
          placeholder="信箱（可留白）"
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && next()}
        />
      )}

      {step === 3 && (
        <div className="uep-login__naming">
          <div className="uep-login__alias" aria-live="polite">
            {rolling ? '⋯' : (draft.alias ?? '（將由世界替你命名）')}
          </div>
          <button
            type="button"
            className="uep-login__reroll"
            onClick={() => void reroll()}
            disabled={rolling}
          >
            ↻ 請世界重新命名
          </button>
        </div>
      )}

      <div className="uep-login__hint">{meta.hint}</div>
      {error && <div className="uep-login__error">{error}</div>}

      <div className="uep-login__actions">
        <button
          type="button"
          className="uep-login__btn"
          onClick={() => {
            setError('');
            if (step === 0) onBack();
            else setStep((s) => s - 1);
          }}
        >
          ← {step === 0 ? '返回' : '上一步'}
        </button>
        {step < 3 ? (
          <button
            type="button"
            className="uep-login__btn uep-login__btn--primary"
            onClick={next}
          >
            繼續 →
          </button>
        ) : (
          <button
            type="button"
            className="uep-login__btn uep-login__btn--primary"
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

/* ─────────────────────────── 登入 ─────────────────────────── */

function LoginFlow({
  onDone,
  onBack,
}: {
  onDone: (alias: string) => void;
  onBack: () => void;
}) {
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
    onDone(getReaderAuth().displayAlias());
  }

  return (
    <div className="uep-login__flow">
      <div className="uep-login__kicker">RESUME RECORD</div>
      <div className="uep-login__step-title">接續你的記錄</div>
      <input
        ref={inputRef}
        className="uep-login__input"
        type="text"
        value={username}
        autoComplete="username"
        placeholder="辨識符"
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className="uep-login__input"
        type="password"
        value={password}
        autoComplete="current-password"
        placeholder="通行密語"
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />
      {error && <div className="uep-login__error">{error}</div>}
      <div className="uep-login__actions">
        <button type="button" className="uep-login__btn" onClick={onBack}>
          ← 返回
        </button>
        <button
          type="button"
          className="uep-login__btn uep-login__btn--primary"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? '驗證中⋯' : '接續記錄'}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── 主頁 ─────────────────────────── */

export default function ReaderLoginPage({ returnUrl }: Props) {
  const session = useReaderAuth();
  const [mode, setMode] = useState<Mode>('choice');
  const safeReturn = sanitizeReturn(returnUrl);

  /* 已登入者：直接彈回來源頁——避免二次登入 */
  useEffect(() => {
    if (session) {
      window.location.replace(safeReturn);
    }
  }, [session, safeReturn]);

  /**
   * auth 成功後只做兩件事：
   * 1. sessionStorage 存 pending flag（含 kind + alias），目標頁 GlobalWelcomeHost
   *    掛載時讀到就播 WelcomeCeremony
   * 2. 立刻導頁——不在 /login 頁播儀式，避免目標頁自己的入場動畫在下方搶跑
   *
   * 這樣時序上是「頁面已就位 → 儀式在頁面上方播 → 識別證接手」，
   * 而不是「儀式播 → 導頁 → 目標頁動畫蓋過識別證」。
   */
  function done(kind: 'login' | 'register', alias: string) {
    /* 儀式只在主頁播。回到 zone 頁時該頁自己就有入場動畫與 Reader 的
       進場節奏，全屏儀式疊上去是兩套開場互相打架。錯過就錯過——
       不補播、不排隊（登出一律導回主頁，所以不受這條影響）。 */
    if (isHomeReturn(safeReturn)) {
      try {
        sessionStorage.setItem(
          WELCOME_PENDING_KEY,
          JSON.stringify({ kind, alias })
        );
      } catch {
        /* sessionStorage 不可用時就沒儀式，不影響 auth 流程 */
      }
    }
    window.location.href = safeReturn;
  }

  const displayGuest = session
    ? `${session.observerEver ? WITNESSED_PREFIX : ''}${session.alias}`
    : GUEST_ALIAS;

  return (
    <div className="uep-login-page">
      {/* 背景微塵粒子（沿用 admin login 的做法但更疏） */}
      <div className="uep-login-dust" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, i) => (
          <i
            key={i}
            style={{
              left: `${(i * 47) % 100}%`,
              top: `${(i * 31) % 100}%`,
              animationDuration: `${18 + (i % 6)}s`,
              animationDelay: `${(i * 0.7) % 8}s`,
            }}
          />
        ))}
      </div>

      <a href={safeReturn} className="uep-login-escape" aria-label="返回">
        ← 回到觀測誌
      </a>

      <div className="uep-login-card">
        <span className="uep-login-corner" style={{ top: 0, left: 0 }}>
          ┌
        </span>
        <span className="uep-login-corner" style={{ top: 0, right: 0 }}>
          ┐
        </span>
        <span className="uep-login-corner" style={{ bottom: 0, left: 0 }}>
          └
        </span>
        <span className="uep-login-corner" style={{ bottom: 0, right: 0 }}>
          ┘
        </span>

        <div className="uep-login-header">
          <div className="uep-login-kicker-line">
            <span />
            U.E.P · RECORD
            <span />
          </div>
          <h1 className="uep-login-title">
            {mode === 'choice' && '你正走進記錄之地'}
            {mode === 'login' && '接續你的記錄'}
            {mode === 'register' && '銘刻新的記錄'}
          </h1>
          <p className="uep-login-sub">
            {mode === 'choice' && `此刻的你——${displayGuest}`}
            {mode === 'login' && '把上一次留下的名字，再說一次'}
            {mode === 'register' && '一步一步，讓世界認識你'}
          </p>
        </div>

        <div className="uep-login-body">
          {mode === 'choice' && (
            <div className="uep-login-choice">
              <button
                type="button"
                className="uep-login-choice-card"
                onClick={() => setMode('login')}
              >
                <div className="uep-login-choice-glyph">◈</div>
                <div className="uep-login-choice-name">接續記錄</div>
                <div className="uep-login-choice-desc">
                  你曾在此留下名字——輸入識別名與通行密語，把足跡接回來。
                </div>
              </button>
              <button
                type="button"
                className="uep-login-choice-card"
                onClick={() => setMode('register')}
              >
                <div className="uep-login-choice-glyph">✎</div>
                <div className="uep-login-choice-name">建立記錄</div>
                <div className="uep-login-choice-desc">
                  第一次在此銘刻——世界會為你留出位置，替你取一個代稱。
                </div>
              </button>
            </div>
          )}

          {mode === 'login' && (
            <LoginFlow
              onDone={(alias) => done('login', alias)}
              onBack={() => setMode('choice')}
            />
          )}

          {mode === 'register' && (
            <RegisterFlow
              onDone={(alias) => done('register', alias)}
              onBack={() => setMode('choice')}
            />
          )}
        </div>

        <div className="uep-login-foot">
          {mode === 'choice' && (
            <p>不建立記錄也能自由遊歷——你的足跡會存於此地，只是不會跟你走。</p>
          )}
        </div>
      </div>
    </div>
  );
}
