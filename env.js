require('dotenv').config();
const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/cirota?schema=public'),
  JWT_SECRET: z.string().default('cirota_super_secret_jwt_key_2026_change_in_prod'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  
  // Razorpay
  RAZORPAY_KEY_ID: z.string().default('rzp_test_placeholder'),
  RAZORPAY_KEY_SECRET: z.string().default('rzp_secret_placeholder'),
  RAZORPAY_WEBHOOK_SECRET: z.string().default('rzp_webhook_secret_placeholder'),

  // Google Sheets
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  MASTER_SHEET_ID: z.string().optional(),
  DAILY_SHEET_ID: z.string().optional(),

  // MSG91 / SMS
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  OTP_MOCK: z.string().default('false'),
  // Only used when OTP_MOCK=true: this fixed code is accepted for any phone number.
  // TESTING ONLY — turn OTP_MOCK off (and set up MSG91) before real customers use the app.
  OTP_MOCK_CODE: z.string().default('123456'),

  // Web Push
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:owner@cirota.in'),

  // CORS
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173,https://cirota.in,https://admin.cirota.in,https://cirotaeatsproject.netlify.app,https://regal-chaja-220da0.netlify.app,https://cirota-admin.netlify.app'),

  // Admin Defaults
  ADMIN_DEFAULT_EMAIL: z.string().default('admin@cirota.in'),
  ADMIN_DEFAULT_PASSWORD: z.string().default('CirotaAdmin#2026'),

  // Delivery Partner Defaults
  DELIVERY_DEFAULT_PIN: z.string().default('1234'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables configuration:', parsedEnv.error.format());
  // In development/testing, do not immediately exit if optional keys are missing
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

const env = parsedEnv.success ? parsedEnv.data : process.env;

module.exports = env;
