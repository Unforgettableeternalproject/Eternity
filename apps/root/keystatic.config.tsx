import { config, collection, fields } from '@keystatic/core';

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
      內容管理: ['about', 'projects', 'links', 'updates'],
      // 未來可擴充: ['articles'],
    },
  },

  collections: {
    about: collection({
      label: '關於我',
      slugField: 'name',
      path: 'apps/root/src/content/about/*',
      format: { contentField: 'content' },
      schema: {
        name: fields.slug({ 
          name: { 
            label: '名稱 (slug)',
            validation: { isRequired: true },
          } 
        }),
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
          directory: 'apps/root/public/images/avatars',
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
        content: fields.markdoc({ 
          label: '完整自我介紹內容',
          description: '這裡可以撰寫更詳細的個人介紹'
        }),
      },
    }),

    projects: collection({
      label: '專案',
      slugField: 'title',
      path: 'apps/root/src/content/projects/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ 
          name: { 
            label: '標題',
            validation: { isRequired: true },
          } 
        }),
        description: fields.text({ 
          label: '描述',
          multiline: true,
          validation: { isRequired: true },
        }),
        tags: fields.array(
          fields.text({ label: '標籤' }),
          {
            label: '標籤列表',
            itemLabel: props => props.value,
          }
        ),
        featured: fields.checkbox({
          label: '在首頁顯示',
          defaultValue: false,
        }),
        order: fields.number({
          label: '排序順序',
          description: '數字越小越靠前',
        }),
        status: fields.select({
          label: '狀態',
          options: [
            { label: '進行中', value: 'active' },
            { label: '已完成', value: 'completed' },
            { label: '已封存', value: 'archived' },
          ],
          defaultValue: 'active',
        }),
        image: fields.image({
          label: '專案封面圖片',
          directory: 'apps/root/public/images/projects',
          publicPath: '/images/projects/',
        }),
        links: fields.object({
          demo: fields.url({ label: 'Demo 連結' }),
          github: fields.url({ label: 'GitHub 連結' }),
          website: fields.url({ label: '網站連結' }),
        }, {
          label: '相關連結',
        }),
        startDate: fields.date({
          label: '開始日期',
        }),
        endDate: fields.date({
          label: '結束日期',
        }),
        content: fields.markdoc({
          label: '詳細內容',
        }),
      },
    }),

    links: collection({
      label: '連結',
      slugField: 'title',
      path: 'apps/root/src/content/links/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ 
          name: { 
            label: '標題',
            validation: { isRequired: true },
          } 
        }),
        description: fields.text({ 
          label: '描述',
          multiline: true,
          validation: { isRequired: true },
        }),
        url: fields.url({
          label: '連結網址',
          validation: { isRequired: true },
        }),
        category: fields.select({
          label: '分類',
          options: [
            { label: '社群媒體', value: 'social' },
            { label: '工作相關', value: 'work' },
            { label: '創作平台', value: 'creative' },
            { label: '其他', value: 'other' },
          ],
          defaultValue: 'other',
        }),
        icon: fields.text({
          label: 'Icon 名稱',
          description: '例如: github, twitter, link',
        }),
        featured: fields.checkbox({
          label: '重要連結',
          defaultValue: false,
        }),
        order: fields.number({
          label: '排序順序',
        }),
        content: fields.markdoc({
          label: '詳細說明',
        }),
      },
    }),

    updates: collection({
      label: '最新動態',
      slugField: 'title',
      path: 'apps/root/src/content/updates/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ 
          name: { 
            label: '標題',
            validation: { isRequired: true },
          } 
        }),
        description: fields.text({ 
          label: '描述',
          multiline: true,
          validation: { isRequired: true },
        }),
        date: fields.date({
          label: '日期',
          validation: { isRequired: true },
        }),
        category: fields.select({
          label: '分類',
          options: [
            { label: '網站更新', value: 'website' },
            { label: '專案進展', value: 'project' },
            { label: '重要公告', value: 'announcement' },
            { label: '其他', value: 'other' },
          ],
          defaultValue: 'other',
        }),
        featured: fields.checkbox({
          label: '在首頁顯示',
          defaultValue: false,
        }),
        content: fields.markdoc({
          label: '完整內容',
        }),
      },
    }),
  },
});
