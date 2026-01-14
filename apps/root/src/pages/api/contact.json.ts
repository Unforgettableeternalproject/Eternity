export const prerender = false;

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();
    const { name, email, subject, message } = data;

    // 驗證必填欄位
    if (!name || !email || !subject || !message) {
      return new Response(
        JSON.stringify({ error: 'All fields are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 驗證 email 格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 組合郵件內容
    const emailContent = {
      personalizations: [
        {
          to: [{ email: 'ptyc4076@gmail.com', name: 'Bernie' }],
        },
      ],
      from: {
        email: 'noreply@unforgettableeternalproject.com',
        name: 'Eternity Contact Form',
      },
      reply_to: {
        email: email,
        name: name,
      },
      subject: `[Contact Form] ${subject}`,
      content: [
        {
          type: 'text/plain',
          value: `Name: ${name}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}\n\n---\nSent from Eternity Contact Form`,
        },
        {
          type: 'text/html',
          value: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #334155;">New Contact Form Submission</h2>
              <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Name:</strong> ${name}</p>
                <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
                <p><strong>Subject:</strong> ${subject}</p>
              </div>
              <div style="background: #ffffff; padding: 20px; border-left: 4px solid #3b82f6; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #475569;">Message:</h3>
                <p style="white-space: pre-wrap;">${message}</p>
              </div>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
              <p style="color: #94a3b8; font-size: 14px;">Sent from Eternity Contact Form</p>
            </div>
          `,
        },
      ],
    };

    // 開發環境：只記錄，不實際發送
    const isDev = import.meta.env.DEV;
    if (isDev) {
      console.log('📧 [DEV] Email would be sent:');
      console.log(`From: ${name} <${email}>`);
      console.log(`Subject: ${subject}`);
      console.log(`Message: ${message}`);
      console.log('(MailChannels only works in production on Cloudflare)');
      
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Message sent successfully (dev mode)',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 使用 Cloudflare MailChannels 發送郵件（僅在生產環境）
    const mailResponse = await fetch(
      'https://api.mailchannels.net/tx/v1/send',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailContent),
      }
    );

    if (!mailResponse.ok) {
      const errorText = await mailResponse.text();
      console.error('MailChannels error status:', mailResponse.status);
      console.error('MailChannels error details:', errorText);
      
      // 提供更詳細的錯誤訊息
      let errorMessage = 'Failed to send email';
      if (mailResponse.status === 401) {
        errorMessage = 'Email service authorization failed. Please contact administrator.';
        console.error('⚠️ MailChannels 401: Domain may need SPF/DKIM records configured');
      }
      
      return new Response(JSON.stringify({ 
        error: errorMessage,
        details: import.meta.env.DEV ? errorText : undefined 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('✅ Email sent successfully');
    console.log(`From: ${name} <${email}>`);
    console.log(`Subject: ${subject}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Message sent successfully',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Contact form error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
