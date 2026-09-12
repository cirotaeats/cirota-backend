const axios = require('axios');
const prisma = require('../config/prisma');
const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * Send 6-digit OTP to Indian phone number (MSG91 or Dev/Mock)
 */
async function sendOtp(phone) {
  // Clean phone number (strip leading +91 or 0)
  const cleanPhone = phone.replace(/^\+?91/, '').replace(/^0/, '').trim();
  if (!/^\d{10}$/.test(cleanPhone)) {
    throw new Error('Invalid Indian phone number. Must be 10 digits.');
  }

  // Rate Limiting Check: max 3 OTP requests in last 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const recentOtpCount = await prisma.otpRequest.count({
    where: {
      phone: cleanPhone,
      created_at: { gte: tenMinutesAgo },
    },
  });

  if (recentOtpCount >= 3) {
    throw new Error('Too many OTP requests. Please wait a few minutes before trying again.');
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

  // Save in database
  await prisma.otpRequest.create({
    data: {
      phone: cleanPhone,
      otp,
      expires_at: expiresAt,
      used: false,
    },
  });

  // Check if MSG91 is configured
  if (env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID && env.OTP_MOCK !== 'true') {
    try {
      await axios.post(
        'https://control.msg91.com/api/v5/otp',
        {
          template_id: env.MSG91_TEMPLATE_ID,
          mobile: `91${cleanPhone}`,
          otp,
        },
        {
          headers: {
            authkey: env.MSG91_AUTH_KEY,
            'content-type': 'application/json',
          },
        }
      );
      logger.info(`MSG91 OTP sent successfully to 91${cleanPhone}`);
    } catch (err) {
      logger.error('Failed to send OTP via MSG91 API:', err.response?.data || err.message);
      // Still allow flow if dev mode fallback
      if (env.NODE_ENV === 'development') {
        logger.warn(`[DEV FALLBACK] OTP for ${cleanPhone} is: ${otp}`);
      } else {
        throw new Error('SMS service temporarily unavailable. Please try again later.');
      }
    }
  } else {
    // Development / Mock mode
    logger.info(`[DEV / MOCK OTP] Generated OTP for ${cleanPhone}: ${otp}`);
  }

  return { success: true, message: 'OTP sent successfully', phone: cleanPhone };
}

/**
 * Verify OTP submitted by customer
 */
async function verifyOtp(phone, submittedOtp) {
  const cleanPhone = phone.replace(/^\+?91/, '').replace(/^0/, '').trim();

  const record = await prisma.otpRequest.findFirst({
    where: {
      phone: cleanPhone,
      otp: submittedOtp.trim(),
      expires_at: { gt: new Date() },
      used: false,
    },
    orderBy: { created_at: 'desc' },
  });

  if (!record) {
    return false;
  }

  // Mark as used
  await prisma.otpRequest.update({
    where: { id: record.id },
    data: { used: true },
  });

  return true;
}

module.exports = {
  sendOtp,
  verifyOtp,
};
