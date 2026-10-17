import baseRepository from './base.repository.js';
import crypto from 'crypto';

/**
 * VerificationCodeRepository
 * Manages database lifecycle for email verification, login 2FA OTPs, and password reset codes.
 */
export class VerificationCodeRepository {
  /**
   * Generates a cryptographically strong 6-digit numeric verification code.
   * @returns {string} 6-digit string
   */
  generateNumericCode() {
    return crypto.randomInt(100000, 999999).toString();
  }

  /**
   * Invalidate existing unused codes of the same type for an email, and insert a new code.
   * @param {Object} params
   * @param {string} params.email
   * @param {'registration'|'login'|'password_reset'} params.type
   * @param {number|null} [params.userId=null]
   * @param {number} [params.expiresInMinutes=15]
   * @returns {Promise<{ code: string, expiresAt: Date }>}
   */
  async createCode({ email, type, userId = null, expiresInMinutes = 15 }) {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Invalidate previous unused codes for this email and type
    await baseRepository.execute(
      `UPDATE auth_verification_codes 
       SET is_used = TRUE 
       WHERE email = ? AND type = ? AND is_used = FALSE`,
      [normalizedEmail, type]
    );

    // 2. Generate new code and expiration
    const code = this.generateNumericCode();
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    // 3. Insert record
    await baseRepository.execute(
      `INSERT INTO auth_verification_codes (user_id, email, code, type, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, normalizedEmail, code, type, expiresAt]
    );

    return { code, expiresAt };
  }

  /**
   * Verify an entered code.
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.code
   * @param {'registration'|'login'|'password_reset'} params.type
   * @param {boolean} [params.consume=true] - Whether to mark the code as used immediately
   * @returns {Promise<{ valid: boolean, record: Object|null }>}
   */
  async verifyCode({ email, code, type, consume = true }) {
    const normalizedEmail = email.toLowerCase().trim();
    const cleanCode = String(code || '').trim();

    const record = await baseRepository.queryOne(
      `SELECT * FROM auth_verification_codes 
       WHERE email = ? AND code = ? AND type = ? AND is_used = FALSE AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1`,
      [normalizedEmail, cleanCode, type]
    );

    if (!record) {
      return { valid: false, record: null };
    }

    if (consume) {
      await baseRepository.execute(
        `UPDATE auth_verification_codes SET is_used = TRUE WHERE id = ?`,
        [record.id]
      );
    }

    return { valid: true, record };
  }

  /**
   * Check if recent code requests exceed rate threshold (anti-abuse).
   * @param {string} email
   * @param {string} type
   * @param {number} [maxAttempts=5]
   * @param {number} [windowMinutes=15]
   * @returns {Promise<boolean>}
   */
  async isRateLimited(email, type, maxAttempts = 5, windowMinutes = 15) {
    const normalizedEmail = email.toLowerCase().trim();
    const row = await baseRepository.queryOne(
      `SELECT COUNT(*) AS count FROM auth_verification_codes
       WHERE email = ? AND type = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [normalizedEmail, type, windowMinutes]
    );

    return (row?.count || 0) >= maxAttempts;
  }
}

export const verificationCodeRepository = new VerificationCodeRepository();
export default verificationCodeRepository;
