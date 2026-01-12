/**
 * Search API Endpoint
 * Returns searchable content for GlobalSearch component
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async ({ url }) => {
  console.log('Full request URL:', url.href); // 完整 URL
  console.log('Search params:', url.searchParams.toString()); // 查詢參數
  console.log('Locale param:', url.searchParams.get('locale')); // locale 參數

  const locale = url.searchParams.get('locale') || 'zh-tw';

  console.log('Final locale used:', locale); // 最終使用的 locale

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
      // title_zh 已成為文件名 (project.id)，YAML 中只有 title_en
      const titleZh = project.id; // 文件名就是中文標題
      const titleEn = project.data.title_en || '';

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
      // title_zh 已成為文件名 (link.id)，YAML 中只有 title_en
      const titleZh = link.id;
      const titleEn = link.data.title_en || '';

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
      // title_zh 已成為文件名 (update.id)，YAML 中只有 title_en
      const titleZh = update.id;
      const titleEn = update.data.title_en || '';

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
    searchData.push(
      {
        id: 'page-home',
        type: 'page',
        title: locale === 'zh-tw' ? '首頁' : 'Home',
        description: locale === 'zh-tw' ? '回到首頁' : 'Go to homepage',
        url: `/${locale}/`,
        category: 'main',
      },
      {
        id: 'page-about',
        type: 'page',
        title: locale === 'zh-tw' ? '關於' : 'About',
        description: locale === 'zh-tw' ? '關於我的介紹' : 'About me',
        url: `/${locale}/about`,
        category: 'main',
      },
      {
        id: 'page-projects',
        type: 'page',
        title: locale === 'zh-tw' ? '專案' : 'Projects',
        description:
          locale === 'zh-tw' ? '查看我的專案作品' : 'View my project portfolio',
        url: `/${locale}/projects`,
        category: 'main',
      },
      {
        id: 'page-links',
        type: 'page',
        title: locale === 'zh-tw' ? '連結' : 'Links',
        description:
          locale === 'zh-tw'
            ? '有用的連結與資源'
            : 'Useful links and resources',
        url: `/${locale}/links`,
        category: 'main',
      },
      {
        id: 'page-updates',
        type: 'page',
        title: locale === 'zh-tw' ? '動態' : 'Updates',
        description:
          locale === 'zh-tw' ? '最新動態與更新' : 'Latest updates and news',
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
