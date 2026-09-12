const express = require('express');
const router = express.Router();
const { z } = require('zod');
const prisma = require('../config/prisma');
const { authenticateCustomer } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { logAuditEvent } = require('../services/audit');
const { createOrRenewSubscription } = require('../services/subscription');
const { normalizeToStartOfDay, getDayOfWeekShort } = require('../utils/dateUtils');
const { haversineDistanceKm, estimateEtaMinutes } = require('../utils/geo');

// Input validation schemas
const subscribeSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name is required'),
    phone: z.string().min(10, 'Valid 10-digit phone required'),
    area: z.string().min(2, 'Area is required'),
    address: z.string().min(5, 'Delivery address is required'),
    lat: z.number().optional(),
    lng: z.number().optional(),
    plan_id: z.string().min(1, 'Plan ID is required'),
    times_per_day: z.number().int().min(1).max(3).default(1),
    start_date: z.string().optional(),
  }),
});

const planChangeSchema = z.object({
  body: z.object({
    new_plan_id: z.string().min(1, 'New Plan ID is required'),
  }),
});

const pushSubscribeSchema = z.object({
  body: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
});

/**
 * @route GET /api/customer/me
 * @desc Get customer profile, active plan, tiffins remaining, and dues
 */
router.get('/me', authenticateCustomer, async (req, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.customer.id },
      include: {
        plan: true,
        delivery_partner: {
          select: { id: true, name: true, phone: true, assigned_area: true },
        },
        pause_requests: {
          orderBy: { created_at: 'desc' },
          take: 5,
        },
      },
    });

    res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/customer/subscribe
 * @desc New customer subscription setup
 */
router.post('/subscribe', validate(subscribeSchema), async (req, res, next) => {
  try {
    const { name, phone, area, address, lat, lng, plan_id, times_per_day, start_date } = req.body;
    const customer = await createOrRenewSubscription({
      name, phone, area, address, lat, lng, plan_id, times_per_day, start_date,
      source: 'self_serve',
    });

    res.status(201).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    }
    next(error);
  }
});

/**
 * @route POST /api/customer/pause/next-meal
 * @desc Pause only the next upcoming meal
 */
router.post('/pause/next-meal', authenticateCustomer, async (req, res, next) => {
  try {
    const customerId = req.customer.id;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Create pause request
      const pauseReq = await tx.pauseRequest.create({
        data: {
          customer_id: customerId,
          type: 'next_meal',
          start_date: now,
        },
      });

      // Find next pending/confirmed order
      const nextOrder = await tx.dailyOrder.findFirst({
        where: {
          customer_id: customerId,
          date: { gte: normalizeToStartOfDay(now) },
          status: { in: ['pending', 'confirmed'] },
        },
        orderBy: [{ date: 'asc' }, { meal_type: 'asc' }],
      });

      if (nextOrder) {
        await tx.dailyOrder.update({
          where: { id: nextOrder.id },
          data: { status: 'paused' },
        });
      }

      await logAuditEvent({
        entityType: 'Customer',
        entityId: customerId,
        action: 'PAUSE_NEXT_MEAL',
        metadata: { paused_order_id: nextOrder ? nextOrder.id : null },
        db: tx,
      });

      return { pauseRequest: pauseReq, pausedOrder: nextOrder };
    });

    res.status(200).json({
      success: true,
      message: 'Next meal paused successfully. Tiffin balance remains untouched.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/customer/pause/indefinite
 * @desc Pause subscription indefinitely
 */
router.post('/pause/indefinite', authenticateCustomer, async (req, res, next) => {
  try {
    const customerId = req.customer.id;

    const result = await prisma.$transaction(async (tx) => {
      const pauseReq = await tx.pauseRequest.create({
        data: {
          customer_id: customerId,
          type: 'indefinite',
          start_date: new Date(),
        },
      });

      const customer = await tx.customer.update({
        where: { id: customerId },
        data: { status: 'paused_indefinite' },
      });

      // Mark all future orders as paused
      await tx.dailyOrder.updateMany({
        where: {
          customer_id: customerId,
          date: { gte: normalizeToStartOfDay(new Date()) },
          status: { in: ['pending', 'confirmed'] },
        },
        data: { status: 'paused' },
      });

      await logAuditEvent({
        entityType: 'Customer',
        entityId: customerId,
        action: 'PAUSE_INDEFINITE',
        db: tx,
      });

      return customer;
    });

    res.status(200).json({
      success: true,
      message: 'Subscription paused indefinitely. No meals will be dispatched until you resume.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/customer/resume
 * @desc Resume paused subscription
 */
router.post('/resume', authenticateCustomer, async (req, res, next) => {
  try {
    const customerId = req.customer.id;

    const customer = await prisma.$transaction(async (tx) => {
      // Mark open indefinite pause requests as resumed
      await tx.pauseRequest.updateMany({
        where: {
          customer_id: customerId,
          resumed_at: null,
        },
        data: { resumed_at: new Date() },
      });

      const updated = await tx.customer.update({
        where: { id: customerId },
        data: { status: 'active' },
      });

      // Restore upcoming orders to confirmed
      await tx.dailyOrder.updateMany({
        where: {
          customer_id: customerId,
          date: { gte: normalizeToStartOfDay(new Date()) },
          status: 'paused',
        },
        data: { status: 'confirmed' },
      });

      await logAuditEvent({
        entityType: 'Customer',
        entityId: customerId,
        action: 'RESUME_SUBSCRIPTION',
        db: tx,
      });

      return updated;
    });

    res.status(200).json({
      success: true,
      message: 'Subscription resumed successfully.',
      data: customer,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/customer/plan/change
 * @desc Change customer subscription plan with proration
 */
router.post('/plan/change', authenticateCustomer, validate(planChangeSchema), async (req, res, next) => {
  try {
    const customer = req.customer;
    const { new_plan_id } = req.body;

    if (customer.due_amount > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ACTIVE_DUES_EXIST',
          message: `Please clear outstanding due amount of ₹${customer.due_amount} before changing plans.`,
        },
      });
    }

    const newPlan = await prisma.plan.findUnique({
      where: { id: new_plan_id },
    });

    if (!newPlan) {
      return res.status(404).json({
        success: false,
        error: { code: 'PLAN_NOT_FOUND', message: 'Target plan not found' },
      });
    }

    // Proration Rule:
    // Value of remaining tiffins in old plan = customer.tiffins_remaining * customer.per_tiffin_price
    // Converted to remaining tiffins in new plan = Math.floor(value / newPlan.per_tiffin_price)
    const currentValue = customer.tiffins_remaining * (customer.per_tiffin_price || newPlan.per_tiffin_price);
    const convertedTiffins = Math.floor(currentValue / newPlan.per_tiffin_price);

    const updatedCustomer = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: {
          plan_id: newPlan.id,
          mrp: newPlan.total_price,
          per_tiffin_price: newPlan.per_tiffin_price,
          total_tiffins_in_plan: newPlan.total_tiffins_in_plan,
          tiffins_remaining: convertedTiffins > 0 ? convertedTiffins : newPlan.total_tiffins_in_plan,
        },
      });

      await logAuditEvent({
        entityType: 'Customer',
        entityId: customer.id,
        action: 'PLAN_CHANGED',
        previousState: {
          plan_id: customer.plan_id,
          per_tiffin_price: customer.per_tiffin_price,
          tiffins_remaining: customer.tiffins_remaining,
        },
        newState: {
          plan_id: newPlan.id,
          per_tiffin_price: newPlan.per_tiffin_price,
          tiffins_remaining: updated.tiffins_remaining,
        },
        db: tx,
      });

      return updated;
    });

    res.status(200).json({
      success: true,
      message: `Plan changed successfully to ${newPlan.name}. Remaining tiffins adjusted to ${updatedCustomer.tiffins_remaining}.`,
      data: updatedCustomer,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/customer/plan/cancel
 * @desc Cancel subscription
 */
router.post('/plan/cancel', authenticateCustomer, async (req, res, next) => {
  try {
    const customerId = req.customer.id;

    const customer = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id: customerId },
        data: { status: 'cancelled' },
      });

      // Remove future pending/confirmed orders
      await tx.dailyOrder.deleteMany({
        where: {
          customer_id: customerId,
          date: { gte: normalizeToStartOfDay(new Date()) },
          status: { in: ['pending', 'confirmed', 'paused'] },
        },
      });

      await logAuditEvent({
        entityType: 'Customer',
        entityId: customerId,
        action: 'PLAN_CANCELLED',
        db: tx,
      });

      return updated;
    });

    res.status(200).json({
      success: true,
      message: 'Subscription cancelled. Historical records preserved.',
      data: customer,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/customer/push/subscribe
 * @desc Register Web Push subscription for customer
 */
router.post('/push/subscribe', authenticateCustomer, validate(pushSubscribeSchema), async (req, res, next) => {
  try {
    const customerId = req.customer.id;
    const { endpoint, keys } = req.body;

    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        customer_id: customerId,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      create: {
        customer_id: customerId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Web push subscription registered successfully.',
      data: sub,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/customer/orders/upcoming
 * @desc Get upcoming daily orders for the logged-in customer
 */
router.get('/orders/upcoming', authenticateCustomer, async (req, res, next) => {
  try {
    const customerId = req.customer.id;
    const today = normalizeToStartOfDay(new Date());

    const orders = await prisma.dailyOrder.findMany({
      where: {
        customer_id: customerId,
        date: { gte: today },
      },
      include: {
        delivery_partner: {
          select: { name: true, phone: true },
        },
      },
      orderBy: [{ date: 'asc' }, { meal_type: 'asc' }],
      take: 14,
    });

    res.status(200).json({
      success: true,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/customer/orders/history
 * @desc Get past delivered orders for the customer
 */
router.get('/orders/history', authenticateCustomer, async (req, res, next) => {
  try {
    const customerId = req.customer.id;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);

    const orders = await prisma.dailyOrder.findMany({
      where: {
        customer_id: customerId,
        status: 'delivered',
      },
      orderBy: { date: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await prisma.dailyOrder.count({
      where: {
        customer_id: customerId,
        status: 'delivered',
      },
    });

    res.status(200).json({
      success: true,
      data: {
        orders,
        pagination: {
          total,
          page,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route PATCH /api/customer/orders/:id/modify
 * @desc Self-service edit of roti/paratha count on one of the customer's own upcoming tiffins
 *       (mirrors the admin daily-sheet roti edit, but scoped + ownership-checked for customers)
 */
router.patch('/orders/:id/modify', authenticateCustomer, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { roti_paratha_count } = req.body;
    const customerId = req.customer.id;

    if (roti_paratha_count === undefined || roti_paratha_count < 0 || roti_paratha_count > 20) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'roti_paratha_count must be between 0 and 20' },
      });
    }

    const order = await prisma.dailyOrder.findUnique({ where: { id } });
    if (!order || order.customer_id !== customerId) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Order not found' },
      });
    }

    if (order.status === 'delivered') {
      return res.status(409).json({
        success: false,
        error: { code: 'ALREADY_DELIVERED', message: 'This tiffin has already been delivered and cannot be modified' },
      });
    }

    const updatedOrder = await prisma.dailyOrder.update({
      where: { id },
      data: { roti_paratha_count },
    });

    await logAuditEvent({
      entityType: 'DailyOrder',
      entityId: id,
      action: 'CUSTOMER_MODIFIED_ORDER',
      previousState: { roti_paratha_count: order.roti_paratha_count },
      newState: { roti_paratha_count },
    });

    res.status(200).json({
      success: true,
      message: 'Order updated successfully',
      data: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/customer/orders/:id/tracking
 * @desc Live location + ETA of the rider assigned to one of this customer's upcoming tiffins.
 *       Returns tracking:false (not an error) whenever there's nothing to show yet —
 *       e.g. rider hasn't started their shift, or the tiffin has already been delivered.
 */
router.get('/orders/:id/tracking', authenticateCustomer, async (req, res, next) => {
  try {
    const { id } = req.params;
    const customer = req.customer;

    const order = await prisma.dailyOrder.findUnique({
      where: { id },
      include: { delivery_partner: true },
    });

    if (!order || order.customer_id !== customer.id) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Order not found' },
      });
    }

    if (order.status === 'delivered') {
      return res.status(200).json({ success: true, data: { tracking: false, reason: 'already_delivered' } });
    }

    const partner = order.delivery_partner;
    if (!partner || !partner.current_lat || !partner.current_lng || !partner.on_duty) {
      return res.status(200).json({ success: true, data: { tracking: false, reason: 'partner_not_live' } });
    }

    // Stale location guard — if the rider's phone hasn't pinged in >20 min, don't show a misleading ETA
    const staleMs = 20 * 60 * 1000;
    if (partner.location_updated_at && Date.now() - new Date(partner.location_updated_at).getTime() > staleMs) {
      return res.status(200).json({ success: true, data: { tracking: false, reason: 'location_stale' } });
    }

    let etaMinutes = null;
    let distanceKm = null;
    if (customer.lat && customer.lng) {
      distanceKm = haversineDistanceKm(partner.current_lat, partner.current_lng, customer.lat, customer.lng);
      etaMinutes = estimateEtaMinutes(distanceKm);
    }

    res.status(200).json({
      success: true,
      data: {
        tracking: true,
        partner: { name: partner.name, phone: partner.phone },
        rider_location: { lat: partner.current_lat, lng: partner.current_lng },
        customer_location: customer.lat && customer.lng ? { lat: customer.lat, lng: customer.lng } : null,
        distance_km: distanceKm !== null ? Math.round(distanceKm * 10) / 10 : null,
        eta_minutes: etaMinutes,
        updated_at: partner.location_updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
