import authService from '../services/auth.service.js';
import userRepository from '../repositories/user.repository.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * AuthController
 * Handles incoming authentication, email verification, 2FA OTPs, password resets, and token requests.
 */
export class AuthController {
  /**
   * POST /api/auth/register
   * Registers a new user account and dispatches verification OTP via Resend.
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
        message: result.message || 'Verification code sent to your email.',
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/auth/verify-email
   * Confirms registration OTP and issues initial session tokens.
   */
  async verifyEmail(req, res, next) {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_FIELDS',
            message: 'Email and 6-digit verification code are required.',
          },
        });
      }

      const result = await authService.verifyEmail({ email, code });

      return res.status(200).json({
        success: true,
        message: 'Email verified successfully. Welcome to Univasos!',
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/auth/resend-verification
   * Resends registration verification code.
   */
  async resendVerification(req, res, next) {
    try {
      const { email } = req.body;

      if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_EMAIL',
            message: 'A valid email address is required.',
          },
        });
      }

      const result = await authService.resendVerificationCode(email);

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/auth/login
   * Validates credentials and sends a 2FA login verification code via Resend.
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
        message: result.message || 'Login successful.',
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/auth/verify-login-code
   * Validates 2FA login OTP and issues JWT access & refresh tokens.
   */
  async verifyLoginCode(req, res, next) {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_FIELDS',
            message: 'Email and 6-digit login verification code are required.',
          },
        });
      }

      const result = await authService.verifyLoginCode({ email, code });

      return res.status(200).json({
        success: true,
        message: 'Login verification successful.',
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/auth/resend-login-code
   * Resends 2FA login verification code.
   */
  async resendLoginCode(req, res, next) {
    try {
      const { email } = req.body;

      if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_EMAIL',
            message: 'A valid email address is required.',
          },
        });
      }

      const result = await authService.resendLoginCode(email);

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/auth/forgot-password
   * Initiates password recovery flow and sends 6-digit code via Resend.
   */
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;

      if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_EMAIL',
            message: 'A valid email address is required.',
          },
        });
      }

      const result = await authService.forgotPassword(email);

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/auth/reset-password
   * Verifies reset code and updates account password.
   */
  async resetPassword(req, res, next) {
    try {
      const { email, code, newPassword } = req.body;

      if (!email || !code || !newPassword) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_FIELDS',
            message: 'Email, verification code, and new password are required.',
          },
        });
      }

      const result = await authService.resetPassword({ email, code, newPassword });

      return res.status(200).json({
        success: true,
        message: result.message,
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
          user: authService.sanitizeUser(user),
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PUT /api/auth/profile
   * Updates profile information (display_name, avatar_url, bio, phone, location).
   */
  async updateProfile(req, res, next) {
    try {
      const { display_name, avatar_url, bio, phone, location } = req.body;
      const updatedUser = await authService.updateProfile(req.user.id, {
        display_name,
        avatar_url,
        bio,
        phone,
        location,
      });

      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully.',
        data: {
          user: updatedUser,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/auth/change-password
   * Changes authenticated user password with current password verification.
   */
  async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_FIELDS',
            message: 'Both current password and new password are required.',
          },
        });
      }

      const result = await authService.changePassword(req.user.id, {
        currentPassword,
        newPassword,
      });

      return res.status(200).json({
        success: true,
        message: result.message || 'Password updated successfully.',
      });
    } catch (error) {
      return next(error);
    }
  }
}

export const authController = new AuthController();
export default authController;
