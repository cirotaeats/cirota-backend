const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/prisma');
const logger = require('./utils/logger');
const { initCronJobs } = require('./cron');

const PORT = env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`=======================================================`);
  logger.info(`🚀 Cirota Production Backend running on port ${PORT}`);
  logger.info(`🌐 Environment: ${env.NODE_ENV}`);
  logger.info(`🍱 Health Check: http://localhost:${PORT}/health`);
  logger.info(`=======================================================`);

  // Initialize Background Cron Jobs
  initCronJobs();
});

// Graceful Shutdown
function handleShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  server.close(async () => {
    logger.info('HTTP server closed.');
    await prisma.$disconnect();
    logger.info('Database connection closed.');
    process.exit(0);
  });

  // Force close if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
