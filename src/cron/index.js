const cron = require('node-cron');
const logger = require('../utils/logger');
const { generateDailyOrdersForDate } = require('./dailyOrderGen');
const { runLowBalanceSweep } = require('./lowBalanceSweep');
const { runDuesReminderSweep } = require('./duesReminder');
const { runPeriodicSheetsSync } = require('./sheetsSyncCron');
const { runAutoStopCheck } = require('./autoStopCheck');

function initCronJobs() {
  logger.info('Initializing background cron jobs...');

  // 1. Generate next day's DailyOrder rows nightly at 21:00 IST (15:30 UTC)
  cron.schedule('30 15 * * *', async () => {
    logger.info('[CRON] Starting Nightly DailyOrder generation job...');
    try {
      await generateDailyOrdersForDate();
    } catch (err) {
      logger.error('[CRON] Error during DailyOrder generation:', err);
    }
  });

  // 2. Low-balance push notification sweep daily at 08:00 IST (02:30 UTC)
  cron.schedule('30 2 * * *', async () => {
    logger.info('[CRON] Starting Low-balance push notification sweep...');
    try {
      await runLowBalanceSweep();
    } catch (err) {
      logger.error('[CRON] Error during Low-balance sweep:', err);
    }
  });

  // 3. Due-date / payment reminder sweep daily at 09:00 IST (03:30 UTC)
  cron.schedule('30 3 * * *', async () => {
    logger.info('[CRON] Starting Dues & payment reminder sweep...');
    try {
      await runDuesReminderSweep();
    } catch (err) {
      logger.error('[CRON] Error during Dues reminder sweep:', err);
    }
  });

  // 4. Google Sheets mirror batch sync every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runPeriodicSheetsSync();
    } catch (err) {
      logger.error('[CRON] Error during periodic Sheets sync:', err);
    }
  });

  // 5. Auto-stop enforcement safety-net sweep every hour
  cron.schedule('0 * * * *', async () => {
    try {
      await runAutoStopCheck();
    } catch (err) {
      logger.error('[CRON] Error during Auto-Stop enforcement:', err);
    }
  });

  logger.info('All cron schedules registered successfully.');
}

module.exports = {
  initCronJobs,
};
