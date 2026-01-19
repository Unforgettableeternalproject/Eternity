export const prerender = false;

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
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

    // 開發環境：只記錄，不實際發送
    const isDev = import.meta.env.DEV;
    if (isDev) {
      console.log('📧 [DEV] Email would be sent:');
      console.log(`From: ${name} <${email}>`);
      console.log(`Subject: ${subject}`);
      console.log(`Message: ${message}`);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Message sent successfully (dev mode)',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 使用 Resend API 發送郵件（生產環境）
    // Cloudflare Pages: 私密環境變數通過 locals.runtime.env 訪問
    // 本地開發: 通過 import.meta.env 訪問
    const RESEND_API_KEY =
      (locals.runtime?.env?.RESEND_API_KEY as string | undefined) ||
      (import.meta.env.RESEND_API_KEY as string | undefined);

    if (!RESEND_API_KEY) {
      console.error('❌ RESEND_API_KEY environment variable not set');
      console.error(
        'Runtime env:',
        locals.runtime?.env ? 'available' : 'not available'
      );
      return new Response(
        JSON.stringify({
          error: 'Email service not configured. Please contact administrator.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('🚀 Attempting to send email via Resend...');
    console.log('Reply-to:', email);

    const mailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Eternity Contact <noreply@unforgettableeternalproject.com>',
        to: ['ptyc4076@gmail.com'],
        reply_to: email,
        subject: `[Contact Form] ${subject}`,
        html: `
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
      }),
    });

    console.log('Resend response status:', mailResponse.status);

    if (!mailResponse.ok) {
      const errorData = await mailResponse.json();
      console.error('❌ Resend error:', errorData);

      return new Response(
        JSON.stringify({
          error: 'Failed to send email',
          statusCode: mailResponse.status,
          details: errorData,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const responseData = await mailResponse.json();
    console.log('✅ Email sent successfully via Resend');
    console.log(`📧 Email ID: ${responseData.id}`);

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
