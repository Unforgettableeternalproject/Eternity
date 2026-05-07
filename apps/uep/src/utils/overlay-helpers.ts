/**
 * 覆蓋層配置輔助工具
 *
 * 提供配置文件的讀取、驗證和查找功能
 */

import type { OverlayConfig } from '../types/overlay.types';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 根據內容文件路徑獲取對應的覆蓋層配置文件路徑
 *
 * 例如：
 * content/history/passage/arc.md
 * → overlays/history/passage/arc.json
 */
export function getOverlayPath(contentPath: string): string {
  // 移除 content/ 前綴，替換為 overlays/
  const relativePath = contentPath
    .replace(/^content\//, 'overlays/')
    .replace(/\.mdoc?$/, '.json');

  return relativePath;
}

/**
 * 載入覆蓋層配置
 *
 * @param contentPath - 內容文件的相對路徑（相對於 apps/uep/）
 * @param projectRoot - 專案根目錄絕對路徑
 * @returns 覆蓋層配置，如果不存在則返回 undefined
 */
export function loadOverlayConfig(
  contentPath: string,
  projectRoot: string
): OverlayConfig | undefined {
  try {
    const overlayPath = getOverlayPath(contentPath);
    const fullPath = path.join(projectRoot, 'src', overlayPath);

    // 檢查文件是否存在
    if (!fs.existsSync(fullPath)) {
      return undefined;
    }

    // 讀取並解析 JSON
    const content = fs.readFileSync(fullPath, 'utf-8');
    const config = JSON.parse(content) as OverlayConfig;

    // 驗證配置
    if (!validateOverlayConfig(config)) {
      console.warn(`[Overlay] 配置文件格式錯誤: ${overlayPath}`);
      return undefined;
    }

    return config;
  } catch (error) {
    console.error(`[Overlay] 載入配置失敗: ${contentPath}`, error);
    return undefined;
  }
}

/**
 * 驗證覆蓋層配置格式
 */
export function validateOverlayConfig(config: any): config is OverlayConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }

  // 檢查版本
  if (config.version !== '1.0') {
    console.warn('[Overlay] 不支援的配置版本:', config.version);
    return false;
  }

  // 檢查段落規則格式
  if (config.paragraphRules && !Array.isArray(config.paragraphRules)) {
    return false;
  }

  return true;
}

/**
 * 創建覆蓋層配置模板
 */
export function createOverlayTemplate(description?: string): OverlayConfig {
  return {
    version: '1.0',
    description: description || '覆蓋層配置',
    enabled: true,
    paragraphRules: [],
    metadata: {},
  };
}

/**
 * 保存覆蓋層配置
 *
 * @param contentPath - 內容文件的相對路徑
 * @param config - 配置對象
 * @param projectRoot - 專案根目錄絕對路徑
 */
export function saveOverlayConfig(
  contentPath: string,
  config: OverlayConfig,
  projectRoot: string
): boolean {
  try {
    const overlayPath = getOverlayPath(contentPath);
    const fullPath = path.join(projectRoot, 'src', overlayPath);

    // 確保目錄存在
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });

    // 寫入 JSON（格式化）
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(fullPath, content, 'utf-8');

    console.log(`[Overlay] 配置已保存: ${overlayPath}`);
    return true;
  } catch (error) {
    console.error(`[Overlay] 保存配置失敗: ${contentPath}`, error);
    return false;
  }
}

/**
 * 查找所有覆蓋層配置文件
 *
 * @param projectRoot - 專案根目錄絕對路徑
 * @returns 配置文件路徑列表
 */
export function findAllOverlays(projectRoot: string): string[] {
  const overlaysDir = path.join(projectRoot, 'src', 'overlays');

  if (!fs.existsSync(overlaysDir)) {
    return [];
  }

  const files: string[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }

  walk(overlaysDir);
  return files;
}
