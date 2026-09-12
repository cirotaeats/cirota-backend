const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

prisma.$connect()
  .then(() => {
    logger.info('Connected to PostgreSQL database via Prisma');
  })
  .catch((err) => {
    logger.error('Failed to connect to database:', err);
  });

module.exports = prisma;
