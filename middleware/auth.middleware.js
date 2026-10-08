import tokenService from '../services/token.service.js';

/**
 * JWT Authentication Middleware
 * Validates the Authorization Bearer token and attaches decoded user claims to req.user.
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication token is missing or malformed.',
      },
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = tokenService.verifyAccessToken(token);
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError' 
      ? 'Access token has expired.' 
      : 'Invalid authentication token.';

    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message,
      },
    });
  }
}

export default authenticateToken;
