import { useState, useMemo } from 'react';
import './SearchFilter.css';

export interface FilterOption {
  label: string;
  value: string;
  count?: number;
}

export interface SearchFilterProps {
  /** 可搜尋的項目 */
  items: any[];
  /** 搜尋欄位 */
  searchFields: string[];
  /** 篩選分類 */
  filterCategories?: {
    key: string;
    label: string;
    options: FilterOption[];
  }[];
  /** 搜尋占位文字 */
  searchPlaceholder?: string;
  /** 無結果文字 */
  noResultsText?: string;
  /** 渲染項目的函數 */
  renderItem: (item: any, index: number) => React.ReactNode;
  /** 預設排序 */
  defaultSort?: 'asc' | 'desc' | 'none';
  /** 排序選項 */
  sortOptions?: { label: string; value: string }[];
}

export default function SearchFilter({
  items,
  searchFields,
  filterCategories = [],
  searchPlaceholder = '搜尋...',
  noResultsText = '沒有找到符合的項目',
  renderItem,
  defaultSort = 'none',
  sortOptions = [],
}: SearchFilterProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>(
    {}
  );
  const [sortBy, setSortBy] = useState<string>(defaultSort);

  // 篩選和搜尋邏輯
  const filteredItems = useMemo(() => {
    let results = [...items];

    // 應用搜尋
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      results = results.filter((item) => {
        return searchFields.some((field) => {
          const value = getNestedValue(item, field);
          return value && String(value).toLowerCase().includes(query);
        });
      });
    }

    // 應用篩選
    Object.entries(activeFilters).forEach(([key, value]) => {
      if (value && value !== 'all') {
        results = results.filter((item) => {
          const itemValue = getNestedValue(item, key);
          return itemValue === value;
        });
      }
    });

    // 應用排序
    if (sortBy !== 'none' && sortOptions.length > 0) {
      const sortOption = sortOptions.find((opt) => opt.value === sortBy);
      if (sortOption) {
        results.sort((a, b) => {
          const aValue = getNestedValue(a, sortOption.value);
          const bValue = getNestedValue(b, sortOption.value);
          return aValue > bValue ? 1 : -1;
        });
      }
    }

    return results;
  }, [items, searchQuery, activeFilters, sortBy, searchFields, sortOptions]);

  const handleFilterChange = (category: string, value: string) => {
    setActiveFilters((prev) => ({
      ...prev,
      [category]: value,
    }));
  };

  const clearFilters = () => {
    setSearchQuery('');
    setActiveFilters({});
    setSortBy(defaultSort);
  };

  const hasActiveFilters =
    searchQuery || Object.values(activeFilters).some((v) => v && v !== 'all');

  return (
    <div className="search-filter">
      {/* 搜尋和控制列 */}
      <div className="search-filter__controls">
        {/* 搜尋框 */}
        <div className="search-filter__search-box">
          <svg
            className="search-filter__search-icon"
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
            type="text"
            className="search-filter__input"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="search-filter__clear-btn"
              onClick={() => setSearchQuery('')}
              aria-label="清除搜尋"
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
          )}
        </div>

        {/* 排序 */}
        {sortOptions.length > 0 && (
          <select
            className="search-filter__sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="none">預設排序</option>
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}

        {/* 清除按鈕 */}
        {hasActiveFilters && (
          <button
            className="search-filter__reset-btn"
            onClick={clearFilters}
            type="button"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            清除篩選
          </button>
        )}
      </div>

      {/* 篩選分類 */}
      {filterCategories.length > 0 && (
        <div className="search-filter__categories">
          {filterCategories.map((category) => (
            <div key={category.key} className="search-filter__category">
              <label className="search-filter__category-label">
                {category.label}
              </label>
              <div className="search-filter__options">
                <button
                  className={`search-filter__option ${!activeFilters[category.key] || activeFilters[category.key] === 'all' ? 'active' : ''}`}
                  onClick={() => handleFilterChange(category.key, 'all')}
                  type="button"
                >
                  全部
                </button>
                {category.options.map((option) => (
                  <button
                    key={option.value}
                    className={`search-filter__option ${activeFilters[category.key] === option.value ? 'active' : ''}`}
                    onClick={() =>
                      handleFilterChange(category.key, option.value)
                    }
                    type="button"
                  >
                    {option.label}
                    {option.count !== undefined && (
                      <span className="search-filter__count">
                        ({option.count})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 結果統計 */}
      <div className="search-filter__stats">
        顯示 {filteredItems.length} / {items.length} 個項目
      </div>

      {/* 結果列表 */}
      <div className="search-filter__results">
        {filteredItems.length > 0 ? (
          filteredItems.map((item, index) => renderItem(item, index))
        ) : (
          <div className="search-filter__no-results">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p>{noResultsText}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// 輔助函數：取得嵌套物件的值
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}
