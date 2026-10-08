import env from '../config/env.js';

/**
 * Centralized API Error Handling Middleware
 */
export function errorHandler(err, req, res, next) {
  const isDev = env.NODE_ENV === 'development';

  console.error('[API ERROR]', {
    message: err.message,
    code: err.code,
    errno: err.errno,
    sqlState: err.sqlState,
    path: req.originalUrl,
    method: req.method,
    stack: isDev ? err.stack : undefined,
  });

  // MySQL specific errors
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'A resource with the specified unique field already exists.',
      },
    });
  }

  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'FOREIGN_KEY_CONSTRAINT_VIOLATION',
        message: 'The requested operation violates a relational reference constraint.',
      },
    });
  }

  if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST') {
    return res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'The database service is currently unreachable.',
      },
    });
  }

  const statusCode = err.statusCode || (typeof err.status === 'number' ? err.status : 500);

  return res.status(statusCode).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An internal server error occurred.',
      ...(isDev && { stack: err.stack }),
    },
  });
}

export default errorHandler;
