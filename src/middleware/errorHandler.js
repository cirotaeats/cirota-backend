const logger = require('../utils/logger');

/**
 * Central Error Handler Middleware
 */
function errorHandler(err, req, res, next) {
  logger.error('Unhandled Error caught in middleware:', {
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
  });

  // Handle SyntaxError from bad JSON
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload provided',
      },
    });
  }

  // Handle Prisma Known Errors (like unique constraint violation)
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: `Unique constraint failed on field(s): ${err.meta?.target || 'unknown'}`,
      },
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Requested record was not found in database',
      },
    });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

module.exports = errorHandler;
