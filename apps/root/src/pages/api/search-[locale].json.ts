/**
 * Search API Endpoint
 * Returns searchable content for GlobalSearch component
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getTranslations } from '../../i18n/utils';

export function getStaticPaths() {
  return [{ params: { locale: 'zh-tw' } }, { params: { locale: 'en' } }];
}

export const GET: APIRoute = async ({ params }) => {
  const locale = params.locale || 'zh-tw';

  try {
    // 載入所有內容集合
    const [projects, links, updates] = await Promise.all([
      getCollection('projects'),
      getCollection('links'),
      getCollection('updates'),
    ]);

    const searchData = [];

    // 處理專案
    for (const project of projects) {
      // 優先使用 title_zh 欄位，若無則使用檔名（project.id）
      const titleZh = project.data.title_zh || project.id;
      const titleEn = project.data.title_en || project.id;

      searchData.push({
        id: `project-${project.id}`,
        type: 'project',
        title: locale === 'zh-tw' ? titleZh : titleEn,
        title_zh: titleZh,
        title_en: titleEn,
        description:
          locale === 'zh-tw'
            ? project.data.description_zh
            : project.data.description_en,
        description_zh: project.data.description_zh || '',
        description_en: project.data.description_en || '',
        url: `/${locale}/projects/${project.id}`,
        category: project.data.status,
        tags: project.data.tags || [],
        date: project.data.startDate?.toISOString(),
        slug: project.id,
      });
    }

    // 處理連結
    for (const link of links) {
      // 優先使用 title_zh 欄位，若無則使用檔名（link.id）
      const titleZh = link.data.title_zh || link.id;
      const titleEn = link.data.title_en || link.id;

      searchData.push({
        id: `link-${link.id}`,
        type: 'link',
        title: locale === 'zh-tw' ? titleZh : titleEn,
        title_zh: titleZh,
        title_en: titleEn,
        description:
          locale === 'zh-tw'
            ? link.data.description_zh
            : link.data.description_en,
        description_zh: link.data.description_zh || '',
        description_en: link.data.description_en || '',
        url: link.data.url, // 連結直接使用原始 URL
        category: link.data.category,
        tags: [],
        slug: link.id,
      });
    }

    // 處理動態
    for (const update of updates) {
      // 優先使用 title_zh 欄位，若無則使用檔名（update.id）
      const titleZh = update.data.title_zh || update.id;
      const titleEn = update.data.title_en || update.id;

      searchData.push({
        id: `update-${update.id}`,
        type: 'update',
        title: locale === 'zh-tw' ? titleZh : titleEn,
        title_zh: titleZh,
        title_en: titleEn,
        description:
          locale === 'zh-tw'
            ? update.data.description_zh
            : update.data.description_en,
        description_zh: update.data.description_zh || '',
        description_en: update.data.description_en || '',
        url: `/${locale}/updates/${update.id}`,
        category: update.data.category,
        tags: [],
        date: update.data.date.toISOString(),
        slug: update.id,
      });
    }

    // 添加主要頁面
    const t = getTranslations(locale as 'zh-tw' | 'en');
    searchData.push(
      {
        id: 'page-home',
        type: 'page',
        title: t.search.pages.home.title,
        description: t.search.pages.home.description,
        url: `/${locale}/`,
        category: 'main',
      },
      {
        id: 'page-about',
        type: 'page',
        title: t.search.pages.about.title,
        description: t.search.pages.about.description,
        url: `/${locale}/about`,
        category: 'main',
      },
      {
        id: 'page-projects',
        type: 'page',
        title: t.search.pages.projects.title,
        description: t.search.pages.projects.description,
        url: `/${locale}/projects`,
        category: 'main',
      },
      {
        id: 'page-links',
        type: 'page',
        title: t.search.pages.links.title,
        description: t.search.pages.links.description,
        url: `/${locale}/links`,
        category: 'main',
      },
      {
        id: 'page-updates',
        type: 'page',
        title: t.search.pages.updates.title,
        description: t.search.pages.updates.description,
        url: `/${locale}/updates`,
        category: 'main',
      }
    );

    return new Response(JSON.stringify(searchData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache', // 開發時不緩存，方便測試
      },
    });
  } catch (error) {
    console.error('Error loading search data:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load search data' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};
