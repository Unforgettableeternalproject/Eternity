import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';

// ─── 型別 ────────────────────────────────────────────────────────
interface ContactFormProps {
  locale: string;
  subjects: string[];
}

// ─── 錯誤訊息 i18n ──────────────────────────────────────────────
const ERROR_MESSAGES: Record<string, { zh: string; en: string }> = {
  MISSING_FIELDS: {
    zh: '請填寫所有必填欄位。',
    en: 'All fields are required.',
  },
  INVALID_EMAIL: { zh: '電子信箱格式不正確。', en: 'Invalid email format.' },
  SERVICE_NOT_CONFIGURED: {
    zh: '郵件服務尚未設定，請聯繫管理員。',
    en: 'Email service not configured. Please contact administrator.',
  },
  SEND_FAILED: {
    zh: '郵件發送失敗，請稍後再試。',
    en: 'Failed to send email. Please try again.',
  },
  INTERNAL_ERROR: {
    zh: '伺服器發生錯誤，請稍後再試。',
    en: 'Internal server error. Please try again.',
  },
  NETWORK_ERROR: {
    zh: '網路錯誤，請檢查你的連線。',
    en: 'Network error. Check your connection.',
  },
};

function localizeError(code: string | undefined, locale: string): string {
  const entry = code ? ERROR_MESSAGES[code] : undefined;
  if (entry) return locale === 'zh-tw' ? entry.zh : entry.en;
  return locale === 'zh-tw'
    ? '發送失敗，請稍後再試。'
    : 'Failed to send. Please try again.';
}

// ─── 輕量 TipTap 工具列 ─────────────────────────────────────────
function MiniToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  const btn = (
    active: boolean,
    onClick: () => void,
    label: string,
    title: string
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        padding: '2px 7px',
        fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace",
        background: active ? 'var(--q-ink)' : 'transparent',
        color: active ? 'var(--q-paper)' : 'var(--q-ink-soft)',
        border: '1px solid var(--q-line)',
        cursor: 'pointer',
        lineHeight: 1.4,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        display: 'flex',
        gap: 3,
        padding: '6px 8px',
        borderBottom: '1px solid var(--q-line)',
        flexWrap: 'wrap',
      }}
    >
      {btn(
        editor.isActive('bold'),
        () => editor.chain().focus().toggleBold().run(),
        'B',
        'Bold'
      )}
      {btn(
        editor.isActive('italic'),
        () => editor.chain().focus().toggleItalic().run(),
        'I',
        'Italic'
      )}
      {btn(
        editor.isActive('strike'),
        () => editor.chain().focus().toggleStrike().run(),
        'S',
        'Strikethrough'
      )}
      <span
        style={{ width: 1, background: 'var(--q-line)', margin: '0 2px' }}
      />
      {btn(
        editor.isActive('bulletList'),
        () => editor.chain().focus().toggleBulletList().run(),
        '•',
        'Bullet List'
      )}
      {btn(
        editor.isActive('orderedList'),
        () => editor.chain().focus().toggleOrderedList().run(),
        '1.',
        'Ordered List'
      )}
      {btn(
        editor.isActive('blockquote'),
        () => editor.chain().focus().toggleBlockquote().run(),
        '❝',
        'Quote'
      )}
      {btn(
        editor.isActive('codeBlock'),
        () => editor.chain().focus().toggleCodeBlock().run(),
        '<>',
        'Code Block'
      )}
    </div>
  );
}

// ─── 成功 Dialog ─────────────────────────────────────────────────
function SuccessDialog({
  open,
  onClose,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  locale: string;
}) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      setClosing(false);
    }
  }, [open]);

  // ESC 關閉
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible]);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setVisible(false);
      setClosing(false);
      onClose();
    }, 200);
  }, [onClose]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(2px)',
        animation: closing
          ? 'dialogBgOut 0.2s ease forwards'
          : 'dialogBgIn 0.2s ease',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        style={{
          background: 'var(--q-paper)',
          border: '1px solid var(--q-line)',
          maxWidth: 420,
          width: '90%',
          padding: 0,
          animation: closing
            ? 'dialogFadeOut 0.2s ease forwards'
            : 'dialogFadeIn 0.25s ease',
        }}
      >
        {/* 頂部條 */}
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--q-ink)',
            color: 'var(--q-paper)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              opacity: 0.7,
            }}
          >
            {locale === 'zh-tw' ? '訊息狀態' : 'Message Status'}
          </span>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#22c55e',
              display: 'inline-block',
            }}
          />
        </div>

        {/* 內容 */}
        <div style={{ padding: '28px 24px', textAlign: 'center' }}>
          <div
            style={{
              fontSize: 40,
              marginBottom: 12,
              lineHeight: 1,
            }}
          >
            ✓
          </div>
          <h3
            style={{
              margin: '0 0 8px',
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--q-ink)',
              letterSpacing: '-0.02em',
            }}
          >
            {locale === 'zh-tw' ? '已送出' : 'Sent'}
          </h3>
          <p
            style={{
              margin: '0 0 24px',
              fontSize: 14,
              color: 'var(--q-ink-soft)',
              lineHeight: 1.6,
            }}
          >
            {locale === 'zh-tw'
              ? '訊息已成功發送，我會盡量在 48 小時內回覆你。'
              : "Your message has been sent successfully. I'll try to reply within 48 hours."}
          </p>
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: '10px 32px',
              background: 'var(--q-ink)',
              color: 'var(--q-paper)',
              border: 'none',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--q-font-body)',
            }}
          >
            {locale === 'zh-tw' ? '知道了' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  主元件
// ═══════════════════════════════════════════════════════════════════
export default function ContactForm({ locale, subjects }: ContactFormProps) {
  const [activeSubject, setActiveSubject] = useState(0);
  const [subjectText, setSubjectText] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState('');

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Placeholder.configure({
        placeholder:
          locale === 'zh-tw'
            ? '細節寫多一點對我很有幫助 — 你做什麼、想合作什麼、時程怎麼樣...'
            : 'More detail helps — what you do, what collaboration you have in mind, timeline...',
      }),
      Link.configure({
        openOnClick: false,
      }),
    ],
    editorProps: {
      attributes: {
        class: 'contact-tiptap',
        style:
          'min-height: 180px; padding: 14px 16px; outline: none; font-size: 15px; line-height: 1.65; color: var(--q-ink); font-family: var(--q-font-body);',
      },
    },
  });

  const charCount =
    editor?.storage.characterCount?.characters?.() ??
    editor?.getText().length ??
    0;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editor) return;

      const message = editor.getText();
      if (!message.trim()) return;
      if (!name.trim() || !email.trim()) return;

      setSending(true);
      setError('');

      try {
        // 送出 HTML 格式的訊息（這樣在信件裡排版比較好看）
        const html = editor.getHTML();
        const res = await fetch('/api/contact.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim(),
            subject:
              subjectText || subjects[activeSubject]?.split(' · ')[0] || '',
            message: html,
          }),
        });
        const result = await res.json();

        if (res.ok) {
          setShowSuccess(true);
          // 重置表單
          setName('');
          setEmail('');
          setSubjectText('');
          setActiveSubject(0);
          editor.commands.clearContent();
        } else {
          setError(localizeError(result.code, locale));
        }
      } catch {
        setError(localizeError('NETWORK_ERROR', locale));
      } finally {
        setSending(false);
      }
    },
    [editor, name, email, subjectText, activeSubject, subjects, locale]
  );

  return (
    <>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        {/* Name + Email */}
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}
        >
          <div>
            <span className="q-mono">name *</span>
            <input
              type="text"
              required
              className="q-input"
              style={{ marginTop: 8 }}
              placeholder={locale === 'zh-tw' ? '你的名字' : 'Your name'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <span className="q-mono">email *</span>
            <input
              type="email"
              required
              className="q-input"
              style={{ marginTop: 8 }}
              placeholder="you@somewhere.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        {/* Subject */}
        <div>
          <span className="q-mono">subject</span>
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginTop: 10,
              marginBottom: 12,
            }}
          >
            {subjects.map((s, i) => (
              <button
                key={i}
                type="button"
                className={`q-subject-pill ${activeSubject === i ? 'active' : ''}`}
                onClick={() => {
                  setActiveSubject(i);
                  setSubjectText(s.split(' · ')[0]);
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="q-input"
            placeholder={
              locale === 'zh-tw'
                ? '一句話說明你想聊什麼'
                : 'One line about what you want to discuss'
            }
            value={subjectText}
            onChange={(e) => setSubjectText(e.target.value)}
          />
        </div>

        {/* Message — TipTap */}
        <div>
          <span className="q-mono">message *</span>
          <div
            style={{
              marginTop: 8,
              border: '1px solid var(--q-line)',
              background: 'var(--q-paper)',
              transition: 'border-color 0.15s',
            }}
            onFocusCapture={() => {
              const el = document.querySelector('.contact-tiptap-wrap');
              if (el) (el as HTMLElement).style.borderColor = 'var(--q-navy)';
            }}
            onBlurCapture={() => {
              const el = document.querySelector('.contact-tiptap-wrap');
              if (el) (el as HTMLElement).style.borderColor = 'var(--q-line)';
            }}
            className="contact-tiptap-wrap"
          >
            <MiniToolbar editor={editor} />
            <EditorContent editor={editor} />
          </div>
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span className="q-mono">rich text supported</span>
            <span className="q-mono">{charCount} / 2000</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: '10px 14px',
              border: '1px solid var(--q-coral)',
              color: 'var(--q-coral)',
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {error}
          </div>
        )}

        {/* Submit */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 8,
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <span className="q-mono">
            powered by resend · ≤ 48hr {locale === 'zh-tw' ? '回覆' : 'reply'}
          </span>
          <button
            type="submit"
            disabled={sending}
            style={{
              padding: '14px 32px',
              fontSize: 15,
              fontWeight: 600,
              background: sending ? 'var(--q-ink-soft)' : 'var(--q-ink)',
              color: 'var(--q-paper)',
              border: 'none',
              cursor: sending ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: 'var(--q-font-body)',
            }}
          >
            {sending
              ? locale === 'zh-tw'
                ? '發送中...'
                : 'Sending...'
              : locale === 'zh-tw'
                ? '送出 →'
                : 'Send →'}
          </button>
        </div>
      </form>

      {/* 成功 Dialog */}
      <SuccessDialog
        open={showSuccess}
        onClose={() => setShowSuccess(false)}
        locale={locale}
      />

      <style>{`
        .contact-tiptap p {
          margin: 0 0 8px;
        }
        .contact-tiptap p:last-child {
          margin-bottom: 0;
        }
        .contact-tiptap ul {
          padding-left: 24px;
          margin: 4px 0;
          list-style-type: disc;
        }
        .contact-tiptap ol {
          padding-left: 24px;
          margin: 4px 0;
          list-style-type: decimal;
        }
        .contact-tiptap li {
          display: list-item;
        }
        .contact-tiptap blockquote {
          border-left: 3px solid var(--q-line);
          margin: 8px 0;
          padding: 4px 16px;
          color: var(--q-ink-soft);
        }
        .contact-tiptap pre {
          background: var(--q-paper-soft, #f5f5f0);
          padding: 12px 16px;
          margin: 8px 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          overflow-x: auto;
        }
        .contact-tiptap code {
          background: var(--q-paper-soft, #f5f5f0);
          padding: 2px 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
        }
        .contact-tiptap .is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--q-ink-mute);
          pointer-events: none;
          height: 0;
        }
        @keyframes dialogBgIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dialogBgOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes dialogFadeIn {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes dialogFadeOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(8px) scale(0.97); }
        }
      `}</style>
    </>
  );
}
