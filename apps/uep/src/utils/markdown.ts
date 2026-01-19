import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

/**
 * 解析 frontmatter 並返回內容和 metadata
 */
export function parseFrontmatter(content: string): {
  content: string;
  frontmatter: Record<string, any>;
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { content, frontmatter: {} };
  }

  const frontmatterText = match[1];
  const mainContent = match[2];
  const frontmatter: Record<string, any> = {};

  frontmatterText.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  });

  return { content: mainContent, frontmatter };
}

/**
 * 將 Markdown 轉換為 HTML
 */
export async function markdownToHtml(markdown: string): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: 'wrap',
      properties: {
        className: ['heading-link']
      }
    })
    .use(rehypeStringify, { allowDangerousHtml: true });

  const result = await processor.process(markdown);
  return String(result);
}
