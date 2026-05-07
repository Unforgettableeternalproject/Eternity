/**
 * 內容渲染系統 - 三層架構
 *
 * Layer 1: 原始文檔（子模組，只讀）
 * Layer 2: 二次設計層（文字區段、排版控制）
 * Layer 3: 外層元件（附件、音樂播放器、互動元件）
 */

export interface ContentBlock {
  type: 'text' | 'heading' | 'image' | 'code' | 'quote' | 'divider';
  content: string;
  level?: number; // for headings
  language?: string; // for code blocks
  metadata?: Record<string, any>;
}

export interface ContentSection {
  id: string;
  blocks: ContentBlock[];
  // Layer 2: 可以在區段間插入內容
  beforeInsert?: string[]; // 要插入的元件 ID
  afterInsert?: string[]; // 要插入的元件 ID
}

export interface EnhancedContent {
  // Layer 1: 原始內容
  rawSections: ContentSection[];

  // Layer 2: 設計層配置
  layout?: {
    style?: string; // 區域特定樣式
    columns?: number;
    spacing?: 'compact' | 'normal' | 'relaxed';
  };

  // Layer 3: 外層元件
  components?: {
    id: string;
    type: 'attachment' | 'audio' | 'video' | 'custom';
    props: Record<string, any>;
    position: 'before' | 'after' | 'float';
  }[];
}

/**
 * 解析原始 Markdown 為內容區塊
 * 根據空行分割成不同區段
 */
export function parseMarkdownToSections(markdown: string): ContentSection[] {
  const sections: ContentSection[] = [];
  const lines = markdown.split('\n');

  let currentBlocks: ContentBlock[] = [];
  let sectionIndex = 0;
  let emptyLineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 檢測空行
    if (!line.trim()) {
      emptyLineCount++;
      // 連續兩個以上空行視為區段分隔
      if (emptyLineCount >= 2 && currentBlocks.length > 0) {
        sections.push({
          id: `section-${sectionIndex++}`,
          blocks: currentBlocks,
        });
        currentBlocks = [];
      }
      continue;
    }

    emptyLineCount = 0;

    // 解析不同類型的內容
    const block = parseLineToBlock(line, lines, i);
    if (block) {
      currentBlocks.push(block);
      // 如果是多行區塊，跳過已處理的行
      if (block.metadata?.linesToSkip) {
        i += block.metadata.linesToSkip;
      }
    }
  }

  // 添加最後一個區段
  if (currentBlocks.length > 0) {
    sections.push({
      id: `section-${sectionIndex}`,
      blocks: currentBlocks,
    });
  }

  return sections;
}

/**
 * 將單行解析為內容塊
 */
function parseLineToBlock(
  line: string,
  allLines: string[],
  currentIndex: number
): ContentBlock | null {
  // 標題
  const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (headingMatch) {
    return {
      type: 'heading',
      content: headingMatch[2],
      level: headingMatch[1].length,
    };
  }

  // 分隔線
  if (line.match(/^(-{3,}|\*{3,}|_{3,})$/)) {
    return {
      type: 'divider',
      content: '',
    };
  }

  // 程式碼區塊
  if (line.startsWith('```')) {
    const language = line.slice(3).trim();
    const codeLines: string[] = [];
    let endIndex = currentIndex + 1;

    while (
      endIndex < allLines.length &&
      !allLines[endIndex].startsWith('```')
    ) {
      codeLines.push(allLines[endIndex]);
      endIndex++;
    }

    return {
      type: 'code',
      content: codeLines.join('\n'),
      language: language || 'text',
      metadata: { linesToSkip: endIndex - currentIndex },
    };
  }

  // 引用
  if (line.startsWith('> ')) {
    return {
      type: 'quote',
      content: line.slice(2),
    };
  }

  // 圖片
  const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (imageMatch) {
    return {
      type: 'image',
      content: imageMatch[2],
      metadata: { alt: imageMatch[1] },
    };
  }

  // 一般文字
  return {
    type: 'text',
    content: line,
  };
}

/**
 * 為特定區域應用樣式配置
 */
export function applyAreaStyle(
  areaId: string,
  content: EnhancedContent
): EnhancedContent {
  const areaStyles: Record<string, any> = {
    history: {
      layout: {
        style: 'narrative',
        spacing: 'relaxed',
      },
    },
    echos: {
      layout: {
        style: 'gallery',
        columns: 2,
      },
    },
    concepts: {
      layout: {
        style: 'documentation',
        spacing: 'compact',
      },
    },
    visuals: {
      layout: {
        style: 'showcase',
        columns: 3,
      },
    },
    storage: {
      layout: {
        style: 'casual',
        spacing: 'normal',
      },
    },
  };

  return {
    ...content,
    layout: areaStyles[areaId]?.layout || { spacing: 'normal' },
  };
}
