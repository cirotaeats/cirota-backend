const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { sendLowBalancePush } = require('../services/webPush');
const { normalizeToStartOfDay } = require('../utils/dateUtils');

/**
 * Daily sweep for customers with low balance (< 10 tiffins)
 * Guarantees exactly one notification per customer per day while condition holds.
 */
async function runLowBalanceSweep() {
  logger.info('Running low-balance notification sweep (< 10 tiffins)...');

  const todayStart = normalizeToStartOfDay(new Date());

  // 1. Find all active customers with tiffins_remaining < 10
  const lowBalanceCustomers = await prisma.customer.findMany({
    where: {
      status: 'active',
      tiffins_remaining: { lt: 10, gt: 0 },
    },
  });

  let notifiedCount = 0;

  for (const customer of lowBalanceCustomers) {
    // 2. Check if notification already sent today
    const alreadySentToday = await prisma.notificationLog.findFirst({
      where: {
        customer_id: customer.id,
        type: 'low_balance',
        sent_at: { gte: todayStart },
      },
    });

    if (alreadySentToday) {
      continue;
    }

    // 3. Dispatch Push Notification
    try {
      await sendLowBalancePush(customer);

      // 4. Record Notification Log
      await prisma.notificationLog.create({
        data: {
          customer_id: customer.id,
          type: 'low_balance',
          message: `Low balance alert: ${customer.tiffins_remaining} tiffins remaining`,
        },
      });

      notifiedCount++;
    } catch (err) {
      logger.error(`Failed to send low balance push to customer ${customer.id}:`, err);
    }
  }

  logger.info(`Low balance sweep completed. Sent ${notifiedCount} notifications out of ${lowBalanceCustomers.length} low balance customers.`);
  return { evaluated: lowBalanceCustomers.length, notified: notifiedCount };
}

module.exports = {
  runLowBalanceSweep,
};
