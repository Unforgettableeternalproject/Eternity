import { config, collection, singleton, fields } from '@keystatic/core';

export default config({
  storage: {
    kind: 'local',
  },

  ui: {
    brand: {
      name: 'Eternity CMS',
      mark: () => '✨',
    },
    navigation: {
      '繁體中文內容': ['homepage-zh', 'about-zh'],
      'English Content': ['homepage-en', 'about-en'],
      內容集合: ['projects', 'links', 'updates'],
      // 未來可擴充: ['articles'],
    },
  },

  singletons: {
    'homepage-zh': singleton({
      label: '🇹🇼 主頁內容',
      path: 'src/content/homepage-zh/',
      format: { data: 'json' },
      schema: {
        title: fields.text({ 
          label: '網站標題',
          validation: { isRequired: true },
        }),
        name: fields.text({ 
          label: '名字',
          validation: { isRequired: false },
        }),
        subtitle: fields.text({ 
          label: '副標題',
          multiline: true,
          validation: { isRequired: true },
        }),
        introHeading: fields.text({ 
          label: '介紹區塊標題',
          validation: { isRequired: false },
        }),
        introContent: fields.text({ 
          label: '介紹區塊內容',
          multiline: true,
          validation: { isRequired: false },
        }),
      },
    }),

    'homepage-en': singleton({
      label: '🇺🇸 Homepage',
      path: 'src/content/homepage-en/',
      format: { data: 'json' },
      schema: {
        title: fields.text({ 
          label: 'Website Title',
          validation: { isRequired: true },
        }),
        name: fields.text({ 
          label: 'Name',
          validation: { isRequired: false },
        }),
        subtitle: fields.text({ 
          label: 'Subtitle',
          multiline: true,
          validation: { isRequired: true },
        }),
        introHeading: fields.text({ 
          label: 'Intro Section Heading',
          validation: { isRequired: false },
        }),
        introContent: fields.text({ 
          label: 'Intro Section Content',
          multiline: true,
          validation: { isRequired: false },
        }),
      },
    }),

    'about-zh': singleton({
      label: '🇹🇼 關於我',
      path: 'src/content/about-zh/',
      format: { data: 'json' },
      schema: {
        title: fields.text({ 
          label: '標題/標語',
          validation: { isRequired: true },
        }),
        bio: fields.text({ 
          label: '簡短自我介紹',
          multiline: true,
          validation: { isRequired: true },
        }),
        avatar: fields.image({ 
          label: '頭像',
          directory: 'public/images/avatars',
          publicPath: '/images/avatars/',
        }),
        skills: fields.array(
          fields.text({ label: '技能' }),
          {
            label: '技能列表',
            itemLabel: props => props.value,
          }
        ),
        social: fields.object({
          github: fields.text({ label: 'GitHub URL' }),
          email: fields.text({ label: 'Email' }),
          twitter: fields.text({ label: 'Twitter/X URL' }),
        }),
      },
    }),

    'about-en': singleton({
      label: '🇺🇸 About',
      path: 'src/content/about-en/',
      format: { data: 'json' },
      schema: {
        title: fields.text({ 
          label: 'Title/Tagline',
          validation: { isRequired: true },
        }),
        bio: fields.text({ 
          label: 'Short Bio',
          multiline: true,
          validation: { isRequired: true },
        }),
        avatar: fields.image({ 
          label: 'Avatar',
          directory: 'apps/root/public/images/avatars',
          publicPath: '/images/avatars/',
        }),
        skills: fields.array(
          fields.text({ label: 'Skill' }),
          {
            label: 'Skills',
            itemLabel: props => props.value,
          }
        ),
        social: fields.object({
          github: fields.text({ label: 'GitHub URL' }),
          email: fields.text({ label: 'Email' }),
          twitter: fields.text({ label: 'Twitter/X URL' }),
        }),
      },
    }),
  },

  collections: {
    projects: collection({
      label: '專案 / Projects',
      slugField: 'title_zh',
      path: 'src/content/projects/*',
      schema: {
        // 繁體中文內容
        title_zh: fields.text({ 
          label: '標題 (繁體中文)',
          validation: { isRequired: true },
        }),
        description_zh: fields.text({ 
          label: '描述 (繁體中文)',
          multiline: true,
          validation: { isRequired: true },
        }),
        content_zh: fields.markdoc({
          label: '詳細內容 (繁體中文)',
        }),
        
        // 英文內容
        title_en: fields.text({ 
          label: 'Title (English)',
          validation: { isRequired: true },
        }),
        description_en: fields.text({ 
          label: 'Description (English)',
          multiline: true,
          validation: { isRequired: true },
        }),
        content_en: fields.markdoc({
          label: 'Detailed Content (English)',
        }),
        
        tags: fields.array(
          fields.text({ label: '標籤 / Tag' }),
          {
            label: '標籤列表',
            itemLabel: props => props.value,
          }
        ),
        featured: fields.checkbox({
          label: '在首頁顯示 / Featured',
          defaultValue: false,
        }),
        order: fields.number({
          label: '排序順序 / Sort Order',
          description: '數字越小越靠前',
        }),
        status: fields.select({
          label: '狀態 / Status',
          options: [
            { label: '進行中 / Active', value: 'active' },
            { label: '已完成 / Completed', value: 'completed' },
            { label: '已封存 / Archived', value: 'archived' },
          ],
          defaultValue: 'active',
        }),
        image: fields.image({
          label: '專案封面圖片 / Project Cover',
          directory: 'public/images/projects',
          publicPath: '/images/projects/',
        }),
        links: fields.object({
          demo: fields.url({ label: 'Demo 連結 / Demo Link' }),
          github: fields.url({ label: 'GitHub 連結 / GitHub Link' }),
          website: fields.url({ label: '網站連結 / Website Link' }),
        }, {
          label: '相關連結 / Links',
        }),
        startDate: fields.date({
          label: '開始日期 / Start Date',
        }),
        endDate: fields.date({
          label: '結束日期 / End Date',
        }),
      },
    }),

    links: collection({
      label: '連結 / Links',
      slugField: 'title_zh',
      path: 'src/content/links/*',
      schema: {
        // 繁體中文內容
        title_zh: fields.text({ 
          label: '標題 (繁體中文)',
          validation: { isRequired: true },
        }),
        description_zh: fields.text({ 
          label: '描述 (繁體中文)',
          multiline: true,
          validation: { isRequired: true },
        }),
        
        // 英文內容
        title_en: fields.text({ 
          label: 'Title (English)',
          validation: { isRequired: true },
        }),
        description_en: fields.text({ 
          label: 'Description (English)',
          multiline: true,
          validation: { isRequired: true },
        }),
        
        url: fields.url({
          label: '連結網址 / URL',
          validation: { isRequired: true },
        }),
        category: fields.select({
          label: '分類 / Category',
          options: [
            { label: '社群媒體 / Social Media', value: 'social' },
            { label: '工作相關 / Work', value: 'work' },
            { label: '創作平台 / Creative', value: 'creative' },
            { label: '其他 / Other', value: 'other' },
          ],
          defaultValue: 'other',
        }),
        icon: fields.text({
          label: 'Icon 名稱 (可選)',
          description: '例如: github, twitter, linkedin, youtube, link 等',
        }),
        featured: fields.checkbox({
          label: '重要連結 / Featured',
          description: '在首頁顯示此連結',
          defaultValue: false,
        }),
        order: fields.number({
          label: '排序順序 / Sort Order',
          description: '數字越小越靠前',
        }),
      },
    }),

    updates: collection({
      label: '最新動態 / Updates',
      slugField: 'title_zh',
      path: 'src/content/updates/*',
      schema: {
        // 繁體中文內容
        title_zh: fields.text({ 
          label: '標題 (繁體中文)',
          validation: { isRequired: true },
        }),
        description_zh: fields.text({ 
          label: '描述 (繁體中文)',
          multiline: true,
          validation: { isRequired: true },
        }),
        content_zh: fields.markdoc({
          label: '完整內容 (繁體中文)',
        }),
        
        // 英文內容
        title_en: fields.text({ 
          label: 'Title (English)',
          validation: { isRequired: true },
        }),
        description_en: fields.text({ 
          label: 'Description (English)',
          multiline: true,
          validation: { isRequired: true },
        }),
        content_en: fields.markdoc({
          label: 'Full Content (English)',
        }),
        
        date: fields.date({
          label: '日期 / Date',
          validation: { isRequired: true },
        }),
        category: fields.select({
          label: '分類 / Category',
          options: [
            { label: '網站更新 / Website', value: 'website' },
            { label: '專案進展 / Project', value: 'project' },
            { label: '重要公告 / Announcement', value: 'announcement' },
            { label: '其他 / Other', value: 'other' },
          ],
          defaultValue: 'other',
        }),
        featured: fields.checkbox({
          label: '在首頁顯示 / Featured',
          defaultValue: false,
        }),
      },
    }),
  },
});
