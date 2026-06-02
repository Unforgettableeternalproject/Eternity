#!/usr/bin/env node
/**
 * seed-about-contact.mjs
 *
 * 將 about.astro 和 contact.astro 的硬編碼內容寫入 D1 singletons。
 * 覆蓋現有的 about-zh/about-en，新建 contact-zh/contact-en。
 *
 * 用法：
 *   node scripts/seed-about-contact.mjs           # 本地 D1
 *   node scripts/seed-about-contact.mjs --remote   # 遠端 D1
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const isRemote = process.argv.includes('--remote');
const WORKER_DIR = 'workers/content-api';

// ─── About ZH ───
const aboutZh = {
  title: '我的個人簡介',
  bio: '對我而言，有一個尚未完成的故事存在著',
  heroTitle: '有一個\n尚未完成的\n故事存在著。',
  heroIntro:
    '我的本名是顏榕嶙，台灣人。這頁是我給自己留下的一份備忘錄 — 也讓走過的人，對「顏榕嶙是誰」有更完整的印象。',
  fullBio:
    '<p>\n  我的本名是\n  <span style="\n    font-weight:600;\n    background:linear-gradient(90deg,#6ee7ff,#c77dff);\n    -webkit-background-clip:text;\n    -webkit-text-fill-color:transparent;\n  ">\n    顏榕嶙\n  </span>，台灣人。\n</p>\n\n<p>\n  我並不想要被任何事物給拘束，而希望追求一個\n  <span style="color:#7dd3fc; text-shadow:0 0 6px rgba(125,211,252,0.4);">\n    自由自在的環境\n  </span>。\n</p>\n\n<p>\n  當然，聽起來還是天方夜譚，不過這也是我之所以繼續努力著的原因。\n</p>\n\n<p>\n  有一個故事存活在我的心中，而對我而言，想辦法把這個故事給實現\n  <span style="font-style:italic; opacity:0.8;">\n    (無論使用甚麼辦法)\n  </span>\n  就是我一直在追求的\n  <span style="\n    font-weight:700;\n    background:linear-gradient(\n      90deg,\n      #d5b618,\n      #f5e27a,\n      #d5b618\n    );\n    -webkit-background-clip:text;\n    -webkit-text-fill-color:transparent;\n    text-shadow:0 0 12px rgba(213,182,24,0.35);\n  ">\n    最終目標\n  </span>。\n</p>\n\n<p>\n  因此，祝我好運吧。\n</p>\n',
  avatar: '/images/avatars/avatar.png',
  facts: [
    ['NAME', '顏榕嶙 · Bernie Yen'],
    ['ROLE', '全端工程師 / 創作者'],
    ['LOC', 'Taiwan · 高雄'],
    ['SINCE', '2018'],
    ['EMAIL', 'ptyc4076@gmail.com'],
    ['GIT', '@Unforgettableeternalproject'],
  ],
  skills: [
    {
      id: '01',
      name: '軟體設計／開發',
      en: 'Software',
      brief: 'Python · JavaScript · C# · Full-stack',
      description:
        '這算是我的本業，從國中開始就在往程式設計的方向前進了，如今我已經做了很多個挺好看的專案，而我也不吝於將它們給展示於此。寫程式對我來說也是一種創作過程，主要是把想法給實現出來變成真正的作品、產品，以達到某個特定的目標。',
      selfAssessment:
        '我無法說我已經對於這一塊爐火純青，但我也是對自己的能力挺有自信的，以這個網頁為例，我的確有辦法將自己所想的給實作出來。我熟悉的語言主要是 Python、JavaScript 以及一點 C#，如有建議請不吝指教！',
    },
    {
      id: '02',
      name: '音樂創作',
      en: 'Composition',
      brief: '區域、角色、劇情主題曲 · 數十首',
      description:
        '音樂對我來說就是一種傳遞故事的手段，從我國中起就對於作曲挺有興趣的，主要是有辦法把我心中的旋律給展現出來就有種成功解釋我的故事的感覺。實際上，我沒有學過樂器，對音樂理論的理解只限於高中音樂課，但誰知道呢？我認為這樣自己摸索也相當不錯。',
      selfAssessment:
        '俗話說練習是成功的根本，從最早以前到現在我堆積出的作品也已經有幾十首，因此我可以說即使不到專業等級，作為區域、角色和劇情的主題曲我個人認為是相當足夠的，當然可以的話我也希望能夠繼續精進自己。',
    },
    {
      id: '03',
      name: '寫作',
      en: 'Writing',
      brief: '小說、設定文件、世界觀建構',
      description:
        '我時常在閒暇時期寫作，主要是我有一個完整的大綱在敘述整個故事，對我而言這些故事已經在我腦中存在很久了，因此我想要試著把這些故事用文字的方式給表達出來，基本上是寫小說。我一直在努力磨練我的文筆，為了呈現一個最完整、最詳細的敘述模式。',
      selfAssessment:
        '每次前進了一些道路之後驀然回首，總會感覺自己的過往並沒有太多的光采，並想要重新點繪，反而就一直在起點附近徘徊。我認為我對創作文章的熟練度一直在 0~100 之間徘徊，一個所謂的平衡總是飄忽不定。',
    },
    {
      id: '04',
      name: '像素繪圖',
      en: 'Pixel Art',
      brief: '場景、人物、icon',
      description:
        '我畫畫一直以來都不好，當然我也希望自己能夠學會繪圖，這樣很多腦中的人物和場景都可以被實際創作出來。慶幸的是，雖然我畫不了直線，而且構圖與上色都不太好，像素畫還算是在我可以掌握的範圍。',
      selfAssessment:
        '美術是我的弱項，因此我不會說我畫得很好，但我並不會為我過去的作品感到羞愧，正是有那些零散的創作，我的故事才得以進展到如今這個地步，所以說，我會想辦法讓我的技藝更加精湛。',
    },
    {
      id: '05',
      name: '剪輯 ＆ 混音',
      en: 'Edit & Mix',
      brief: 'Premiere · After Effects · Audition',
      description:
        '由於我有經營 YouTube 頻道，因此有自學過一些基本的剪輯，主要以 Premiere 和 After Effect 為主，也經常用 Audition 去對我的雛型曲作一些快速混響和修整，雖然都是簡單的操作，但也足夠用了。',
      selfAssessment:
        '當然比起剪輯專業或者大眾傳播等等要簡陋很多，我主要都是以作歌曲影片為主，但經過一段時間的學習我認為現在至少可以做出一些不錯的動畫跟解說影片。',
    },
  ],
  experience: [
    {
      title: '全端工程師',
      company: '佶昕智能',
      period: '2026/01 — 2026/07',
      location: 'Taiwan',
      description:
        '作為工程師在這間公司工作了一段期間，主要負責官方平台的前／後端技術設計以及開發。',
      stack: ['React', 'Node.js', 'PostgreSQL', 'Docker'],
      current: false,
    },
    {
      title: 'Lead Organizer',
      company: 'GDG on Campus · NKNU',
      period: '2024 — 2025',
      location: '高雄師範大學',
      description:
        '在校園內推動 GDG 社群，負責活動企劃、技術講座、教學內容設計與社群官網開發。',
      stack: ['Astro', 'TypeScript', 'Community'],
      current: false,
    },
  ],
  social: {
    github: 'https://github.com/Unforgettableeternalproject',
    email: 'ptyc4076@gmail.com',
  },
  cta: {
    heading: '想聊聊？',
    text: '不論程式、音樂、文字、像素 — 只要跟「故事」沾上邊，我都想聽。',
  },
};

// ─── About EN ───
const aboutEn = {
  title: 'About Me',
  bio: "To me, there's an unfinished story waiting to be completed.",
  heroTitle: 'A story\nnot yet finished\nexists.',
  heroIntro:
    'My name is Bernie Yen, from Taiwan. This page is a memo I left for myself — and for anyone passing through, a fuller picture of who I am.',
  fullBio:
    '<p>\n  My name is\n  <span style="\n    font-weight:600;\n    background:linear-gradient(90deg,#6ee7ff,#c77dff);\n    -webkit-background-clip:text;\n    -webkit-text-fill-color:transparent;\n  ">\n    Bernie Yen\n  </span>, from Taiwan.\n</p>\n\n<p>\n  I do not wish to be bound by anything, but instead seek\n  <span style="color:#7dd3fc; text-shadow:0 0 6px rgba(125,211,252,0.4);">\n    a truly free environment\n  </span>.\n</p>\n\n<p>\n  Of course, it may sound like a fantasy,<br>\n  but that is exactly why I continue to move forward.\n</p>\n\n<p>\n  There is a story living within my heart, and to me,\n  finding a way to bring this story into reality\n  <span style="font-style:italic; opacity:0.8;">\n    (no matter the means)\n  </span>\n  is the\n  <span style="\n    font-weight:700;\n    background:linear-gradient(\n      90deg,\n      #d5b618,\n      #f5e27a,\n      #d5b618\n    );\n    -webkit-background-clip:text;\n    -webkit-text-fill-color:transparent;\n    text-shadow:0 0 12px rgba(213,182,24,0.35);\n  ">\n    final goal\n  </span>\n  I have always been pursuing.\n</p>\n\n<p>\n  So, wish me good luck.\n</p>\n',
  avatar: '/images/avatars/avatar.png',
  facts: [
    ['NAME', 'Bernie Yen · 顏榕嶙'],
    ['ROLE', 'Full-stack Dev / Creator'],
    ['LOC', 'Taiwan · 高雄'],
    ['SINCE', '2018'],
    ['EMAIL', 'ptyc4076@gmail.com'],
    ['GIT', '@Unforgettableeternalproject'],
  ],
  skills: [
    {
      id: '01',
      name: 'Software Development',
      en: 'Software',
      brief: 'Python · JavaScript · C# · Full-stack',
      description:
        "This is my main craft. I've been heading toward software development since middle school, and by now I've built several projects that I'm happy to showcase here.",
      selfAssessment:
        "I can't say I've mastered this field, but I'm fairly confident in my abilities. This very website is proof that I can implement what I envision.",
    },
    {
      id: '02',
      name: 'Music Composition',
      en: 'Composition',
      brief: 'Region, character & story themes',
      description:
        "Music is a way for me to convey stories. I've been interested in composing since middle school — expressing the melodies in my head feels like successfully explaining my stories.",
      selfAssessment:
        "Practice makes perfect — I've accumulated dozens of compositions by now. While not professional-level, they serve well as theme songs for regions, characters, and plot arcs.",
    },
    {
      id: '03',
      name: 'Writing',
      en: 'Writing',
      brief: 'Novels, lore docs, worldbuilding',
      description:
        "I write frequently in my spare time. I have a complete outline narrating the entire story — these stories have existed in my mind for a long time. I'm always working to polish my writing skills.",
      selfAssessment:
        'Every time I look back after some progress, I feel the past lacks brilliance and want to repaint it, lingering near the starting point. My writing proficiency constantly fluctuates.',
    },
    {
      id: '04',
      name: 'Pixel Art',
      en: 'Pixel Art',
      brief: 'Scenes, characters, icons',
      description:
        'Drawing has never been my strong suit, but pixel art is within my reach. Through it, I can bring the characters and scenes in my mind to life.',
      selfAssessment:
        "Art is my weakness, but I'm not ashamed of my past works — those scattered creations are what pushed my story forward to where it is today.",
    },
    {
      id: '05',
      name: 'Editing & Mixing',
      en: 'Edit & Mix',
      brief: 'Premiere · After Effects · Audition',
      description:
        "Since I run a YouTube channel, I've self-taught basic editing with Premiere and After Effects, and often use Audition for quick reverb and adjustments on my draft compositions.",
      selfAssessment:
        'Much simpler compared to professional editing, but after some learning I can at least produce decent animations and explanation videos.',
    },
  ],
  experience: [
    {
      title: 'Full-stack Engineer',
      company: 'JiXin AI',
      period: '2026/01 — 2026/07',
      location: 'Taiwan',
      description:
        "Worked as an engineer responsible for the full-stack design and development of the company's official platform.",
      stack: ['React', 'Node.js', 'PostgreSQL', 'Docker'],
      current: false,
    },
    {
      title: 'Lead Organizer',
      company: 'GDG on Campus · NKNU',
      period: '2024 — 2025',
      location: 'NKNU, Kaohsiung',
      description:
        'Led the campus GDG community — event planning, tech talks, educational content, and community website development.',
      stack: ['Astro', 'TypeScript', 'Community'],
      current: false,
    },
  ],
  social: {
    github: 'https://github.com/Unforgettableeternalproject',
    email: 'ptyc4076@gmail.com',
  },
  cta: {
    heading: "Let's talk?",
    text: "Code, music, words, pixels — if it has anything to do with 'story', I want to hear it.",
  },
};

// ─── Contact ZH ───
const contactZh = {
  heroTitle: '來說你的故事。',
  heroIntro:
    '合作邀約、聲音作品、文字、世界觀討論、或單純打聲招呼 — 都歡迎。我會盡量在 48 小時內回。',
  subjects: [
    'collab · 合作邀約',
    'music · 音樂',
    'writing · 文字',
    'world · 世界觀',
    'other · 其他',
  ],
  directLinks: [
    {
      key: 'EMAIL',
      value: 'ptyc4076@gmail.com',
      url: 'mailto:ptyc4076@gmail.com',
    },
    {
      key: 'GITHUB',
      value: '@Unforgettableeternalproject',
      url: 'https://github.com/Unforgettableeternalproject',
    },
    {
      key: 'DOCS',
      value: 'uep.unforgettableeternalproject.com',
      url: 'https://uep.unforgettableeternalproject.com',
    },
  ],
  expectation:
    '目前接受小規模的接案與合作。我以業餘時間運作，所以時程可能不會像專職工作室那麼緊。請見諒。',
  faqs: [
    {
      q: '會接什麼樣的案？',
      a: '個人專案、獨立工作室、小團隊。我比較不接純行銷網頁。',
    },
    { q: '多久會回信？', a: '通常 24-48 小時內，週末可能慢一點。' },
    { q: '可以用中文嗎？', a: '中文、英文都可以，我會配合你習慣的語言。' },
  ],
  devCta: {
    heading: '遇到 bug 或想提建議？',
    text: '直接到 GitHub 開 issue 會比信件更快被處理。',
  },
};

// ─── Contact EN ───
const contactEn = {
  heroTitle: 'Tell me your story.',
  heroIntro:
    "Collaborations, music, writing, worldbuilding discussions, or just saying hi — all welcome. I'll try to reply within 48 hours.",
  subjects: [
    'collab · collaboration',
    'music · music',
    'writing · writing',
    'world · worldbuilding',
    'other · other',
  ],
  directLinks: [
    {
      key: 'EMAIL',
      value: 'ptyc4076@gmail.com',
      url: 'mailto:ptyc4076@gmail.com',
    },
    {
      key: 'GITHUB',
      value: '@Unforgettableeternalproject',
      url: 'https://github.com/Unforgettableeternalproject',
    },
    {
      key: 'DOCS',
      value: 'uep.unforgettableeternalproject.com',
      url: 'https://uep.unforgettableeternalproject.com',
    },
  ],
  expectation:
    'Currently accepting small-scale freelance and collaborations. I operate in my spare time, so timelines may not be as tight as a full-time studio.',
  faqs: [
    {
      q: 'What kind of work do you take?',
      a: 'Personal projects, indie studios, small teams. I tend not to take pure marketing pages.',
    },
    {
      q: 'How long until you reply?',
      a: 'Usually within 24-48 hours. Weekends might be slower.',
    },
    {
      q: 'Can I write in Chinese?',
      a: "Both Chinese and English work. I'll match whichever language you're comfortable with.",
    },
  ],
  devCta: {
    heading: 'Found a bug or have a suggestion?',
    text: 'Opening an issue on GitHub will be processed faster than email.',
  },
};

// ─── Write to D1 ───
const singletons = [
  ['about-zh', aboutZh],
  ['about-en', aboutEn],
  ['contact-zh', contactZh],
  ['contact-en', contactEn],
];

const statements = singletons.map(([key, data]) => {
  const json = JSON.stringify(data).replace(/'/g, "''");
  return `INSERT OR REPLACE INTO root_singletons (section_id, content, updated_at) VALUES ('${key}', '${json}', datetime('now'));`;
});

const tmpFile = join(process.cwd(), 'scripts', '_tmp_seed_about_contact.sql');
writeFileSync(tmpFile, statements.join('\n'), 'utf-8');

const remoteFlag = isRemote ? ' --remote' : ' --local';
const cmd = `npx wrangler d1 execute eternity-content${remoteFlag} --file="${tmpFile}"`;

console.log(`\n📋 Seeding about + contact singletons`);
console.log(`   Mode: ${isRemote ? '🌐 Remote' : '💻 Local'} D1\n`);

try {
  execSync(cmd, { cwd: WORKER_DIR, encoding: 'utf-8', stdio: 'pipe' });
  console.log('✅ Successfully seeded:');
  singletons.forEach(([key]) => console.log(`   - ${key}`));
} catch (e) {
  // wrangler sometimes exits 1 but succeeds
  if (e.stdout?.includes('command executed successfully')) {
    console.log('✅ Successfully seeded:');
    singletons.forEach(([key]) => console.log(`   - ${key}`));
  } else {
    console.error('❌ Seed failed:', e.message);
    process.exit(1);
  }
}

try {
  unlinkSync(tmpFile);
} catch {}
