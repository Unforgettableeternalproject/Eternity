/**
 * Search API Endpoint
 * Returns searchable content for GlobalSearch component
 * Now reads from D1 API instead of Keystatic
 */
import type { APIRoute } from 'astro';
import { getProjects, getLinks, getUpdates } from '../../lib/api';
import { getTranslations } from '../../i18n/utils';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const locale = params.locale || 'zh-tw';

  try {
    // 從 D1 API 載入所有內容
    const [projects, links, updates] = await Promise.all([
      getProjects(),
      getLinks(),
      getUpdates(),
    ]);

    const searchData = [];

    // 處理專案
    for (const project of projects) {
      const titleZh = project.titleZh || project.id;
      const titleEn = project.titleEn || project.id;

      searchData.push({
        id: `project-${project.id}`,
        type: 'project',
        title: locale === 'zh-tw' ? titleZh : titleEn,
        title_zh: titleZh,
        title_en: titleEn,
        description: locale === 'zh-tw' ? project.descZh : project.descEn,
        description_zh: project.descZh || '',
        description_en: project.descEn || '',
        url: `/${locale}/projects/${project.id}`,
        category: project.status,
        tags: project.tags || [],
        date: project.startDate || undefined,
        slug: project.id,
      });
    }

    // 處理連結
    for (const link of links) {
      const titleZh = link.titleZh || link.id;
      const titleEn = link.titleEn || link.id;

      searchData.push({
        id: `link-${link.id}`,
        type: 'link',
        title: locale === 'zh-tw' ? titleZh : titleEn,
        title_zh: titleZh,
        title_en: titleEn,
        description: locale === 'zh-tw' ? link.descZh : link.descEn,
        description_zh: link.descZh || '',
        description_en: link.descEn || '',
        url: link.url, // 連結直接使用原始 URL
        category: link.category,
        tags: [],
        slug: link.id,
      });
    }

    // 處理動態
    for (const update of updates) {
      const titleZh = update.titleZh || update.id;
      const titleEn = update.titleEn || update.id;

      searchData.push({
        id: `update-${update.id}`,
        type: 'update',
        title: locale === 'zh-tw' ? titleZh : titleEn,
        title_zh: titleZh,
        title_en: titleEn,
        description: locale === 'zh-tw' ? update.descZh : update.descEn,
        description_zh: update.descZh || '',
        description_en: update.descEn || '',
        url: `/${locale}/updates/${update.id}`,
        category: update.category,
        tags: [],
        date: update.date,
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
        'Cache-Control': 'no-cache',
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
