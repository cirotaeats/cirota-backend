const webpush = require('web-push');
const prisma = require('../config/prisma');
const env = require('../config/env');
const logger = require('../utils/logger');

// Initialize Web Push with VAPID details if configured
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT,
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY
    );
    logger.info('Web Push VAPID initialized successfully');
  } catch (err) {
    logger.error('Failed to configure VAPID details:', err);
  }
} else {
  logger.warn('Web Push VAPID keys not configured in environment.');
}

/**
 * Send push notification to all subscriptions of a customer
 */
async function sendPushNotification(customerId, payload) {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { customer_id: customerId },
  });

  if (!subscriptions || subscriptions.length === 0) {
    return { sent: 0, failed: 0 };
  }

  let sentCount = 0;
  let failedCount = 0;

  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        payloadString
      );
      sentCount++;
    } catch (err) {
      failedCount++;
      // If subscription expired / unsubscribed (410 Gone or 404 Not Found), delete it
      if (err.statusCode === 410 || err.statusCode === 404) {
        logger.info(`Push subscription expired (${err.statusCode}). Cleaning up endpoint: ${sub.endpoint}`);
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      } else {
        logger.error(`Error sending push notification to subscription ${sub.id}:`, err.message);
      }
    }
  }

  return { sent: sentCount, failed: failedCount };
}

/**
 * Helper to send low balance push notification
 */
async function sendLowBalancePush(customer) {
  const payload = {
    title: 'Cirota Tiffin Alert 🍱',
    body: `Only ${customer.tiffins_remaining} tiffins left in your subscription — renew soon to ensure uninterrupted delivery!`,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    url: '/renew',
    data: {
      type: 'low_balance',
      remaining: customer.tiffins_remaining,
    },
  };

  return await sendPushNotification(customer.id, payload);
}

module.exports = {
  sendPushNotification,
  sendLowBalancePush,
};
