/**
 * 內容處理器（Content Processor）
 * 
 * 實現四層式渲染架構：
 * 1. 原始層：讀取原始 Markdown 文件
 * 2. 設計層：應用 GitBook → Astro 語法轉換
 * 3. 覆蓋層：應用使用者配置的段落增強
 * 4. 元件層：生成最終 HTML
 */

import type {
  OverlayConfig,
  ParagraphNode,
  ParagraphRule,
  RenderContext,
} from '../types/overlay.types';
import { transformGitBookContent } from './markdown-transforms';

/**
 * 段落分割器
 * 將 Markdown 內容按空行分割成段落
 */
export function splitIntoParagraphs(content: string): string[] {
  // 移除 frontmatter
  const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');
  
  // 按照兩個或多個換行符分割（段落間的空行）
  const paragraphs = withoutFrontmatter
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
  
  return paragraphs;
}

/**
 * 段落選擇器匹配
 * 判斷段落是否符合選擇器條件
 */
export function matchSelector(
  paragraph: string,
  index: number,
  rule: ParagraphRule
): boolean {
  const { selector } = rule;
  
  // 索引匹配
  if (selector.index !== undefined) {
    return index === selector.index;
  }
  
  // 範圍匹配 "3-5"
  if (selector.range) {
    const [start, end] = selector.range.split('-').map(Number);
    return index >= start && index <= end;
  }
  
  // 內容開頭匹配
  if (selector.startsWith) {
    return paragraph.startsWith(selector.startsWith);
  }
  
  // 內容包含匹配
  if (selector.contains) {
    return paragraph.includes(selector.contains);
  }
  
  return false;
}

/**
 * 應用段落規則
 * 將配置規則應用到段落節點
 */
export function applyRulesToParagraphs(
  paragraphs: string[],
  rules?: ParagraphRule[]
): ParagraphNode[] {
  if (!rules || rules.length === 0) {
    // 沒有規則時，返回正常的段落節點
    return paragraphs.map((content, index) => ({
      index,
      content,
      hidden: false,
    }));
  }
  
  const nodes: ParagraphNode[] = [];
  
  paragraphs.forEach((content, index) => {
    const node: ParagraphNode = {
      index,
      content,
      hidden: false,
    };
    
    // 查找匹配的規則
    const matchedRule = rules.find(rule => 
      matchSelector(content, index, rule)
    );
    
    if (matchedRule) {
      node.appliedRule = matchedRule;
      
      // 根據操作類型處理
      switch (matchedRule.action) {
        case 'hide':
          node.hidden = true;
          break;
          
        case 'insertBefore':
          if (matchedRule.content) {
            node.insertBefore = matchedRule.content;
          }
          break;
          
        case 'insertAfter':
          if (matchedRule.content) {
            node.insertAfter = matchedRule.content;
          }
          break;
          
        case 'replace':
          if (matchedRule.replacement) {
            node.content = matchedRule.replacement;
          }
          break;
          
        // wrap 和 normal 在渲染時處理
      }
    }
    
    nodes.push(node);
  });
  
  return nodes;
}

/**
 * 渲染段落節點為 Markdown
 * 將處理後的段落節點轉換回 Markdown 格式
 */
export function renderParagraphNode(node: ParagraphNode): string {
  if (node.hidden) {
    return '';
  }
  
  const parts: string[] = [];
  
  // 前置插入
  if (node.insertBefore) {
    parts.push(node.insertBefore);
  }
  
  // 主要內容
  let content = node.content;
  
  // 如果有包裝規則
  if (node.appliedRule?.action === 'wrap' && node.appliedRule.wrap) {
    const { component, props } = node.appliedRule.wrap;
    const propsStr = props 
      ? Object.entries(props)
          .map(([key, value]) => `${key}="${value}"`)
          .join(' ')
      : '';
    
    content = `<${component}${propsStr ? ' ' + propsStr : ''}>\n${content}\n</${component}>`;
  }
  
  parts.push(content);
  
  // 後置插入
  if (node.insertAfter) {
    parts.push(node.insertAfter);
  }
  
  return parts.join('\n\n');
}

/**
 * 處理 Markdown 內容
 * 完整的四層處理流程
 */
export function processContent(
  rawContent: string,
  overlay?: OverlayConfig
): string {
  // 檢查配置是否啟用
  if (overlay && overlay.enabled === false) {
    // 僅應用設計層轉換
    return transformGitBookContent(rawContent);
  }
  
  // 第一層：原始內容（已由調用方讀取）
  
  // 分割段落
  const paragraphs = splitIntoParagraphs(rawContent);
  
  // 第三層：應用覆蓋層配置
  const nodes = applyRulesToParagraphs(paragraphs, overlay?.paragraphRules);
  
  // 渲染段落節點
  const enhancedMarkdown = nodes
    .map(renderParagraphNode)
    .filter(p => p.length > 0)
    .join('\n\n');
  
  // 第二層：應用設計層轉換（GitBook → Astro）
  const transformedContent = transformGitBookContent(enhancedMarkdown);
  
  return transformedContent;
}

/**
 * 創建渲染上下文
 */
export function createRenderContext(
  filePath: string,
  rawContent: string,
  overlay?: OverlayConfig
): RenderContext {
  const paragraphs = applyRulesToParagraphs(
    splitIntoParagraphs(rawContent),
    overlay?.paragraphRules
  );
  
  return {
    filePath,
    overlay,
    paragraphs,
  };
}
