const express = require('express');
const router = express.Router();
const env = require('../config/env');
const { authenticateCustomer } = require('../middleware/auth');
const { sendPushNotification } = require('../services/webPush');

/**
 * @route GET /api/push/vapid-public-key
 * @desc Get VAPID public key for frontend push subscription registration
 */
router.get('/vapid-public-key', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      vapid_public_key: env.VAPID_PUBLIC_KEY || null,
    },
  });
});

/**
 * @route POST /api/push/test
 * @desc Test sending push notification to logged in user
 */
router.post('/test', authenticateCustomer, async (req, res, next) => {
  try {
    const customerId = req.customer.id;
    const { title, body } = req.body;

    const result = await sendPushNotification(customerId, {
      title: title || 'Cirota Test Notification 🔔',
      body: body || 'This is a test notification from Cirota Tiffin System.',
    });

    res.status(200).json({
      success: true,
      message: `Push notification sent. Delivered: ${result.sent}, Failed: ${result.failed}`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
