const logger = require('../utils/logger');
const { syncMasterSheet, syncDailySheet } = require('../services/sheetsSync');

/**
 * 15-minute Periodic Batch Google Sheets Mirror Sync
 */
async function runPeriodicSheetsSync() {
  logger.info('Executing scheduled Google Sheets Mirror Batch Sync...');
  try {
    const masterRes = await syncMasterSheet();
    const dailyRes = await syncDailySheet(new Date());
    logger.info('Scheduled Google Sheets Sync finished.');
    return { masterRes, dailyRes };
  } catch (err) {
    logger.error('Error during scheduled Google Sheets sync:', err);
  }
}

module.exports = {
  runPeriodicSheetsSync,
};
