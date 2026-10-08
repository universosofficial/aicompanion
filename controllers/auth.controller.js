import authService from '../services/auth.service.js';
import userRepository from '../repositories/user.repository.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * AuthController
 * Handles incoming authentication and token cycle HTTP requests.
 */
export class AuthController {
  /**
   * POST /api/auth/register
   * Registers a new user account.
   */
  async register(req, res, next) {
    try {
      const { email, password } = req.body;

      // Validation
      if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_EMAIL',
            message: 'A valid email address is required.',
          },
        });
      }

      if (!password || typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'WEAK_PASSWORD',
            message: 'Password must be at least 8 characters in length.',
          },
        });
      }

      const result = await authService.register({ email, password });

      return res.status(201).json({
        success: true,
        message: 'Account registered successfully.',
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/auth/login
   * Authenticates user credentials and issues JWT tokens.
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_FIELDS',
            message: 'Email and password are required.',
          },
        });
      }

      const result = await authService.login({ email, password });

      return res.status(200).json({
        success: true,
        message: 'Authentication successful.',
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/auth/refresh
   * Exchanges a valid refresh token for a new access token.
   */
  async refresh(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'TOKEN_REQUIRED',
            message: 'Refresh token must be provided in the request body.',
          },
        });
      }

      const result = await authService.refreshToken(refreshToken);

      return res.status(200).json({
        success: true,
        message: 'Access token renewed successfully.',
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/auth/logout
   * Invalidates or clears client-side session.
   */
  async logout(req, res, next) {
    try {
      return res.status(200).json({
        success: true,
        message: 'Logged out successfully.',
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/auth/me
   * Retrieves profile of currently authenticated user.
   */
  async getMe(req, res, next) {
    try {
      const user = await userRepository.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'Authenticated user profile could not be found.',
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          user,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
}

export const authController = new AuthController();
export default authController;
