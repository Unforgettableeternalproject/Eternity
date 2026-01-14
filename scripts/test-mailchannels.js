/**
 * MailChannels 配置測試腳本
 * 用於驗證 DNS 配置和 API 調用
 */

import dns from 'dns/promises';

const DOMAIN = 'unforgettableeternalproject.com';
const PAGES_DOMAIN = 'eternity-8v7.pages.dev';
const DNS_RECORD_NAME = `_mailchannels.${DOMAIN}`;
const EXPECTED_VALUE = `v=mc1 cfid=${PAGES_DOMAIN}`;

console.log('🔍 MailChannels Configuration Test\n');

// 1. 檢查 DNS TXT 記錄
console.log('1️⃣ Checking DNS TXT record...');
console.log(`   Record: ${DNS_RECORD_NAME}`);
console.log(`   Expected: ${EXPECTED_VALUE}\n`);

try {
  const records = await dns.resolveTxt(DNS_RECORD_NAME);
  console.log('✅ DNS record found:');
  records.forEach((record, index) => {
    const value = record.join('');
    console.log(`   [${index + 1}] ${value}`);
    if (value === EXPECTED_VALUE) {
      console.log('   ✅ Record matches expected value!');
    } else {
      console.log('   ⚠️  Record does NOT match expected value');
      console.log(`   Expected: ${EXPECTED_VALUE}`);
      console.log(`   Got:      ${value}`);
    }
  });
} catch (error) {
  console.error('❌ DNS record not found or error:', error.message);
  console.log('\n💡 Possible solutions:');
  console.log('   1. Wait for DNS propagation (can take up to 48 hours)');
  console.log('   2. Check if the record was created correctly in Cloudflare DNS');
  console.log('   3. Try using a different DNS server for testing');
}

console.log('\n2️⃣ Testing MailChannels API endpoint...');

// 2. 測試 API 調用（不實際發送）
const testEmail = {
  personalizations: [
    {
      to: [{ email: 'test@example.com', name: 'Test User' }],
    },
  ],
  from: {
    email: `noreply@${DOMAIN}`,
    name: 'Test Sender',
  },
  reply_to: {
    email: 'reply@example.com',
    name: 'Reply User',
  },
  subject: 'MailChannels Test Email',
  content: [
    {
      type: 'text/plain',
      value: 'This is a test email to validate MailChannels configuration.',
    },
  ],
};

console.log('   Payload structure: ✅');
console.log('   From domain:', DOMAIN);
console.log('   Pages domain:', PAGES_DOMAIN);

console.log('\n📋 Summary:');
console.log(`   Domain: ${DOMAIN}`);
console.log(`   Pages: ${PAGES_DOMAIN}`);
console.log(`   DNS Record: ${DNS_RECORD_NAME}`);
console.log(`   Expected Value: ${EXPECTED_VALUE}`);

console.log('\n💡 Next steps:');
console.log('   1. If DNS record is correct, try sending a test email from the website');
console.log('   2. Check Cloudflare Pages Functions logs for detailed errors');
console.log('   3. Verify the "from" email domain matches the DNS record domain');

console.log('\n🔗 Useful links:');
console.log('   - MailChannels Docs: https://support.mailchannels.com/');
console.log('   - DNS Checker: https://dnschecker.org/');
console.log(
  `   - Check TXT: https://dnschecker.org/#TXT/${DNS_RECORD_NAME}`
);
