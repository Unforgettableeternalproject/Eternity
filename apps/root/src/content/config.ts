import { defineCollection, z } from 'astro:content';

// Content Collections Configuration - Updated 2026-01-12

// 專案集合
const projectsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title_zh: z.string(),
    description_zh: z.string(),
    title_en: z.string(),
    description_en: z.string(),
    tags: z.array(z.string()),
    featured: z.boolean().default(false),
    order: z.number().optional(),
    status: z.enum(['active', 'completed', 'archived']).default('active'),
    image: z.string().optional(),
    links: z
      .object({
        demo: z.string().optional(),
        github: z.string().optional(),
        website: z.string().optional(),
      })
      .optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
  }),
});

// 連結集合
const linksCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title_zh: z.string(),
    description_zh: z.string(),
    title_en: z.string(),
    description_en: z.string(),
    url: z.string(),
    category: z.enum(['social', 'work', 'creative', 'other']).default('other'),
    icon: z.string().optional(),
    featured: z.boolean().default(false),
    order: z.number().optional(),
  }),
});

// 更新動態集合
const updatesCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title_zh: z.string(),
    description_zh: z.string(),
    title_en: z.string(),
    description_en: z.string(),
    date: z.date(),
    category: z
      .enum(['website', 'project', 'announcement', 'other'])
      .default('other'),
    featured: z.boolean().default(false),
  }),
});

// 主頁內容（按語言分開）
const homepageCollection = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    subtitle: z.string(),
    heroImage: z.string().optional(),
  }),
});

// 關於我（按語言分開）
const aboutCollection = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    bio: z.string(), // 簡短自我介紹（用於標題下方）
    fullBio: z.string().optional(), // 完整自我介紹（支援 HTML 格式化）
    avatar: z.string().optional(), // 頭像路徑（public 資料夾中）
    skills: z.array(z.string()),
    experience: z.array(
      z.object({
        title: z.string(),
        company: z.string(),
        period: z.string(),
        description: z.string().optional(),
      })
    ),
    certifications: z.array(
      z.object({
        name: z.string(),
        issuer: z.string(),
        date: z.string().optional(),
        link: z.string().optional(),
      })
    ),
    social: z
      .object({
        github: z.string().optional(),
        email: z.string().optional(),
        twitter: z.string().optional(),
      })
      .optional(),
  }),
});

// 文章集合（未來可用）
const articlesCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.date(),
    author: z.string().default('Bernie'),
    tags: z.array(z.string()).optional(),
    image: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

// 側邊欄卡片 - 統一的卡片集合
const cardsCollection = defineCollection({
  type: 'data',
  schema: z.object({
    enabled: z.boolean().default(true),
    order: z.number().default(1),
    position: z.enum(['left', 'right']).default('left'),
    // Quote 卡片欄位
    quotes_zh: z
      .array(
        z.object({
          text: z.string(),
          author: z.string().optional(),
        })
      )
      .optional(),
    quotes_en: z
      .array(
        z.object({
          text: z.string(),
          author: z.string().optional(),
        })
      )
      .optional(),
    // Music 卡片欄位
    tracks: z
      .array(
        z.object({
          title: z.string(),
          artist: z.string(),
          url: z.string().optional(),
          cover: z.string().optional(),
        })
      )
      .optional(),
  }),
});

export const collections = {
  'homepage-zh': homepageCollection,
  'homepage-en': homepageCollection,
  'about-zh': aboutCollection,
  'about-en': aboutCollection,
  cards: cardsCollection,
  'card-quote': cardsCollection,
  'card-music': cardsCollection,
  'card-visitor-counter': cardsCollection,
  'card-latest-update': cardsCollection,
  'card-quick-stats': cardsCollection,
  'card-table-of-contents': cardsCollection,
  projects: projectsCollection,
  links: linksCollection,
  updates: updatesCollection,
  articles: articlesCollection,
};
