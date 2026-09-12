const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { sendOtp, verifyOtp } = require('../services/otp');
const { validate } = require('../middleware/validate');
const { otpLimiter } = require('../middleware/rateLimiter');

// Zod Schemas
const otpRequestSchema = z.object({
  body: z.object({
    phone: z.string().min(10, 'Phone must be at least 10 digits'),
  }),
});

const otpVerifySchema = z.object({
  body: z.object({
    phone: z.string().min(10),
    otp: z.string().length(6, 'OTP must be 6 digits'),
  }),
});

const adminLoginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
  }),
});

const deliveryLoginSchema = z.object({
  body: z.object({
    phone: z.string().min(10, 'Phone must be at least 10 digits'),
    pin: z.string().min(4, 'PIN must be at least 4 digits'),
  }),
});

/**
 * @route POST /api/auth/otp/request
 * @desc Request OTP for customer phone login
 */
router.post('/otp/request', otpLimiter, validate(otpRequestSchema), async (req, res, next) => {
  try {
    const { phone } = req.body;
    const result = await sendOtp(phone);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/auth/otp/verify
 * @desc Verify OTP and issue JWT session token
 */
router.post('/otp/verify', validate(otpVerifySchema), async (req, res, next) => {
  try {
    const { phone, otp } = req.body;
    const cleanPhone = phone.replace(/^\+?91/, '').replace(/^0/, '').trim();

    const isValid = await verifyOtp(cleanPhone, otp);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OTP',
          message: 'Invalid or expired OTP entered.',
        },
      });
    }

    // Check if customer exists
    let customer = await prisma.customer.findUnique({
      where: { phone: cleanPhone },
      include: { plan: true },
    });

    let isNewCustomer = false;
    let token;

    if (customer) {
      token = jwt.sign(
        { customerId: customer.id, phone: customer.phone, role: 'CUSTOMER' },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN }
      );
    } else {
      isNewCustomer = true;
      // Temporary token for registration / subscription completion
      token = jwt.sign(
        { phone: cleanPhone, role: 'NEW_CUSTOMER' },
        env.JWT_SECRET,
        { expiresIn: '2h' }
      );
    }

    res.status(200).json({
      success: true,
      data: {
        token,
        is_new_customer: isNewCustomer,
        customer: customer || { phone: cleanPhone },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/admin/auth/login
 * @desc Admin login with Email + Password
 */
router.post('/admin/login', validate(adminLoginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const admin = await prisma.adminUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!admin) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
        },
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
        },
      });
    }

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, role: admin.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    res.status(200).json({
      success: true,
      data: {
        token,
        admin: {
          id: admin.id,
          email: admin.email,
          role: admin.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/delivery/auth/login
 * @desc Delivery partner login with Phone + PIN
 */
router.post('/delivery/login', validate(deliveryLoginSchema), async (req, res, next) => {
  try {
    const { phone, pin } = req.body;
    const cleanPhone = phone.replace(/^\+?91/, '').replace(/^0/, '').trim();

    const partner = await prisma.deliveryPartner.findUnique({
      where: { phone: cleanPhone },
    });

    if (!partner || !partner.pin_hash) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid phone number or PIN.',
        },
      });
    }

    if (!partner.is_active) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCOUNT_DEACTIVATED', message: 'This delivery partner account is deactivated.' },
      });
    }

    const isMatch = await bcrypt.compare(pin, partner.pin_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid phone number or PIN.',
        },
      });
    }

    const token = jwt.sign(
      { partnerId: partner.id, phone: partner.phone, role: 'DELIVERY_PARTNER' },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    res.status(200).json({
      success: true,
      data: {
        token,
        partner: {
          id: partner.id,
          name: partner.name,
          phone: partner.phone,
          assigned_area: partner.assigned_area,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
