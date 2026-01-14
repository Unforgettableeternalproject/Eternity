/**
 * 測試 MailChannels API
 * 檢查實際的錯誤回應
 */

const testEmail = {
  personalizations: [
    {
      to: [{ email: 'ptyc4076@gmail.com', name: 'Test' }],
    },
  ],
  from: {
    email: 'noreply@unforgettableeternalproject.com',
    name: 'Test',
  },
  subject: 'Test Email',
  content: [
    {
      type: 'text/plain',
      value: 'This is a test email',
    },
  ],
};

console.log('🧪 Testing MailChannels API...\n');
console.log('📧 Email payload:', JSON.stringify(testEmail, null, 2));
console.log('\n🚀 Sending request...\n');

try {
  const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(testEmail),
  });

  console.log('📊 Response status:', response.status);
  console.log('📊 Response status text:', response.statusText);
  
  const responseText = await response.text();
  console.log('\n📄 Response body:');
  console.log(responseText);

  if (!response.ok) {
    console.log('\n❌ Request failed!');
    console.log('\n💡 This is expected when testing from local machine.');
    console.log('   MailChannels requires requests from Cloudflare infrastructure.');
    console.log('\n🔍 Common error causes:');
    console.log('   - Request not from Cloudflare Pages (this test)');
    console.log('   - DNS TXT record not matching cfid');
    console.log('   - DNS record not propagated yet');
    console.log('   - From domain not matching DNS record');
  } else {
    console.log('\n✅ Email sent successfully!');
  }
} catch (error) {
  console.error('\n💥 Error occurred:', error.message);
}

console.log('\n📝 Notes:');
console.log('   - This test will fail from local machine (expected)');
console.log('   - MailChannels only accepts requests from Cloudflare Workers/Pages');
console.log('   - Check Cloudflare Pages Functions logs for real errors');
