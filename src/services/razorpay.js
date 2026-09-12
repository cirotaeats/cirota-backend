const Razorpay = require('razorpay');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const env = require('../config/env');
const logger = require('../utils/logger');
const { logAuditEvent } = require('./audit');

// Initialize Razorpay client
let razorpay = null;
const isPlaceholderKey =
  !env.RAZORPAY_KEY_ID ||
  env.RAZORPAY_KEY_ID.includes('placeholder') ||
  !env.RAZORPAY_KEY_SECRET ||
  env.RAZORPAY_KEY_SECRET.includes('placeholder');

if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && !isPlaceholderKey) {
  razorpay = new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
}

/**
 * Create a new Razorpay Order server-side using plan's total_price (never trust client)
 */
async function createOrder(planId, customerId) {
  const plan = await prisma.plan.findUniqueOrThrow({
    where: { id: planId },
  });

  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
  });

  const amountInPaise = Math.round(plan.total_price * 100);
  const receipt = `cirota_${customerId.slice(-6)}_${Date.now()}`;

  let razorpayOrderId;

  if (razorpay) {
    try {
      const rzpOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt,
        notes: {
          customerId,
          planId,
          planName: plan.name,
        },
      });
      razorpayOrderId = rzpOrder.id;
    } catch (err) {
      if (env.NODE_ENV !== 'production') {
        logger.warn(`Razorpay API call failed in dev/test mode (${err.message}). Using mock order.`);
        razorpayOrderId = `order_mock_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      } else {
        throw err;
      }
    }
  } else {
    // Mock Razorpay Order ID for local test/dev mode
    razorpayOrderId = `order_mock_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    logger.info(`[DEV/MOCK] Created mock Razorpay order: ${razorpayOrderId} for amount: ₹${plan.total_price}`);
  }

  // Create pending Payment row in Postgres
  const payment = await prisma.payment.create({
    data: {
      customer_id: customerId,
      razorpay_order_id: razorpayOrderId,
      amount: plan.total_price,
      currency: 'INR',
      status: 'created',
      plan_id: planId,
    },
  });

  return {
    order_id: razorpayOrderId,
    amount: plan.total_price,
    amount_in_paise: amountInPaise,
    currency: 'INR',
    key_id: env.RAZORPAY_KEY_ID,
    plan_name: plan.name,
    customer_name: customer.name,
    customer_phone: customer.phone,
    payment_id: payment.id,
  };
}

/**
 * Verify Razorpay Webhook HMAC-SHA256 signature against raw request body
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!signature) return false;
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('RAZORPAY_WEBHOOK_SECRET is not configured.');
    return false;
  }

  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    return expected === signature;
  } catch (error) {
    logger.error('Error verifying Razorpay webhook signature:', error);
    return false;
  }
}

/**
 * Process Razorpay Webhook Event inside atomic PostgreSQL Transaction
 */
async function processWebhookEvent(event) {
  const eventType = event.event;
  logger.info(`Processing Razorpay webhook event: ${eventType}`);

  if (eventType === 'payment.captured' || eventType === 'order.paid') {
    const paymentEntity = event.payload?.payment?.entity;
    const orderId = paymentEntity?.order_id;
    const razorpayPaymentId = paymentEntity?.id;

    if (!orderId) {
      logger.warn('Webhook event missing order_id');
      return { success: false, reason: 'missing_order_id' };
    }

    // 1. Check if payment exists and idempotency check
    const existingPayment = await prisma.payment.findUnique({
      where: { razorpay_order_id: orderId },
      include: { plan: true, customer: true },
    });

    if (!existingPayment) {
      logger.warn(`Payment record not found for razorpay_order_id: ${orderId}`);
      return { success: false, reason: 'payment_not_found' };
    }

    // Idempotency: if already success, return 200 without re-crediting
    if (existingPayment.status === 'success') {
      logger.info(`Payment ${orderId} already processed as success. Skipping duplicate credit.`);
      return { success: true, already_processed: true };
    }

    const plan = existingPayment.plan || (await prisma.plan.findUnique({ where: { id: existingPayment.plan_id } }));
    if (!plan) {
      throw new Error(`Plan not associated with payment ${existingPayment.id}`);
    }

    // 2. Atomic Transaction: update payment and reset customer balance
    const updatedCustomer = await prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { id: existingPayment.id },
        data: {
          status: 'success',
          razorpay_payment_id: razorpayPaymentId,
        },
      });

      const previousCustomer = await tx.customer.findUnique({
        where: { id: existingPayment.customer_id },
      });

      // Calculate new due date based on plan validity
      const newDueDate = new Date();
      newDueDate.setDate(newDueDate.getDate() + (plan.validity_days || 40));

      const customer = await tx.customer.update({
        where: { id: existingPayment.customer_id },
        data: {
          plan_id: plan.id,
          total_tiffins_in_plan: plan.total_tiffins_in_plan,
          per_tiffin_price: plan.per_tiffin_price,
          mrp: plan.total_price,
          tiffins_remaining: plan.total_tiffins_in_plan, // reset balance
          tiffins_sent: 0,
          status: 'active',
          due_amount: 0,
          payment_status: 'paid',
          due_date: newDueDate,
        },
      });

      await logAuditEvent({
        entityType: 'Customer',
        entityId: customer.id,
        action: 'PAYMENT_SUCCESS_BALANCE_RESET',
        previousState: {
          tiffins_remaining: previousCustomer.tiffins_remaining,
          status: previousCustomer.status,
          due_amount: previousCustomer.due_amount,
        },
        newState: {
          tiffins_remaining: customer.tiffins_remaining,
          status: customer.status,
          due_amount: customer.due_amount,
          payment_id: updatedPayment.id,
        },
        metadata: {
          razorpay_order_id: orderId,
          razorpay_payment_id: razorpayPaymentId,
          plan_name: plan.name,
        },
        db: tx,
      });

      return customer;
    });

    logger.info(`Successfully reset customer ${updatedCustomer.id} balance to ${updatedCustomer.tiffins_remaining} tiffins.`);
    return { success: true, customer: updatedCustomer };
  }

  if (eventType === 'payment.failed') {
    const paymentEntity = event.payload?.payment?.entity;
    const orderId = paymentEntity?.order_id;
    if (orderId) {
      await prisma.payment.updateMany({
        where: { razorpay_order_id: orderId },
        data: { status: 'failed' },
      });
      logger.info(`Marked payment for order ${orderId} as failed.`);
    }
    return { success: true, failed_recorded: true };
  }

  return { success: true, ignored_event: eventType };
}

module.exports = {
  createOrder,
  verifyWebhookSignature,
  processWebhookEvent,
};
