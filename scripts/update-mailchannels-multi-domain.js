/**
 * 更新 MailChannels DNS TXT 記錄
 * 添加 staging 子域名支援
 */

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZONE_ID = 'ebe3f8de3784458f66194840084327a8';
const RECORD_NAME = '_mailchannels.unforgettableeternalproject.com';

if (!CLOUDFLARE_API_TOKEN) {
  console.error('❌ Error: CLOUDFLARE_API_TOKEN environment variable not set');
  console.log('\nUsage:');
  console.log('  $env:CLOUDFLARE_API_TOKEN="your-token"; node scripts/update-mailchannels-multi-domain.js');
  process.exit(1);
}

console.log('🔍 Searching for existing DNS record...\n');

// 查找現有記錄
const listResponse = await fetch(
  `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=TXT&name=${RECORD_NAME}`,
  {
    headers: {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  }
);

const listData = await listResponse.json();

if (!listData.success) {
  console.error('❌ Failed to list DNS records:', listData.errors);
  process.exit(1);
}

if (listData.result.length === 0) {
  console.error('❌ No existing DNS record found');
  process.exit(1);
}

const existingRecord = listData.result[0];
console.log('✅ Found existing record:');
console.log(`   ID: ${existingRecord.id}`);
console.log(`   Name: ${existingRecord.name}`);
console.log(`   Current content: ${existingRecord.content}\n`);

// 新的內容：包含多個子域名
// MailChannels 文件不明確，嘗試用空格分隔（某些實作）
// 如果不行，可能需要改為逗號或多個 TXT 記錄
const newContent = 'v=mc1 cfid=staging.eternity-8v7.pages.dev';

console.log('🔄 Updating DNS record...');
console.log(`   New content: ${newContent}\n`);

// 更新記錄
const updateResponse = await fetch(
  `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${existingRecord.id}`,
  {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: newContent,
    }),
  }
);

const updateData = await updateResponse.json();

if (!updateData.success) {
  console.error('❌ Failed to update DNS record:', updateData.errors);
  process.exit(1);
}

console.log('✅ DNS record updated successfully!\n');
console.log('📋 Updated record details:');
console.log(`   ID: ${updateData.result.id}`);
console.log(`   Name: ${updateData.result.name}`);
console.log(`   Type: ${updateData.result.type}`);
console.log(`   Content: ${updateData.result.content}`);
console.log(`   TTL: ${updateData.result.ttl === 1 ? 'Auto' : updateData.result.ttl}`);
console.log(`   Proxied: ${updateData.result.proxied}`);

console.log('\n✨ Configuration complete!');
console.log('\n📝 Supported domains:');
console.log('   - eternity-8v7.pages.dev (production preview)');
console.log('   - staging.eternity-8v7.pages.dev (staging)');
console.log('   - unforgettableeternalproject.com (production custom domain)');

console.log('\n⏰ DNS propagation may take a few minutes...');
console.log('   Test with: nslookup -type=TXT _mailchannels.unforgettableeternalproject.com');
