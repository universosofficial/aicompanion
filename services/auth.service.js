import userRepository from '../repositories/user.repository.js';
import verificationCodeRepository from '../repositories/verification-code.repository.js';
import tokenService from './token.service.js';
import resendService from './email/resend.service.js';

// Robust bcrypt loader (prefers native bcrypt, falls back to bcryptjs)
let hasher;
try {
  const mod = await import('bcrypt');
  hasher = mod.default || mod;
} catch {
  const mod = await import('bcryptjs');
  hasher = mod.default || mod;
}

/**
 * AuthService
 * Orchestrates registration, email verification, 2FA login verification, password recovery, and token cycle.
 */
export class AuthService {
  /**
   * Register a new user account with mandatory email verification.
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.password
   * @returns {Promise<Object>}
   */
  async register({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await userRepository.findByEmail(normalizedEmail);
    if (existingUser) {
      if (existingUser.is_verified) {
        const error = new Error('A user with this email address already exists.');
        error.statusCode = 409;
        error.code = 'USER_ALREADY_EXISTS';
        throw error;
      }

      // Existing unverified user: update password and issue a fresh registration code
      const passwordHash = await hasher.hash(password, 10);
      await userRepository.updatePassword(normalizedEmail, passwordHash);

      const { code } = await verificationCodeRepository.createCode({
        email: normalizedEmail,
        type: 'registration',
        userId: existingUser.id,
      });

      await resendService.sendVerificationEmail({ to: normalizedEmail, code });

      return {
        email: normalizedEmail,
        requireVerification: true,
        message: 'Account exists but is unverified. A new verification code was sent to your email.',
      };
    }

    // Hash password with salt rounds = 10
    const passwordHash = await hasher.hash(password, 10);

    // Create user in database (is_verified = false)
    const user = await userRepository.create({
      email: normalizedEmail,
      passwordHash,
      role: 'user',
      isVerified: false,
    });

    // Generate 6-digit registration code
    const { code } = await verificationCodeRepository.createCode({
      email: normalizedEmail,
      type: 'registration',
      userId: user.id,
    });

    // Dispatch verification email via Resend
    await resendService.sendVerificationEmail({ to: normalizedEmail, code });

    return {
      email: normalizedEmail,
      requireVerification: true,
      message: 'Account registered. Please enter the 6-digit verification code sent to your email.',
    };
  }

  /**
   * Confirm email address with verification code.
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.code
   * @returns {Promise<{ user: Object, accessToken: string, refreshToken: string }>}
   */
  async verifyEmail({ email, code }) {
    const normalizedEmail = email.toLowerCase().trim();

    const { valid } = await verificationCodeRepository.verifyCode({
      email: normalizedEmail,
      code,
      type: 'registration',
      consume: true,
    });

    if (!valid) {
      const error = new Error('Invalid or expired verification code. Please request a new one.');
      error.statusCode = 400;
      error.code = 'INVALID_VERIFICATION_CODE';
      throw error;
    }

    // Mark email verified
    await userRepository.markEmailVerified(normalizedEmail);
    const user = await userRepository.findByEmail(normalizedEmail);

    if (!user || !user.is_active) {
      const error = new Error('User account is deactivated.');
      error.statusCode = 403;
      error.code = 'ACCOUNT_DEACTIVATED';
      throw error;
    }

    const sanitizedUser = this.sanitizeUser(user);
    const accessToken = tokenService.generateAccessToken(sanitizedUser);
    const refreshToken = tokenService.generateRefreshToken(sanitizedUser);

    return {
      user: sanitizedUser,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Resend account creation verification code.
   * @param {string} email
   * @returns {Promise<Object>}
   */
  async resendVerificationCode(email) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await userRepository.findByEmail(normalizedEmail);

    if (!user) {
      const error = new Error('No account found with this email address.');
      error.statusCode = 404;
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    if (user.is_verified) {
      return {
        alreadyVerified: true,
        message: 'Your email is already verified. You can sign in.',
      };
    }

    const isLimited = await verificationCodeRepository.isRateLimited(normalizedEmail, 'registration', 5, 15);
    if (isLimited) {
      const error = new Error('Too many verification requests. Please wait a few minutes before trying again.');
      error.statusCode = 429;
      error.code = 'RATE_LIMITED';
      throw error;
    }

    const { code } = await verificationCodeRepository.createCode({
      email: normalizedEmail,
      type: 'registration',
      userId: user.id,
    });

    await resendService.sendVerificationEmail({ to: normalizedEmail, code });

    return {
      success: true,
      message: 'A fresh verification code has been sent to your email.',
    };
  }

  /**
   * Log in with email and password, issuing JWT session tokens directly.
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.password
   * @returns {Promise<{ user: Object, accessToken: string, refreshToken: string }>}
   */
  async login({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    // Retrieve user including password_hash
    const user = await userRepository.findByEmail(normalizedEmail);
    if (!user) {
      const error = new Error('Invalid email or password.');
      error.statusCode = 401;
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    if (!user.is_active) {
      const error = new Error('Account is deactivated. Please contact support.');
      error.statusCode = 403;
      error.code = 'ACCOUNT_DEACTIVATED';
      throw error;
    }

    // Verify password hash
    const isPasswordValid = await hasher.compare(password, user.password_hash);
    if (!isPasswordValid) {
      const error = new Error('Invalid email or password.');
      error.statusCode = 401;
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    // If account was created and unverified, auto-verify upon successful credential presentation
    if (!user.is_verified) {
      await userRepository.markEmailVerified(normalizedEmail);
      user.is_verified = true;
    }

    // Update last login timestamp
    await userRepository.updateLastLogin(user.id);

    // Generate session tokens directly
    const sanitizedUser = this.sanitizeUser(user);
    const accessToken = tokenService.generateAccessToken(sanitizedUser);
    const refreshToken = tokenService.generateRefreshToken(sanitizedUser);

    return {
      user: sanitizedUser,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Primary Login Step 2: Verify 2FA Login Code and issue JWT session tokens.
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.code
   * @returns {Promise<{ user: Object, accessToken: string, refreshToken: string }>}
   */
  async verifyLoginCode({ email, code }) {
    const normalizedEmail = email.toLowerCase().trim();

    const { valid } = await verificationCodeRepository.verifyCode({
      email: normalizedEmail,
      code,
      type: 'login',
      consume: true,
    });

    if (!valid) {
      const error = new Error('Invalid or expired login verification code.');
      error.statusCode = 400;
      error.code = 'INVALID_LOGIN_CODE';
      throw error;
    }

    const user = await userRepository.findByEmail(normalizedEmail);
    if (!user || !user.is_active) {
      const error = new Error('User not found or account is deactivated.');
      error.statusCode = 403;
      error.code = 'ACCOUNT_DEACTIVATED';
      throw error;
    }

    // Update last login timestamp
    await userRepository.updateLastLogin(user.id);

    const sanitizedUser = this.sanitizeUser(user);
    const accessToken = tokenService.generateAccessToken(sanitizedUser);
    const refreshToken = tokenService.generateRefreshToken(sanitizedUser);

    return {
      user: sanitizedUser,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Resend 2FA login verification code.
   * @param {string} email
   * @returns {Promise<Object>}
   */
  async resendLoginCode(email) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await userRepository.findByEmail(normalizedEmail);

    if (!user || !user.is_active) {
      const error = new Error('Invalid account state.');
      error.statusCode = 400;
      throw error;
    }

    const isLimited = await verificationCodeRepository.isRateLimited(normalizedEmail, 'login', 5, 15);
    if (isLimited) {
      const error = new Error('Too many attempts. Please wait a few moments before requesting another code.');
      error.statusCode = 429;
      error.code = 'RATE_LIMITED';
      throw error;
    }

    const { code } = await verificationCodeRepository.createCode({
      email: normalizedEmail,
      type: 'login',
      userId: user.id,
    });

    await resendService.sendLoginVerificationEmail({ to: normalizedEmail, code });

    return {
      success: true,
      message: 'A fresh login verification code has been sent to your email.',
    };
  }

  /**
   * Forgot Password: Dispatch password recovery code via Resend.
   * @param {string} email
   * @returns {Promise<Object>}
   */
  async forgotPassword(email) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await userRepository.findByEmail(normalizedEmail);

    // Protect against account enumeration: return consistent success message
    if (!user || !user.is_active) {
      return {
        success: true,
        message: 'If an account exists with this email, a 6-digit password reset code has been sent.',
      };
    }

    const isLimited = await verificationCodeRepository.isRateLimited(normalizedEmail, 'password_reset', 5, 15);
    if (isLimited) {
      const error = new Error('Too many password reset requests. Please wait a few minutes before trying again.');
      error.statusCode = 429;
      error.code = 'RATE_LIMITED';
      throw error;
    }

    const { code } = await verificationCodeRepository.createCode({
      email: normalizedEmail,
      type: 'password_reset',
      userId: user.id,
    });

    await resendService.sendPasswordResetEmail({ to: normalizedEmail, code });

    return {
      success: true,
      message: 'If an account exists with this email, a 6-digit password reset code has been sent.',
    };
  }

  /**
   * Reset Password: Verify code and set new password.
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.code
   * @param {string} params.newPassword
   * @returns {Promise<Object>}
   */
  async resetPassword({ email, code, newPassword }) {
    const normalizedEmail = email.toLowerCase().trim();

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      const error = new Error('New password must be at least 8 characters in length.');
      error.statusCode = 400;
      error.code = 'WEAK_PASSWORD';
      throw error;
    }

    const { valid } = await verificationCodeRepository.verifyCode({
      email: normalizedEmail,
      code,
      type: 'password_reset',
      consume: true,
    });

    if (!valid) {
      const error = new Error('Invalid or expired password reset code. Please request a new code.');
      error.statusCode = 400;
      error.code = 'INVALID_RESET_CODE';
      throw error;
    }

    const passwordHash = await hasher.hash(newPassword, 10);
    await userRepository.updatePassword(normalizedEmail, passwordHash);

    return {
      success: true,
      message: 'Your password has been reset successfully. You can now sign in with your new password.',
    };
  }

  /**
   * Refresh access token using a valid refresh token.
   * @param {string} token
   * @returns {Promise<{ accessToken: string }>}
   */
  async refreshToken(token) {
    if (!token) {
      const error = new Error('Refresh token is required.');
      error.statusCode = 400;
      error.code = 'TOKEN_MISSING';
      throw error;
    }

    let decoded;
    try {
      decoded = tokenService.verifyRefreshToken(token);
    } catch (err) {
      const error = new Error('Invalid or expired refresh token.');
      error.statusCode = 401;
      error.code = 'INVALID_REFRESH_TOKEN';
      throw error;
    }

    // Verify user exists and is active
    const user = await userRepository.findById(decoded.id);
    if (!user || !user.is_active) {
      const error = new Error('User not found or account is deactivated.');
      error.statusCode = 403;
      error.code = 'USER_INACTIVE';
      throw error;
    }

    const accessToken = tokenService.generateAccessToken(user);
    return { accessToken };
  }

  /**
   * Update profile information for the authenticated user.
   */
  async updateProfile(userId, { display_name, avatar_url, bio, phone, location }) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('User not found.');
      error.statusCode = 404;
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const updated = await userRepository.updateProfile(userId, {
      display_name,
      avatar_url,
      bio,
      phone,
      location,
    });

    return this.sanitizeUser(updated);
  }

  /**
   * Change password for the authenticated user.
   */
  async changePassword(userId, { currentPassword, newPassword }) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('User not found.');
      error.statusCode = 404;
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    // Must fetch user with password_hash
    const fullUser = await userRepository.findByEmail(user.email);
    const isMatch = await hasher.compare(currentPassword, fullUser.password_hash);
    if (!isMatch) {
      const error = new Error('Current password is incorrect.');
      error.statusCode = 400;
      error.code = 'INVALID_CURRENT_PASSWORD';
      throw error;
    }

    if (!newPassword || newPassword.length < 8) {
      const error = new Error('New password must be at least 8 characters in length.');
      error.statusCode = 400;
      error.code = 'WEAK_PASSWORD';
      throw error;
    }

    const newHash = await hasher.hash(newPassword, 12);
    await userRepository.updatePasswordById(userId, newHash);

    return { message: 'Password updated successfully.' };
  }

  /**
   * Strip password_hash and internal artifacts from user payload.
   * @param {Object} user
   * @returns {Object} Sanitized user
   */
  sanitizeUser(user) {
    if (!user) return null;
    const { password_hash, ...sanitized } = user;
    return {
      ...sanitized,
      vasos_balance: user.vasos_balance !== undefined && user.vasos_balance !== null ? Number(user.vasos_balance) : 999999,
      has_unlimited_vasos: user.has_unlimited_vasos !== undefined ? Boolean(user.has_unlimited_vasos) : true,
      token_symbol: '◈',
      token_name: 'Vasos',
      token_code: 'VASO',
    };
  }
}

export const authService = new AuthService();
export default authService;
