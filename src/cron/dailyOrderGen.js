const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { normalizeToStartOfDay, getDayOfWeekShort } = require('../utils/dateUtils');

/**
 * Generate Daily Orders for the target calendar date (default: tomorrow)
 */
async function generateDailyOrdersForDate(targetDate) {
  const dateToGen = targetDate || new Date(Date.now() + 24 * 60 * 60 * 1000);
  const normalizedDate = normalizeToStartOfDay(dateToGen);
  const dayOfWeek = getDayOfWeekShort(normalizedDate);

  logger.info(`Running Daily Order Generator for ${normalizedDate.toISOString().split('T')[0]} (${dayOfWeek})...`);

  // Query all active customers with remaining tiffin balance
  const activeCustomers = await prisma.customer.findMany({
    where: {
      status: 'active',
      tiffins_remaining: { gt: 0 },
    },
    include: {
      plan: {
        include: {
          day_menus: {
            where: { day_of_week: dayOfWeek },
          },
        },
      },
      pause_requests: {
        where: {
          OR: [
            { type: 'indefinite', resumed_at: null },
            {
              type: 'date_range',
              start_date: { lte: normalizedDate },
              end_date: { gte: normalizedDate },
            },
          ],
        },
      },
    },
  });

  let createdCount = 0;

  for (const customer of activeCustomers) {
    // Skip if customer is paused on this date
    if (customer.pause_requests && customer.pause_requests.length > 0) {
      continue;
    }

    const timesPerDay = customer.times_per_day || 1;
    const mealTypes = timesPerDay === 3 ? ['breakfast', 'lunch', 'dinner'] : timesPerDay === 2 ? ['lunch', 'dinner'] : ['lunch'];

    for (const mType of mealTypes) {
      // If Sunday dinner is ~off~ according to menu, skip
      if (dayOfWeek === 'Sun' && mType === 'dinner') {
        continue;
      }

      await prisma.dailyOrder.upsert({
        where: {
          customer_id_date_meal_type: {
            customer_id: customer.id,
            date: normalizedDate,
            meal_type: mType,
          },
        },
        update: {
          delivery_partner_id: customer.delivery_partner_id,
        },
        create: {
          customer_id: customer.id,
          date: normalizedDate,
          meal_type: mType,
          status: 'confirmed',
          roti_paratha_count: 0,
          delivery_partner_id: customer.delivery_partner_id,
        },
      });

      createdCount++;
    }
  }

  logger.info(`Daily Order Generation complete. Processed ${activeCustomers.length} active customers, ensured ${createdCount} orders.`);
  return { activeCustomers: activeCustomers.length, generatedOrders: createdCount };
}

module.exports = {
  generateDailyOrdersForDate,
};
