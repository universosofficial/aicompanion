import { Resend } from 'resend';
import env from '../../config/env.js';

/**
 * ResendService
 * Enterprise email dispatch engine powered by Resend API.
 * Handles transactional emails, OTP verification codes, password resets, and companion notifications.
 */
export class ResendService {
  constructor() {
    this.apiKey = env.RESEND_API_KEY || process.env.RESEND_API_KEY || '';
    this.fromEmail = env.RESEND_FROM_EMAIL || 'Univasos <onboarding@resend.dev>';
    this.client = this.apiKey ? new Resend(this.apiKey) : null;

    if (this.apiKey) {
      console.log(`[RESEND EMAIL] Configured with API key (Sender: ${this.fromEmail})`);
    } else {
      console.warn('[RESEND EMAIL] RESEND_API_KEY not configured. Transactional codes will be logged to console in development.');
    }
  }

  /**
   * Send a general email via Resend
   */
  async sendEmail({ to, subject, html, text }) {
    const recipient = Array.isArray(to) ? to : [to];

    // If client is initialized, attempt dispatch via Resend API
    if (this.client) {
      try {
        const { data, error } = await this.client.emails.send({
          from: this.fromEmail,
          to: recipient,
          subject,
          html,
          text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        });

        if (error) {
          console.error('[RESEND EMAIL ERROR]', error);
          // Fallback log to console so developers can still get the OTP code if domain isn't verified
          console.log(`[RESEND FALLBACK] Target: ${recipient.join(', ')} | Subject: "${subject}"`);
          return { success: false, error: error.message, simulated: true };
        }

        console.log(`[RESEND EMAIL SENT] Email dispatched successfully to ${recipient.join(', ')} (ID: ${data?.id})`);
        return { success: true, id: data?.id, simulated: false };
      } catch (err) {
        console.error('[RESEND EMAIL EXCEPTION]', err.message);
        console.log(`[RESEND FALLBACK] Target: ${recipient.join(', ')} | Subject: "${subject}"`);
        return { success: false, error: err.message, simulated: true };
      }
    }

    // Dev/Sandbox simulation when key is not provided
    console.log('====================================================');
    console.log(`[SIMULATED EMAIL - RESEND API KEY NOT CONFIGURED]`);
    console.log(`To:      ${recipient.join(', ')}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:\n${text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
    console.log('====================================================');

    return { success: true, simulated: true };
  }

  /**
   * 1. Send Email Verification Code during account creation
   */
  async sendVerificationEmail({ to, code }) {
    const subject = `${code} is your Univasos verification code`;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your Univasos Account</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #090d16; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #121826; border-radius: 18px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 28px 32px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: 0.5px;">
                Univasos
              </h1>
              <p style="margin: 6px 0 0; font-size: 13px; color: rgba(255, 255, 255, 0.9); font-weight: 500;">
                Your AI Companion &amp; Knowledge Hub
              </p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 600; color: #f8fafc;">
                Confirm your email address
              </h2>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #94a3b8;">
                Welcome to Univasos! To finish setting up your account and start chatting with your AI companions, enter the verification code below:
              </p>

              <!-- OTP Code Display Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 28px;">
                <tr>
                  <td align="center" style="background: #1a2234; border: 1.5px dashed rgba(249, 115, 22, 0.5); border-radius: 12px; padding: 22px 16px;">
                    <span style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #fb923c; display: inline-block;">
                      ${code}
                    </span>
                    <div style="margin-top: 8px; font-size: 12px; color: #94a3b8;">
                      ⏱️ Valid for 15 minutes
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 12.5px; line-height: 1.5; color: #64748b;">
                If you did not create a Univasos account, you can safely ignore this email. Someone may have entered your email address by mistake.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0c101a; padding: 18px 32px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.06);">
              <p style="margin: 0; font-size: 11.5px; color: #64748b;">
                &copy; ${new Date().getFullYear()} Univasos. Secure, private AI companions &amp; thought commons.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    return this.sendEmail({ to, subject, html });
  }

  /**
   * 2. Send Login Verification Code (Two-Factor / 2FA Login OTP)
   */
  async sendLoginVerificationEmail({ to, code }) {
    const subject = `${code} is your Univasos login verification code`;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Univasos Login Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #090d16; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #121826; border-radius: 18px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 26px 32px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">
                Univasos
              </h1>
              <p style="margin: 4px 0 0; font-size: 12.5px; color: rgba(255, 255, 255, 0.9);">
                Security &amp; Account Protection
              </p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="margin: 0 0 12px; font-size: 19px; font-weight: 600; color: #f8fafc;">
                Login Verification Code
              </h2>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #94a3b8;">
                Someone is signing in to your Univasos account. Please enter the following 6-digit code to complete authentication:
              </p>

              <!-- OTP Code Display Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 26px;">
                <tr>
                  <td align="center" style="background: #1a2234; border: 1.5px solid rgba(249, 115, 22, 0.45); border-radius: 12px; padding: 22px 16px;">
                    <span style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #fb923c; display: inline-block;">
                      ${code}
                    </span>
                    <div style="margin-top: 8px; font-size: 12px; color: #94a3b8;">
                      ⏱️ Expires in 15 minutes
                    </div>
                  </td>
                </tr>
              </table>

              <div style="background-color: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding: 12px 16px; border-radius: 6px; margin: 0 0 20px;">
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #fca5a5;">
                  <strong>Did not attempt to log in?</strong> Your password may be compromised. Please reset your password immediately to safeguard your account.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0c101a; padding: 18px 32px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.06);">
              <p style="margin: 0; font-size: 11.5px; color: #64748b;">
                &copy; ${new Date().getFullYear()} Univasos. Never share your verification code with anyone.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    return this.sendEmail({ to, subject, html });
  }

  /**
   * 3. Send Password Reset Code
   */
  async sendPasswordResetEmail({ to, code }) {
    const subject = `${code} is your Univasos password reset code`;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Univasos Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #090d16; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #121826; border-radius: 18px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 26px 32px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">
                Univasos
              </h1>
              <p style="margin: 4px 0 0; font-size: 12.5px; color: rgba(255, 255, 255, 0.9);">
                Password Recovery
              </p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="margin: 0 0 12px; font-size: 19px; font-weight: 600; color: #f8fafc;">
                Reset Your Password
              </h2>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #94a3b8;">
                We received a request to reset your Univasos account password. Use this 6-digit verification code to complete your reset:
              </p>

              <!-- OTP Code Display Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 26px;">
                <tr>
                  <td align="center" style="background: #1a2234; border: 1.5px solid rgba(249, 115, 22, 0.45); border-radius: 12px; padding: 22px 16px;">
                    <span style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #fb923c; display: inline-block;">
                      ${code}
                    </span>
                    <div style="margin-top: 8px; font-size: 12px; color: #94a3b8;">
                      ⏱️ Valid for 15 minutes
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 12.5px; line-height: 1.5; color: #64748b;">
                If you did not request a password reset, no changes have been made to your account. You can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0c101a; padding: 18px 32px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.06);">
              <p style="margin: 0; font-size: 11.5px; color: #64748b;">
                &copy; ${new Date().getFullYear()} Univasos. Private &amp; Secure.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    return this.sendEmail({ to, subject, html });
  }

  /**
   * 4. Send Notification Email via Resend
   * Used for companion proactive check-ins, messages, and important alerts.
   */
  async sendNotificationEmail({ to, title, message, companionName, companionAvatar, actionUrl, actionText }) {
    const name = companionName || 'Your AI Companion';
    const emailSubject = title ? `[Univasos] ${title}` : `New message from ${name}`;
    const cleanUrl = actionUrl || 'https://univasos.com/dashboard/characters';
    const buttonLabel = actionText || `Reply to ${name}`;

    const avatarHtml = companionAvatar 
      ? `<img src="${companionAvatar}" alt="${name}" width="54" height="54" style="border-radius: 50%; object-fit: cover; border: 2px solid #f97316; display: block; margin: 0 auto 12px;" />`
      : `<div style="width: 54px; height: 54px; border-radius: 50%; background: linear-gradient(135deg, #f97316, #ea580c); color: #fff; font-size: 22px; font-weight: bold; line-height: 54px; text-align: center; margin: 0 auto 12px;">${name.charAt(0).toUpperCase()}</div>`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${emailSubject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #090d16; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #121826; border-radius: 18px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);">
          
          <!-- Top Bar -->
          <tr>
            <td style="padding: 24px 32px 16px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <span style="font-size: 18px; font-weight: 700; color: #f97316; letter-spacing: 0.5px;">
                Univasos
              </span>
            </td>
          </tr>

          <!-- Message Card -->
          <tr>
            <td style="padding: 32px 32px 36px; text-align: center;">
              ${avatarHtml}
              <h2 style="margin: 0 0 6px; font-size: 18px; font-weight: 600; color: #ffffff;">
                ${name}
              </h2>
              <span style="display: inline-block; font-size: 11.5px; color: #fb923c; background: rgba(249, 115, 22, 0.12); padding: 3px 10px; border-radius: 12px; margin-bottom: 22px;">
                AI Companion Update
              </span>

              <div style="background-color: #172033; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 20px 24px; text-align: left; margin: 0 0 28px;">
                <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #f1f5f9; font-style: italic;">
                  "${message}"
                </p>
              </div>

              <!-- CTA Button -->
              <table border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 9999px; background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
                    <a href="${cleanUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 9999px;">
                      ${buttonLabel} &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0c101a; padding: 18px 32px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.06);">
              <p style="margin: 0; font-size: 11.5px; color: #64748b;">
                Sent by your AI companion on Univasos &bull; Manage notification settings inside your account.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    return this.sendEmail({ to, subject: emailSubject, html });
  }
}

export const resendService = new ResendService();
export default resendService;
