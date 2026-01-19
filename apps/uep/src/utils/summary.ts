import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface NavigationItem {
  title: string;
  path?: string;
  children?: NavigationItem[];
  level: number;
  id?: string;
}

export interface PageRoute {
  slug: string[];
  filePath: string;
  title: string;
}

/**
 * 解析 SUMMARY.md 內容生成導航樹
 */
export function parseSummary(summaryContent: string): NavigationItem[] {
  const lines = summaryContent.split('\n');
  const navigation: NavigationItem[] = [];
  const stack: NavigationItem[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // 匹配列表項: * [標題](路徑) 或 * [標題](<路徑>)
    const listMatch = line.match(/^(\s*)\* \[([^\]]+)\]\(<?([^>)]+)>?\)/);
    // 匹配標題: ## 標題 <a href="#id" id="id"></a>
    let headingMatch = null;
    if (line.startsWith('##') && line.includes('<a')) {
      const titleMatch = line.match(/^##\s+(.+?)\s+<a/);
      const idMatch = line.match(/id="([^"]+)"/);
      if (titleMatch && idMatch) {
        headingMatch = [line, titleMatch[1], idMatch[1]];
      }
    }

    if (listMatch) {
      const [, indent, title, path] = listMatch;
      const level = indent.length / 2; // 2 spaces per level
      
      const item: NavigationItem = {
        title,
        path: path.trim(),
        level,
        children: []
      };

      // 找到父節點
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        navigation.push(item);
      } else {
        const parent = stack[stack.length - 1];
        if (!parent.children) parent.children = [];
        parent.children.push(item);
      }

      stack.push(item);
    } else if (headingMatch) {
      const [, title, id] = headingMatch;
      const level = -1; // heading 的 level 設為 -1，確保列表項（level 0）會成為它的子項
      
      const item: NavigationItem = {
        title: title.trim(),
        id: id || title.trim().toLowerCase(),
        level,
        children: []
      };

      navigation.push(item);
      stack.length = 0; // 清空 stack
      stack.push(item);
    }
  }

  return navigation;
}

/**
 * 從導航樹中提取所有路由路徑
 */
export function extractRoutes(navigation: NavigationItem[], baseDir = 'content'): PageRoute[] {
  const routes: PageRoute[] = [];

  function traverse(items: NavigationItem[], parentPath: string[] = []) {
    for (const item of items) {
      if (item.path) {
        // 移除 .md 擴展名並分割路徑
        const cleanPath = item.path.replace(/\.md$/, '');
        const pathParts = cleanPath.split('/').filter(Boolean);
        
        routes.push({
          slug: pathParts,
          filePath: join(baseDir, item.path),
          title: item.title
        });
      }

      if (item.children && item.children.length > 0) {
        traverse(item.children, parentPath);
      }
    }
  }

  traverse(navigation);
  return routes;
}

/**
 * 讀取並解析 SUMMARY.md
 */
export function loadSummary(contentDir: string) {
  const summaryPath = join(contentDir, 'SUMMARY.md');
  const content = readFileSync(summaryPath, 'utf-8');
  return parseSummary(content);
}

/**
 * 根據路由路徑尋找對應的導航項
 */
export function findNavigationItem(
  navigation: NavigationItem[],
  targetPath: string
): NavigationItem | null {
  function search(items: NavigationItem[]): NavigationItem | null {
    for (const item of items) {
      if (item.path === targetPath) {
        return item;
      }
      if (item.children) {
        const found = search(item.children);
        if (found) return found;
      }
    }
    return null;
  }

  return search(navigation);
}

/**
 * 提取某個區域的直接子頁面（只包含該區域下的頁面，不包含子目錄）
 */
export function extractDirectChildren(
  navigation: NavigationItem[],
  areaId: string
): PageRoute[] {
  const routes: PageRoute[] = [];

  // 找到對應區域的導航項
  const areaSection = navigation.find(item => item.id === areaId);
  
  if (!areaSection || !areaSection.children) {
    return routes;
  }

  // 遍歷該區域的所有子項
  function collectPages(items: NavigationItem[], depth: number = 0) {
    for (const item of items) {
      if (item.path) {
        const cleanPath = item.path.replace(/\.md$/, '');
        const pathParts = cleanPath.split('/').filter(Boolean);
        
        routes.push({
          slug: pathParts,
          filePath: join('content', item.path),
          title: item.title
        });
      }

      // 遞迴處理子項
      if (item.children && item.children.length > 0) {
        collectPages(item.children, depth + 1);
      }
    }
  }

  collectPages(areaSection.children);
  return routes;
}
