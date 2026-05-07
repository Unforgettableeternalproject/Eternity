/**
 * 覆蓋層（Overlay Layer）類型定義
 *
 * 用於定義非侵入式內容增強配置
 * 允許在不修改原始文件的情況下控制渲染效果
 */

/**
 * 組件包裝配置
 */
export interface ComponentWrap {
  /** 組件名稱 */
  component: 'Spoiler' | 'Hint' | 'Mark' | 'Divider' | 'AudioPlayer' | string;
  /** 組件屬性 */
  props?: Record<string, any>;
}

/**
 * 段落操作類型
 */
export type ParagraphAction =
  | 'normal' // 正常渲染
  | 'wrap' // 用組件包裝
  | 'insertBefore' // 在段落前插入內容
  | 'insertAfter' // 在段落後插入內容
  | 'replace' // 替換段落內容
  | 'hide'; // 隱藏段落

/**
 * 段落識別方式
 */
export interface ParagraphSelector {
  /** 段落索引（從 0 開始） */
  index?: number;
  /** 索引範圍 "3-5" */
  range?: string;
  /** 內容匹配（前 N 個字符） */
  startsWith?: string;
  /** 內容包含 */
  contains?: string;
}

/**
 * 段落配置規則
 */
export interface ParagraphRule {
  /** 段落選擇器 */
  selector: ParagraphSelector;
  /** 操作類型 */
  action: ParagraphAction;
  /** 組件包裝配置（當 action 為 wrap 時） */
  wrap?: ComponentWrap;
  /** 插入的內容（當 action 為 insert* 時） */
  content?: string;
  /** 替換的內容（當 action 為 replace 時） */
  replacement?: string;
}

/**
 * 全局樣式覆蓋
 */
export interface StyleOverride {
  /** CSS 類名 */
  className?: string;
  /** 內聯樣式 */
  style?: Record<string, string>;
}

/**
 * 文件覆蓋層配置
 */
export interface OverlayConfig {
  /** 配置版本 */
  version: '1.0';
  /** 配置描述 */
  description?: string;
  /** 是否啟用此配置 */
  enabled?: boolean;
  /** 段落規則列表 */
  paragraphRules?: ParagraphRule[];
  /** 全局樣式覆蓋 */
  styleOverrides?: StyleOverride;
  /** 自定義元數據 */
  metadata?: Record<string, any>;
}

/**
 * 段落節點（解析後的中間格式）
 */
export interface ParagraphNode {
  /** 段落索引 */
  index: number;
  /** 原始內容 */
  content: string;
  /** 應用的規則 */
  appliedRule?: ParagraphRule;
  /** 是否被隱藏 */
  hidden: boolean;
  /** 前置插入內容 */
  insertBefore?: string;
  /** 後置插入內容 */
  insertAfter?: string;
}

/**
 * 渲染上下文
 */
export interface RenderContext {
  /** 原始文件路徑 */
  filePath: string;
  /** 覆蓋層配置 */
  overlay?: OverlayConfig;
  /** 段落節點列表 */
  paragraphs: ParagraphNode[];
}
