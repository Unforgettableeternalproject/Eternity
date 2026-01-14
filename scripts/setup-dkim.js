/**
 * 添加 MailChannels DKIM DNS 記錄
 * 
 * MailChannels 使用自己的 DKIM 私鑰簽名，
 * 我們只需要添加他們的公鑰到 DNS
 */

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZONE_ID = 'ebe3f8de3784458f66194840084327a8';

if (!CLOUDFLARE_API_TOKEN) {
  console.error('❌ Error: CLOUDFLARE_API_TOKEN environment variable not set');
  process.exit(1);
}

// MailChannels 的 DKIM 公鑰（他們提供的標準公鑰）
const DKIM_RECORD_NAME = 'mailchannels._domainkey.unforgettableeternalproject.com';
const DKIM_VALUE = 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDptdISnDN3WHr3F1Y2tTSqPmGiFN3ZKRbdYmCQnIxNnZmSYdHcLwxvJsS0gLJYp7p5DhcPqfSKQS0LrY1iqH7tPCbPCqgdFzRdM2pCQNMb7AJKGHDGJwKLxvDKABJMpIjN7cPqLvJKTX0pBNwJGJCHjxOV0RQfTRLShHJCT0cJFwIDAQAB';

console.log('🔍 Checking for existing DKIM record...\n');

// 查找現有記錄
const listResponse = await fetch(
  `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=TXT&name=${DKIM_RECORD_NAME}`,
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

if (listData.result.length > 0) {
  console.log('✅ DKIM record already exists:');
  console.log(`   ID: ${listData.result[0].id}`);
  console.log(`   Name: ${listData.result[0].name}`);
  console.log(`   Content: ${listData.result[0].content.substring(0, 80)}...`);
  console.log('\n✨ No action needed!');
  process.exit(0);
}

console.log('📝 Creating new DKIM record...\n');

// 創建新記錄
const createResponse = await fetch(
  `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'TXT',
      name: DKIM_RECORD_NAME,
      content: DKIM_VALUE,
      ttl: 1, // Auto
      proxied: false,
    }),
  }
);

const createData = await createResponse.json();

if (!createData.success) {
  console.error('❌ Failed to create DKIM record:', createData.errors);
  process.exit(1);
}

console.log('✅ DKIM record created successfully!\n');
console.log('📋 Record details:');
console.log(`   ID: ${createData.result.id}`);
console.log(`   Name: ${createData.result.name}`);
console.log(`   Type: ${createData.result.type}`);
console.log(`   Content: ${createData.result.content.substring(0, 80)}...`);
console.log(`   TTL: ${createData.result.ttl === 1 ? 'Auto' : createData.result.ttl}`);

console.log('\n✨ DKIM configuration complete!');
console.log('\n⏰ DNS propagation may take a few minutes...');
console.log('   Test with: nslookup -type=TXT mailchannels._domainkey.unforgettableeternalproject.com');
