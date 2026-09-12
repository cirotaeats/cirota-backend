const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { logAuditEvent } = require('../services/audit');
const { normalizeToStartOfDay } = require('../utils/dateUtils');

/**
 * Safety-net auto-stop sweep:
 * Checks for any customer whose tiffins_remaining <= 0 but status is still 'active',
 * and safely updates status to 'stopped_no_balance' to prevent unbilled orders.
 */
async function runAutoStopCheck() {
  logger.info('Running Auto-Stop Safety Net Sweep...');

  const stoppedCustomers = await prisma.customer.findMany({
    where: {
      tiffins_remaining: { lte: 0 },
      status: { in: ['active', 'paused_next_meal'] },
    },
  });

  let updatedCount = 0;

  for (const customer of stoppedCustomers) {
    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customer.id },
        data: { status: 'stopped_no_balance' },
      });

      // Pause or delete any future daily orders
      await tx.dailyOrder.deleteMany({
        where: {
          customer_id: customer.id,
          date: { gte: normalizeToStartOfDay(new Date()) },
          status: { in: ['pending', 'confirmed'] },
        },
      });

      await logAuditEvent({
        entityType: 'Customer',
        entityId: customer.id,
        action: 'AUTO_STOP_NO_BALANCE',
        previousState: { status: customer.status, tiffins_remaining: customer.tiffins_remaining },
        newState: { status: 'stopped_no_balance' },
        db: tx,
      });
    });

    updatedCount++;
  }

  logger.info(`Auto-Stop Sweep completed. Updated ${updatedCount} customer statuses to stopped_no_balance.`);
  return { evaluated: stoppedCustomers.length, updated: updatedCount };
}

module.exports = {
  runAutoStopCheck,
};
