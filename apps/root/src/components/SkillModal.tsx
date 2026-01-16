import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface SkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  skill: {
    name: string;
    description?: string;
    selfAssessment?: string;
  } | null;
  locale: 'zh-tw' | 'en';
}

export default function SkillModal({
  isOpen,
  onClose,
  skill,
  locale,
}: SkillModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 確保只在客戶端渲染
  useEffect(() => {
    setMounted(true);
  }, []);

  // 處理 ESC 鍵關閉
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden'; // 防止背景滾動
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 150); // 與動畫時間一致
  };

  if (!isOpen && !isClosing) return null;
  if (!skill) return null;
  if (!mounted) return null; // 防止 SSR 錯誤

  const hasContent =
    (skill.description && skill.description.trim()) ||
    (skill.selfAssessment && skill.selfAssessment.trim());

  const t = {
    'zh-tw': {
      learningExperience: '學習嘗試與心得',
      selfAssessment: '自我評估',
      noContent: '尚未添加詳細資訊',
      close: '關閉',
    },
    en: {
      learningExperience: 'Learning Experience',
      selfAssessment: 'Self Assessment',
      noContent: 'No detailed information added yet',
      close: 'Close',
    },
  };

  const text = t[locale];

  const modalContent = (
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 ${
        isClosing ? 'animate-fade-out' : 'animate-fade-in'
      }`}
      style={{ zIndex: 10002 }}
      onClick={handleClose}
    >
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />

      {/* 模態框內容 */}
      <div
        className={`relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden border border-slate-200/50 dark:border-slate-700/50 ${
          isClosing ? 'animate-scale-out' : 'animate-scale-in'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 標題列 */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
            {skill.name}
          </h2>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors duration-200"
            aria-label={text.close}
          >
            <svg
              className="w-6 h-6 text-slate-600 dark:text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 內容區 */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
          {hasContent ? (
            <div className="space-y-6">
              {/* 學習嘗試與心得 */}
              {skill.description && skill.description.trim() && (
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
                    {text.learningExperience}
                  </h3>
                  <div className="prose prose-slate dark:prose-invert max-w-none">
                    <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                      {skill.description}
                    </p>
                  </div>
                </div>
              )}

              {/* 自我評估 */}
              {skill.selfAssessment && skill.selfAssessment.trim() && (
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
                    {text.selfAssessment}
                  </h3>
                  <div className="prose prose-slate dark:prose-invert max-w-none">
                    <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                      {skill.selfAssessment}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-slate-500 dark:text-slate-400">
                {text.noContent}
              </p>
            </div>
          )}
        </div>

        {/* 底部按鈕 */}
        <div className="flex justify-end p-6 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={handleClose}
            className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors duration-200"
          >
            {text.close}
          </button>
        </div>
      </div>
    </div>
  );

  // 使用 Portal 將模態框渲染到 body
  return createPortal(modalContent, document.body);
}
