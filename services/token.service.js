import jwt from 'jsonwebtoken';
import env from '../config/env.js';

/**
 * TokenService
 * Manages JWT generation and verification for authentication and refresh cycles.
 */
export class TokenService {
  /**
   * Generates a short-lived access token (15m).
   * @param {Object} payload - User identity payload { id, email, role }
   * @returns {string} Signed JWT access token
   */
  generateAccessToken(payload) {
    const claims = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
    };
    return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  }

  /**
   * Generates a long-lived refresh token (7d).
   * @param {Object} payload - User identity payload { id, email, role }
   * @returns {string} Signed JWT refresh token
   */
  generateRefreshToken(payload) {
    const claims = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
    };
    return jwt.sign(claims, env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  }

  /**
   * Verifies an access token.
   * @param {string} token
   * @returns {Object} Decoded payload
   * @throws {Error} If token is invalid or expired
   */
  verifyAccessToken(token) {
    return jwt.verify(token, env.JWT_ACCESS_SECRET);
  }

  /**
   * Verifies a refresh token.
   * @param {string} token
   * @returns {Object} Decoded payload
   * @throws {Error} If token is invalid or expired
   */
  verifyRefreshToken(token) {
    return jwt.verify(token, env.JWT_REFRESH_SECRET);
  }
}

export const tokenService = new TokenService();
export default tokenService;
