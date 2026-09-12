const express = require('express');
const router = express.Router();
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { authenticateAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { logAuditEvent } = require('../services/audit');
const { syncMasterSheet, syncDailySheet } = require('../services/sheetsSync');
const { createOrRenewSubscription } = require('../services/subscription');
const { normalizeToStartOfDay, normalizeToEndOfDay, formatDateIST } = require('../utils/dateUtils');

// Enforce admin auth on all admin routes
router.use(authenticateAdmin());

/**
 * @route GET /api/admin/customers
 * @desc Get customers with search, area, status, and dues filtering
 */
router.get('/customers', async (req, res, next) => {
  try {
    const { area, status, has_dues, search, page = '1', limit = '50' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    const where = {};
    if (area) where.area = { contains: area, mode: 'insensitive' };
    if (status) where.status = status;
    if (has_dues === 'true') where.due_amount = { gt: 0 };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { address: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          plan: true,
          delivery_partner: { select: { id: true, name: true, phone: true } },
        },
        orderBy: [{ created_at: 'desc' }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.customer.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        customers,
        pagination: {
          total,
          page: pageNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/customers/:id
 * @desc Get single customer detail
 */
router.get('/customers/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        plan: true,
        delivery_partner: true,
        payments: { orderBy: { created_at: 'desc' } },
        pause_requests: { orderBy: { created_at: 'desc' } },
        daily_orders: {
          orderBy: { date: 'desc' },
          take: 30,
        },
      },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Customer not found' },
      });
    }

    res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route PATCH /api/admin/customers/:id
 * @desc Manual admin overrides for customer balances and details
 */
router.patch('/customers/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const previous = await prisma.customer.findUnique({ where: { id } });

    if (!previous) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Customer not found' },
      });
    }

    const {
      name,
      area,
      address,
      status,
      tiffins_remaining,
      tiffins_sent,
      due_amount,
      advance_amount,
      additional_charges,
      delivery_partner_id,
      plan_id,
    } = req.body;

    const dataToUpdate = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (area !== undefined) dataToUpdate.area = area;
    if (address !== undefined) dataToUpdate.address = address;
    if (status !== undefined) dataToUpdate.status = status;
    if (tiffins_remaining !== undefined) dataToUpdate.tiffins_remaining = parseInt(tiffins_remaining, 10);
    if (tiffins_sent !== undefined) dataToUpdate.tiffins_sent = parseInt(tiffins_sent, 10);
    if (due_amount !== undefined) dataToUpdate.due_amount = parseFloat(due_amount);
    if (advance_amount !== undefined) dataToUpdate.advance_amount = parseFloat(advance_amount);
    if (additional_charges !== undefined) dataToUpdate.additional_charges = parseFloat(additional_charges);
    if (delivery_partner_id !== undefined) dataToUpdate.delivery_partner_id = delivery_partner_id;
    if (plan_id !== undefined) dataToUpdate.plan_id = plan_id;

    const updated = await prisma.$transaction(async (tx) => {
      const cust = await tx.customer.update({
        where: { id },
        data: dataToUpdate,
        include: { plan: true, delivery_partner: true },
      });

      await logAuditEvent({
        entityType: 'Customer',
        entityId: id,
        action: 'ADMIN_OVERRIDE',
        previousState: previous,
        newState: cust,
        metadata: { adminId: req.admin.id, adminEmail: req.admin.email },
        db: tx,
      });

      return cust;
    });

    res.status(200).json({
      success: true,
      message: 'Customer updated successfully',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/daily-orders
 * @desc Get daily sheet order entries with filters (date, meal_type, area, partner, status)
 */
router.get('/daily-orders', async (req, res, next) => {
  try {
    const { date, meal_type, area, delivery_partner_id, status } = req.query;
    const targetDate = date ? new Date(date) : new Date();

    const start = normalizeToStartOfDay(targetDate);
    const end = normalizeToEndOfDay(targetDate);

    const where = {
      date: { gte: start, lte: end },
    };

    if (meal_type) where.meal_type = meal_type;
    if (status) where.status = status;
    if (delivery_partner_id) where.delivery_partner_id = delivery_partner_id;
    if (area) {
      where.customer = { area: { contains: area, mode: 'insensitive' } };
    }

    const orders = await prisma.dailyOrder.findMany({
      where,
      include: {
        customer: {
          include: { plan: true },
        },
        delivery_partner: true,
      },
      orderBy: [
        { customer: { area: 'asc' } },
        { meal_type: 'asc' },
        { customer: { name: 'asc' } },
      ],
    });

    res.status(200).json({
      success: true,
      data: {
        date: formatDateIST(targetDate),
        count: orders.length,
        orders,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route PATCH /api/admin/daily-orders/:id
 * @desc Update DailyOrder (mark delivered, reassign partner, edit roti count)
 */
router.patch('/daily-orders/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, delivery_partner_id, roti_paratha_count } = req.body;

    const existingOrder = await prisma.dailyOrder.findUnique({
      where: { id },
      include: { customer: true },
    });

    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Daily order not found' },
      });
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const updateData = {};
      if (delivery_partner_id !== undefined) updateData.delivery_partner_id = delivery_partner_id;
      if (roti_paratha_count !== undefined) updateData.roti_paratha_count = roti_paratha_count;

      // Handle delivery status change
      if (status !== undefined && status !== existingOrder.status) {
        updateData.status = status;

        if (status === 'delivered') {
          updateData.delivered_at = new Date();

          // Decrement tiffins_remaining and increment tiffins_sent atomically
          const currentRemaining = existingOrder.customer.tiffins_remaining;
          const newRemaining = Math.max(0, currentRemaining - 1);
          const newSent = existingOrder.customer.tiffins_sent + 1;
          const newStatus = newRemaining === 0 ? 'stopped_no_balance' : existingOrder.customer.status;

          await tx.customer.update({
            where: { id: existingOrder.customer_id },
            data: {
              tiffins_remaining: newRemaining,
              tiffins_sent: newSent,
              status: newStatus,
            },
          });

          await logAuditEvent({
            entityType: 'Customer',
            entityId: existingOrder.customer_id,
            action: 'DELIVERY_CONFIRMED_DECREMENT',
            previousState: {
              tiffins_remaining: currentRemaining,
              status: existingOrder.customer.status,
            },
            newState: {
              tiffins_remaining: newRemaining,
              status: newStatus,
              order_id: id,
            },
            db: tx,
          });
        }
      }

      const ord = await tx.dailyOrder.update({
        where: { id },
        data: updateData,
        include: {
          customer: true,
          delivery_partner: true,
        },
      });

      return ord;
    });

    res.status(200).json({
      success: true,
      message: 'Daily order updated successfully',
      data: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/kitchen-summary
 * @desc Get kitchen preparation packet counts grouped by area and addons
 */
router.get('/kitchen-summary', async (req, res, next) => {
  try {
    const { date, meal_type } = req.query;
    const targetDate = date ? new Date(date) : new Date();

    const start = normalizeToStartOfDay(targetDate);
    const end = normalizeToEndOfDay(targetDate);

    const where = {
      date: { gte: start, lte: end },
      status: { in: ['pending', 'confirmed'] }, // active orders to prepare
    };
    if (meal_type) where.meal_type = meal_type;

    const orders = await prisma.dailyOrder.findMany({
      where,
      include: {
        customer: {
          include: {
            plan: {
              include: {
                day_menus: {
                  where: {
                    day_of_week: require('../utils/dateUtils').getDayOfWeekShort(targetDate),
                    ...(meal_type && { meal_type }),
                  },
                  include: { components: true },
                },
              },
            },
          },
        },
      },
    });

    // Grouping calculations
    const breakdownByArea = {};
    const breakdownByPlan = {};
    let totalRotiCount = 0;

    for (const ord of orders) {
      const area = ord.customer.area || 'Unknown';
      breakdownByArea[area] = (breakdownByArea[area] || 0) + 1;

      const planName = ord.customer.plan?.name || 'Custom';
      breakdownByPlan[planName] = (breakdownByPlan[planName] || 0) + 1;

      totalRotiCount += ord.roti_paratha_count || 0;
    }

    res.status(200).json({
      success: true,
      data: {
        date: formatDateIST(targetDate),
        meal_type: meal_type || 'all',
        total_packets_to_prepare: orders.length,
        total_custom_roti_paratha: totalRotiCount,
        breakdown_by_area: breakdownByArea,
        breakdown_by_plan: breakdownByPlan,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/dues
 * @desc List customers with outstanding due amounts
 */
router.get('/dues', async (req, res, next) => {
  try {
    const dues = await prisma.customer.findMany({
      where: { due_amount: { gt: 0 } },
      include: { plan: true },
      orderBy: { due_amount: 'desc' },
    });

    const totalOutstanding = dues.reduce((acc, c) => acc + c.due_amount, 0);

    res.status(200).json({
      success: true,
      data: {
        total_outstanding_amount: totalOutstanding,
        customer_count: dues.length,
        customers: dues,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/admin/sync-sheets
 * @desc Manually trigger Google Sheets Mirror Sync (Master and/or Daily)
 */
router.post('/sync-sheets', async (req, res, next) => {
  try {
    const { target, date } = req.body; // target: 'master' | 'daily' | 'all'
    const results = {};

    if (!target || target === 'master' || target === 'all') {
      results.master = await syncMasterSheet();
    }
    if (!target || target === 'daily' || target === 'all') {
      results.daily = await syncDailySheet(date ? new Date(date) : new Date());
    }

    res.status(200).json({
      success: true,
      message: 'Google Sheets sync process executed.',
      data: results,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/partners
 * @desc List all delivery partners
 */
router.get('/partners', async (req, res, next) => {
  try {
    const partners = await prisma.deliveryPartner.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        assigned_area: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        _count: {
          select: { customers: true, daily_orders: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: partners,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/admin/partners
 * @desc Create delivery partner. Optional `pin` (defaults to DELIVERY_DEFAULT_PIN) sets their app login PIN.
 */
router.post('/partners', async (req, res, next) => {
  try {
    const { name, phone, assigned_area, pin } = req.body;
    const pinHash = await bcrypt.hash(pin || env.DELIVERY_DEFAULT_PIN, 10);

    const partner = await prisma.deliveryPartner.create({
      data: { name, phone, assigned_area, pin_hash: pinHash },
    });

    const { pin_hash, ...safePartner } = partner;
    res.status(201).json({
      success: true,
      data: safePartner,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route PATCH /api/admin/partners/:id
 * @desc Update a delivery partner's name/area/active status
 */
router.patch('/partners/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, assigned_area, is_active } = req.body;
    const dataToUpdate = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (assigned_area !== undefined) dataToUpdate.assigned_area = assigned_area;
    if (is_active !== undefined) dataToUpdate.is_active = is_active;

    const partner = await prisma.deliveryPartner.update({ where: { id }, data: dataToUpdate });
    const { pin_hash, ...safePartner } = partner;

    res.status(200).json({ success: true, data: safePartner });
  } catch (error) {
    next(error);
  }
});

/**
 * @route PATCH /api/admin/partners/:id/pin
 * @desc Reset a delivery partner's login PIN
 */
router.patch('/partners/:id/pin', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pin } = req.body;
    if (!pin || pin.length < 4) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'PIN must be at least 4 digits' },
      });
    }

    const pinHash = await bcrypt.hash(pin, 10);
    await prisma.deliveryPartner.update({ where: { id }, data: { pin_hash: pinHash } });

    res.status(200).json({ success: true, message: 'PIN reset successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/stats
 * @desc Dashboard overview metrics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const today = normalizeToStartOfDay(new Date());
    const tomorrow = normalizeToEndOfDay(new Date());

    const [
      activeCount,
      pausedCount,
      stoppedCount,
      todayDelivered,
      todayPending,
      totalDues,
    ] = await Promise.all([
      prisma.customer.count({ where: { status: 'active' } }),
      prisma.customer.count({ where: { status: { in: ['paused_indefinite', 'paused_next_meal'] } } }),
      prisma.customer.count({ where: { status: 'stopped_no_balance' } }),
      prisma.dailyOrder.count({ where: { date: { gte: today, lte: tomorrow }, status: 'delivered' } }),
      prisma.dailyOrder.count({ where: { date: { gte: today, lte: tomorrow }, status: { in: ['pending', 'confirmed'] } } }),
      prisma.customer.aggregate({ _sum: { due_amount: true } }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        active_subscribers: activeCount,
        paused_subscribers: pausedCount,
        stopped_subscribers: stoppedCount,
        today_delivered_meals: todayDelivered,
        today_pending_meals: todayPending,
        total_dues_outstanding: totalDues._sum.due_amount || 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/attendance?date=YYYY-MM-DD
 * @desc Attendance register — every rider's check-in status for the 3 shifts on a given day (default: today),
 *       with the location they checked in from.
 */
router.get('/attendance', async (req, res, next) => {
  try {
    const { date } = req.query;
    const targetDate = normalizeToStartOfDay(date ? new Date(date) : new Date());

    const partners = await prisma.deliveryPartner.findMany({
      where: { is_active: true },
      select: {
        id: true, name: true, phone: true, assigned_area: true,
        attendance_logs: { where: { date: targetDate } },
      },
      orderBy: { name: 'asc' },
    });

    const register = partners.map(p => {
      const byMeal = {};
      for (const mt of ['breakfast', 'lunch', 'dinner']) {
        const log = p.attendance_logs.find(l => l.meal_type === mt);
        byMeal[mt] = log ? { checked_in_at: log.checked_in_at, lat: log.lat, lng: log.lng } : null;
      }
      return { id: p.id, name: p.name, phone: p.phone, assigned_area: p.assigned_area, shifts: byMeal };
    });

    res.status(200).json({ success: true, data: { date: date || formatDateIST(new Date()), register } });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/partners/live-locations
 * @desc Current on-duty riders' live positions, for an ops overview map.
 */
router.get('/partners/live-locations', async (req, res, next) => {
  try {
    const partners = await prisma.deliveryPartner.findMany({
      where: { is_active: true, on_duty: true, current_lat: { not: null } },
      select: { id: true, name: true, assigned_area: true, current_lat: true, current_lng: true, location_updated_at: true },
    });
    res.status(200).json({ success: true, data: partners });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/admin/orders/manual
 * @desc CRM — log an order taken over the phone (not through the app). Creates the customer
 *       if new, or renews/switches an existing customer's plan, and deducts tiffins exactly
 *       like a self-serve subscription would (shares the same underlying service).
 */
router.post('/orders/manual', async (req, res, next) => {
  try {
    const { name, phone, area, address, plan_id, times_per_day, start_date } = req.body;

    if (!name || !phone || !area || !address || !plan_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'name, phone, area, address, and plan_id are required' },
      });
    }

    const customer = await createOrRenewSubscription({
      name, phone, area, address, plan_id,
      times_per_day: times_per_day || 1,
      start_date,
      source: 'admin_phone_order',
      createdByAdminId: req.admin?.id || null,
    });

    res.status(201).json({
      success: true,
      message: `Phone order logged for ${name}. Tiffins deducted from their plan balance.`,
      data: customer,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    }
    next(error);
  }
});

module.exports = router;
