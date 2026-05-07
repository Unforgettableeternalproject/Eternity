import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './GlobalSearch.css';

// ScrollBehavior type definition
type ScrollBehavior = 'auto' | 'instant' | 'smooth';

export interface SearchResult {
  id: string;
  type: 'project' | 'link' | 'update' | 'page';
  title: string;
  title_zh?: string;
  title_en?: string;
  description?: string;
  description_zh?: string;
  description_en?: string;
  url: string;
  category?: string;
  tags?: string[];
  date?: string;
}

interface GlobalSearchProps {
  locale: 'zh-tw' | 'en';
  currentPath: string;
}

export default function GlobalSearch({
  locale,
  currentPath,
}: GlobalSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [allData, setAllData] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState<'all' | 'project' | 'link' | 'update'>(
    'all'
  );
  const [isDark, setIsDark] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 檢測深色模式
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };

    checkDarkMode();

    // 監聽主題變化
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  // 當模態框打開時禁用 body 滾動
  useEffect(() => {
    if (isOpen && !isClosing) {
      // 保存當前滾動位置
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
    } else if (!isOpen) {
      // 恢復滾動 - 先獲取保存的位置
      const scrollY = document.body.style.top;
      const scrollPosition = scrollY ? parseInt(scrollY || '0') * -1 : 0;

      // 使用 requestAnimationFrame 確保在同一幀內完成
      requestAnimationFrame(() => {
        // 清除樣式
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';

        // 立即恢復滾動位置（無動畫）
        if (scrollPosition) {
          window.scrollTo({
            top: scrollPosition,
            behavior: 'instant' as ScrollBehavior,
          });
        }
      });
    }
  }, [isOpen, isClosing]);

  // 載入所有可搜索的內容 - 當 locale 改變時重新加載
  useEffect(() => {
    const loadSearchData = async () => {
      try {
        // 使用路徑參數而不是查詢參數
        const apiUrl = `/api/search-${locale}.json`;
        const response = await fetch(apiUrl);
        if (response.ok) {
          const data = await response.json();
          setAllData(data);
        } else {
          console.error('API response not OK:', response.status);
        }
      } catch (error) {
        console.error('Failed to load search data:', error);
      }
    };

    loadSearchData();
  }, [locale]);

  // 搜索邏輯 - 支持雙語搜索
  const filteredResults = useMemo(() => {
    const searchLower = query.toLowerCase();

    // 如果沒有查詢，返回所有資料
    if (!query.trim()) {
      let filtered = allData.filter((item) => item.type !== 'page');
      if (filter !== 'all') {
        filtered = filtered.filter((item) => item.type === filter);
        return filtered.slice(0, 12); // 單一類別顯示最多 12 個
      }

      // 「全部」分類：每個類別至少顯示 4 個，確保類別多樣性
      const projects = filtered
        .filter((item) => item.type === 'project')
        .slice(0, 4);
      const links = filtered.filter((item) => item.type === 'link').slice(0, 4);
      const updates = filtered
        .filter((item) => item.type === 'update')
        .slice(0, 4);

      return [...projects, ...links, ...updates];
    }

    // 有搜尋查詢時：不限制數量，顯示所有匹配結果
    let filtered = allData.filter((item) => {
      // 安全地檢查每個字段
      const titleMatch =
        item.title?.toLowerCase().includes(searchLower) || false;
      const titleZhMatch =
        item.title_zh?.toLowerCase().includes(searchLower) || false;
      const titleEnMatch =
        item.title_en?.toLowerCase().includes(searchLower) || false;
      const descMatch =
        item.description?.toLowerCase().includes(searchLower) || false;
      const descZhMatch =
        item.description_zh?.toLowerCase().includes(searchLower) || false;
      const descEnMatch =
        item.description_en?.toLowerCase().includes(searchLower) || false;
      const tagsMatch =
        item.tags?.some((tag) => tag?.toLowerCase().includes(searchLower)) ||
        false;

      // 匹配任一語言的標題或描述
      return (
        titleMatch ||
        titleZhMatch ||
        titleEnMatch ||
        descMatch ||
        descZhMatch ||
        descEnMatch ||
        tagsMatch
      );
    });

    // 過濾掉頁面類型，只保留實際內容物件
    filtered = filtered.filter((item) => item.type !== 'page');

    if (filter !== 'all') {
      filtered = filtered.filter((item) => item.type === filter);
    }

    // 搜尋時不限制結果數量
    return filtered;
  }, [query, filter, allData]);

  // 鍵盤快捷鍵 (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
      setQuery('');
      setSelectedIndex(0);
    }, 200);
  };

  // 點擊外部關閉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    if (isOpen && !isClosing) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isClosing]);

  // 鍵盤導航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        Math.min(prev + 1, filteredResults.length - 1)
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filteredResults[selectedIndex]) {
      const result = filteredResults[selectedIndex];
      // 連結類型在新視窗開啟
      if (result.type === 'link' && result.url.startsWith('http')) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
        setIsOpen(false);
      } else {
        // 其他類型正常跳轉
        window.location.href = result.url;
      }
    }
  };

  const handleOpen = () => {
    setIsClosing(false);
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const getTypeLabel = (type: string) => {
    const labels = {
      'zh-tw': {
        project: '專案',
        link: '連結',
        update: '動態',
        page: '頁面',
      },
      en: {
        project: 'Project',
        link: 'Link',
        update: 'Update',
        page: 'Page',
      },
    };
    return labels[locale][type as keyof (typeof labels)['zh-tw']] || type;
  };

  const getFilterLabel = (filterType: string) => {
    const labels = {
      'zh-tw': {
        all: '全部',
        project: '專案',
        link: '連結',
        update: '動態',
      },
      en: {
        all: 'All',
        project: 'Projects',
        link: 'Links',
        update: 'Updates',
      },
    };
    return (
      labels[locale][filterType as keyof (typeof labels)['zh-tw']] || filterType
    );
  };

  return (
    <div className="global-search" ref={searchRef}>
      {/* 搜索按鈕 */}
      <button
        onClick={handleOpen}
        className="global-search__trigger"
        aria-label={locale === 'zh-tw' ? '搜尋' : 'Search'}
        type="button"
      >
        <svg
          className="global-search__icon"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <span className="global-search__hint">
          {locale === 'zh-tw' ? '搜尋' : 'Search'}
        </span>
        <kbd className="global-search__kbd">⌘K</kbd>
      </button>

      {/* 搜索模態框 - 使用 Portal 渲染到 body */}
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              className={`global-search__backdrop ${isClosing ? 'closing' : ''}`}
              onClick={handleClose}
              style={{
                zIndex: 99999,
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                backdropFilter: 'blur(4px)',
                pointerEvents: 'auto',
              }}
            />
            <div
              ref={modalRef}
              className={`global-search__modal ${isClosing ? 'closing' : ''}`}
              style={{
                zIndex: 100000,
              }}
            >
              <div
                className="global-search__container"
                style={{
                  background: isDark
                    ? 'rgba(30, 41, 59, 0.98)'
                    : 'rgba(255, 255, 255, 0.98)',
                }}
              >
                <div
                  className="global-search__header"
                  style={{
                    background: isDark
                      ? 'rgba(15, 23, 42, 0.3)'
                      : 'transparent',
                  }}
                >
                  <svg
                    className="global-search__search-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <input
                    ref={inputRef}
                    type="text"
                    className="global-search__input"
                    placeholder={
                      locale === 'zh-tw'
                        ? '搜尋專案、動態、連結...'
                        : 'Search projects, updates, links...'
                    }
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSelectedIndex(0);
                    }}
                    onKeyDown={handleKeyDown}
                    style={{
                      color: isDark ? 'rgb(226, 232, 240)' : 'rgb(15, 23, 42)',
                    }}
                  />
                  <button
                    onClick={handleClose}
                    className="global-search__close"
                    aria-label={locale === 'zh-tw' ? '關閉' : 'Close'}
                    type="button"
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                {/* 篩選器 */}
                <div className="global-search__filters">
                  {(['all', 'project', 'link', 'update'] as const).map(
                    (filterType) => (
                      <button
                        key={filterType}
                        onClick={() => setFilter(filterType)}
                        className={`global-search__filter ${filter === filterType ? 'active' : ''}`}
                        type="button"
                      >
                        {getFilterLabel(filterType)}
                      </button>
                    )
                  )}
                </div>

                {/* 搜索結果 */}
                <div className="global-search__results">
                  {filteredResults.length > 0 ? (
                    filteredResults.map((result, index) => (
                      <a
                        key={result.id}
                        href={result.url}
                        className={`global-search__result ${index === selectedIndex ? 'selected' : ''}`}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={(e) => {
                          // 連結類型直接在新視窗開啟外部連結
                          if (
                            result.type === 'link' &&
                            result.url.startsWith('http')
                          ) {
                            e.preventDefault();
                            window.open(
                              result.url,
                              '_blank',
                              'noopener,noreferrer'
                            );
                            setIsOpen(false);
                          }
                          // 其他類型正常跳轉
                        }}
                        target={
                          result.type === 'link' &&
                          result.url.startsWith('http')
                            ? '_blank'
                            : undefined
                        }
                        rel={
                          result.type === 'link' &&
                          result.url.startsWith('http')
                            ? 'noopener noreferrer'
                            : undefined
                        }
                      >
                        <div className="global-search__result-icon">
                          {result.type === 'project' && (
                            <svg
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                              />
                            </svg>
                          )}
                          {result.type === 'link' && (
                            <svg
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                              />
                            </svg>
                          )}
                          {result.type === 'update' && (
                            <svg
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                              />
                            </svg>
                          )}
                        </div>
                        <div className="global-search__result-content">
                          <div
                            className="global-search__result-title"
                            style={{
                              color: isDark
                                ? 'rgb(226, 232, 240)'
                                : 'rgb(15, 23, 42)',
                            }}
                          >
                            {result.title}
                          </div>
                          {result.description && (
                            <div
                              className="global-search__result-desc"
                              style={{
                                color: isDark
                                  ? 'rgb(148, 163, 184)'
                                  : 'rgb(100, 116, 139)',
                              }}
                            >
                              {result.description}
                            </div>
                          )}
                          {result.tags && result.tags.length > 0 && (
                            <div className="global-search__result-tags">
                              {result.tags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="global-search__tag"
                                  style={{
                                    color: isDark
                                      ? 'rgb(203, 213, 225)'
                                      : 'rgb(71, 85, 105)',
                                  }}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div
                          className="global-search__result-type"
                          style={{
                            color: isDark
                              ? 'rgb(148, 163, 184)'
                              : 'rgb(100, 116, 139)',
                          }}
                        >
                          {getTypeLabel(result.type)}
                        </div>
                      </a>
                    ))
                  ) : (
                    <div className="global-search__empty">
                      <svg
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <p>
                        {locale === 'zh-tw'
                          ? '找不到相關結果'
                          : 'No results found'}
                      </p>
                    </div>
                  )}
                </div>

                {/* 快捷鍵提示 */}
                <div className="global-search__footer">
                  <div className="global-search__shortcuts">
                    <span>
                      <kbd>↑</kbd>
                      <kbd>↓</kbd> {locale === 'zh-tw' ? '導航' : 'Navigate'}
                    </span>
                    <span>
                      <kbd>Enter</kbd> {locale === 'zh-tw' ? '選擇' : 'Select'}
                    </span>
                    <span>
                      <kbd>Esc</kbd> {locale === 'zh-tw' ? '關閉' : 'Close'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
