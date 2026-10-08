import userRepository from '../repositories/user.repository.js';
import tokenService from './token.service.js';

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
 * Orchestrates registration, credential authentication, and session token renewal.
 */
export class AuthService {
  /**
   * Register a new user account.
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.password
   * @returns {Promise<{ user: Object, accessToken: string, refreshToken: string }>}
   */
  async register({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await userRepository.findByEmail(normalizedEmail);
    if (existingUser) {
      const error = new Error('A user with this email address already exists.');
      error.statusCode = 409;
      error.code = 'USER_ALREADY_EXISTS';
      throw error;
    }

    // Hash password with salt rounds = 10
    const passwordHash = await hasher.hash(password, 10);

    // Create user in database
    const user = await userRepository.create({
      email: normalizedEmail,
      passwordHash,
      role: 'user',
    });

    // Generate tokens
    const accessToken = tokenService.generateAccessToken(user);
    const refreshToken = tokenService.generateRefreshToken(user);

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  /**
   * Authenticate existing user with credentials.
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

    // Update last activity timestamp
    await userRepository.updateLastLogin(user.id);

    const sanitizedUser = this.sanitizeUser(user);

    // Generate tokens
    const accessToken = tokenService.generateAccessToken(sanitizedUser);
    const refreshToken = tokenService.generateRefreshToken(sanitizedUser);

    return {
      user: sanitizedUser,
      accessToken,
      refreshToken,
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
   * Strip password_hash and internal artifacts from user payload.
   * @param {Object} user
   * @returns {Object} Sanitized user
   */
  sanitizeUser(user) {
    if (!user) return null;
    const { password_hash, ...sanitized } = user;
    return sanitized;
  }
}

export const authService = new AuthService();
export default authService;
