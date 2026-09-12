const express = require('express');
const router = express.Router();
const { z } = require('zod');
const prisma = require('../config/prisma');
const { authenticateCustomer } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createOrder, verifyWebhookSignature, processWebhookEvent } = require('../services/razorpay');
const logger = require('../utils/logger');

const createOrderSchema = z.object({
  body: z.object({
    plan_id: z.string().min(1, 'Plan ID is required'),
    customer_id: z.string().optional(),
  }),
});

/**
 * @route POST /api/payments/create-order
 * @desc Create a Razorpay order server-side (always fetches amount from DB)
 */
router.post('/create-order', validate(createOrderSchema), async (req, res, next) => {
  try {
    const { plan_id, customer_id } = req.body;
    let targetCustomerId = customer_id;

    // If customer is authenticated, prefer their token customer ID
    if (req.headers.authorization) {
      try {
        const authHeader = req.headers.authorization;
        const token = authHeader.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const env = require('../config/env');
        const decoded = jwt.verify(token, env.JWT_SECRET);
        if (decoded.customerId) {
          targetCustomerId = decoded.customerId;
        }
      } catch (e) {
        // Fall back to body customer_id
      }
    }

    if (!targetCustomerId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_CUSTOMER_ID', message: 'Customer ID is required' },
      });
    }

    const orderData = await createOrder(plan_id, targetCustomerId);

    res.status(200).json({
      success: true,
      data: orderData,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/payments/webhook
 * @desc Handle Razorpay Webhook Event (Raw JSON body required for cryptographic HMAC signature verification)
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.body;

    if (!signature) {
      logger.warn('Razorpay webhook called without signature header.');
      return res.status(400).send('Missing signature');
    }

    // Verify cryptographic HMAC-SHA256 signature
    const isValid = verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      logger.error('Invalid Razorpay webhook signature received.');
      return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    logger.info(`Received verified Razorpay webhook event: ${event.event}`);

    // Process event transactionally
    await processWebhookEvent(event);

    res.status(200).send('ok');
  } catch (error) {
    logger.error('Error handling Razorpay webhook:', error);
    // Return 500 so Razorpay retries if transient error occurs
    res.status(500).send('Webhook processing error');
  }
});

/**
 * @route GET /api/payments/history
 * @desc Get customer's payment history
 */
router.get('/history', authenticateCustomer, async (req, res, next) => {
  try {
    const customerId = req.customer.id;

    const payments = await prisma.payment.findMany({
      where: { customer_id: customerId },
      include: { plan: true },
      orderBy: { created_at: 'desc' },
    });

    res.status(200).json({
      success: true,
      data: payments,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
