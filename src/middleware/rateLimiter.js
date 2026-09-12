const rateLimit = require('express-rate-limit');

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // max 300 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again after 15 minutes',
    },
  },
});

// Strict OTP Request Limiter
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // max 5 OTP requests per IP per 10 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'OTP_RATE_LIMIT_EXCEEDED',
      message: 'Too many OTP requests from this IP. Please wait 10 minutes.',
    },
  },
});

module.exports = {
  apiLimiter,
  otpLimiter,
};
