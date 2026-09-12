const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const prisma = require('./config/prisma');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

// Import Route Handlers
const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customer');
const paymentsRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const menuRoutes = require('./routes/menu');
const pushRoutes = require('./routes/push');
const deliveryRoutes = require('./routes/delivery');

const app = express();

// Security Headers
app.use(helmet());

// CORS Configuration (explicitly allows cirota.in and admin.cirota.in)
const allowedOrigins = (env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy blocked access from origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-razorpay-signature'],
  })
);

// HTTP Logging
app.use(
  morgan('short', {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

// Apply General Rate Limiter to all API routes
app.use('/api', apiLimiter);

// Note: /api/payments/webhook handles its own raw body middleware
// JSON body parser for standard routes
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payments/webhook') {
    next();
  } else {
    express.json({ limit: '1mb' })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true }));

/**
 * Health Check Smoke-Test Endpoint
 */
app.get('/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = `error: ${err.message}`;
  }

  res.status(200).json({
    status: 'healthy',
    service: 'cirota-backend',
    version: '1.0.0',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: dbStatus,
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/delivery', deliveryRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `API endpoint '${req.method} ${req.originalUrl}' does not exist`,
    },
  });
});

// Global Error Handler
app.use(errorHandler);

module.exports = app;
