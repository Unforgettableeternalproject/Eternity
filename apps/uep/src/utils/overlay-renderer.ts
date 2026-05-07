import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { transformGitBookContent } from './markdown-transforms';

// import.meta.glob gracefully returns {} when the content directory is missing.
const contentModules = import.meta.glob('../../content/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const overlayModules = import.meta.glob('../overlays/**/*.json', {
  import: 'default',
  eager: true,
}) as Record<string, OverlayConfig>;

function normalizeContentPath(contentPath: string) {
  return contentPath
    .replace(/\\/g, '/')
    .replace(/^content\//, '')
    .replace(/^\.\//, '');
}

// Markdown pipeline for block-level rendering.
const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify);

export interface Block {
  content: string;
  type: 'normal' | 'boundary-wrapped' | 'divider';
  html?: string;
}

export interface OverlayRule {
  blockIndex?: number;
  type: string;
  pattern?: string;
  variant?: string;
  color?: string;
  hintType?: string;
}

export interface OverlayConfig {
  version: string;
  rules: OverlayRule[];
}

export interface ParsedContent {
  metadata: Record<string, string>;
  blocks: Block[];
  title: string;
  description?: string;
}

/**
 * Parse Markdown content into blocks and metadata.
 */
export async function parseMarkdownContent(
  rawContent: string
): Promise<ParsedContent> {
  // Extract frontmatter key/value pairs.
  const frontmatterMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const metadata: Record<string, string> = {};

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    frontmatter.split(/\r?\n/).forEach((line) => {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        metadata[key] = value;
      }
    });
  }

  // Strip frontmatter from the content body.
  const withoutFrontmatter = rawContent.replace(
    /^---\r?\n[\s\S]*?\r?\n---\r?\n/,
    ''
  );

  // Replace long divider lines (U+2747 + U+FE0E repeated) with a marker token.
  const withBoundaryMarkers = withoutFrontmatter.replace(
    /\r?\n((?:\u2747\uFE0E){10,})\r?\n/g,
    '\n\n\n\n<<<BOUNDARY>>>\n\n\n\n'
  );

  // Split by 4+ newlines to keep block boundaries stable.
  const rawBlocks = withBoundaryMarkers
    .split(/(?:\r?\n){4,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  // Expand boundary markers into block types.
  const blocks: Block[] = [];
  let i = 0;

  while (i < rawBlocks.length) {
    const current = rawBlocks[i];

    if (current === '<<<BOUNDARY>>>') {
      // Two markers wrap a content block; one marker is a divider.
      if (i + 2 < rawBlocks.length && rawBlocks[i + 2] === '<<<BOUNDARY>>>') {
        blocks.push({
          content: rawBlocks[i + 1],
          type: 'boundary-wrapped',
        });
        i += 3;
      } else {
        blocks.push({
          content: '',
          type: 'divider',
        });
        i += 1;
      }
    } else {
      blocks.push({
        content: current,
        type: 'normal',
      });
      i += 1;
    }
  }

  // Convert GitBook-specific content to Astro-friendly Markdown.
  const transformedBlocks = blocks.map((b) => ({
    ...b,
    content: b.content ? transformGitBookContent(b.content) : '',
  }));

  // Render Markdown into HTML.
  const htmlBlocks = await Promise.all(
    transformedBlocks.map(async (block) => {
      if (!block.content) return { ...block, html: '' };
      const result = await markdownProcessor.process(block.content);
      return {
        ...block,
        html: String(result),
      };
    })
  );

  // Use the first <h1> as title; fall back to metadata description or default.
  let title = metadata.description || 'Untitled';
  const firstBlock = htmlBlocks.find((b) => b.html && b.html.includes('<h1>'));
  if (firstBlock) {
    const match = firstBlock.html?.match(/<h1[^>]*>(.*?)<\/h1>/);
    if (match) {
      title = match[1].replace(/<[^>]*>/g, '');
    }
  }

  return {
    metadata,
    blocks: htmlBlocks,
    title,
    description: metadata.description,
  };
}

/**
 * Load overlay configuration for a content path.
 */
export function loadOverlayConfig(contentPath: string): OverlayConfig | null {
  const normalized = normalizeContentPath(contentPath).replace(
    /\.md$/,
    '.json'
  );
  return overlayModules[`../overlays/${normalized}`] || null;
}

/**
 * Attach overlay rules to matching blocks.
 */
export function applyOverlayRules(
  blocks: Block[],
  overlayConfig: OverlayConfig | null
): Block[] {
  if (!overlayConfig || !overlayConfig.rules) {
    return blocks;
  }

  return blocks.map((block, index) => {
    const rules = overlayConfig.rules.filter(
      (rule) => rule.blockIndex === undefined || rule.blockIndex === index
    );

    return {
      ...block,
      overlayRules: rules,
    };
  });
}

/**
 * Render an article and apply its overlay rules.
 */
export async function renderArticleWithOverlay(contentPath: string): Promise<{
  content: ParsedContent;
  overlayConfig: OverlayConfig | null;
  blocksWithOverlay: Block[];
}> {
  const normalized = normalizeContentPath(contentPath);
  const rawContent = contentModules[`../../content/${normalized}`];

  if (!rawContent) {
    throw new Error(`Content file not found: ${contentPath}`);
  }

  const content = await parseMarkdownContent(rawContent);
  const overlayConfig = loadOverlayConfig(normalized);
  const blocksWithOverlay =
    content.blocks && content.blocks.length > 0
      ? applyOverlayRules(content.blocks, overlayConfig)
      : [];

  return {
    content,
    overlayConfig,
    blocksWithOverlay,
  };
}
