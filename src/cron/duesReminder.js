const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { sendPushNotification } = require('../services/webPush');
const { normalizeToStartOfDay } = require('../utils/dateUtils');

/**
 * Daily sweep for customers with outstanding dues or past due_date
 */
async function runDuesReminderSweep() {
  logger.info('Running dues & payment reminder sweep...');

  const todayStart = normalizeToStartOfDay(new Date());

  const dueCustomers = await prisma.customer.findMany({
    where: {
      OR: [
        { due_amount: { gt: 0 } },
        {
          due_date: { lte: new Date() },
          status: 'active',
        },
      ],
    },
  });

  let sentCount = 0;

  for (const customer of dueCustomers) {
    const alreadySentToday = await prisma.notificationLog.findFirst({
      where: {
        customer_id: customer.id,
        type: 'payment_due',
        sent_at: { gte: todayStart },
      },
    });

    if (alreadySentToday) continue;

    try {
      const amountMsg = customer.due_amount > 0 ? ` of ₹${customer.due_amount}` : '';
      await sendPushNotification(customer.id, {
        title: 'Cirota Payment Due Reminder 💳',
        body: `Your subscription payment${amountMsg} is due. Please pay via the app to maintain active delivery.`,
        url: '/payment',
        data: { type: 'payment_due', due_amount: customer.due_amount },
      });

      await prisma.notificationLog.create({
        data: {
          customer_id: customer.id,
          type: 'payment_due',
          message: `Payment due reminder: ₹${customer.due_amount}`,
        },
      });

      sentCount++;
    } catch (err) {
      logger.error(`Error sending dues reminder to customer ${customer.id}:`, err);
    }
  }

  logger.info(`Dues reminder sweep completed. Sent ${sentCount} reminders.`);
  return { evaluated: dueCustomers.length, notified: sentCount };
}

module.exports = {
  runDuesReminderSweep,
};
