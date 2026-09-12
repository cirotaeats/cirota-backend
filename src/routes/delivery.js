const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticateDeliveryPartner } = require('../middleware/auth');
const { logAuditEvent } = require('../services/audit');
const { normalizeToStartOfDay, normalizeToEndOfDay, formatDateIST } = require('../utils/dateUtils');

const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];

// Enforce delivery-partner auth on every route below
router.use(authenticateDeliveryPartner);

/**
 * @route POST /api/delivery/attendance/checkin
 * @desc Rider checks in for one of today's 3 meal shifts (breakfast/lunch/dinner).
 *       Records their location at check-in time — this IS the attendance register.
 *       One check-in per meal per day (re-checking in the same shift just updates the location/time).
 */
router.post('/attendance/checkin', async (req, res, next) => {
  try {
    const { meal_type, lat, lng } = req.body;
    if (!VALID_MEAL_TYPES.includes(meal_type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'meal_type must be breakfast, lunch, or dinner' },
      });
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'lat and lng are required — please allow location access to check in' },
      });
    }

    const today = normalizeToStartOfDay(new Date());
    const partnerId = req.deliveryPartner.id;

    const log = await prisma.attendanceLog.upsert({
      where: { delivery_partner_id_date_meal_type: { delivery_partner_id: partnerId, date: today, meal_type } },
      update: { checked_in_at: new Date(), lat, lng },
      create: { delivery_partner_id: partnerId, date: today, meal_type, lat, lng },
    });

    // A shift check-in also refreshes live location + marks the rider on-duty for tracking
    await prisma.deliveryPartner.update({
      where: { id: partnerId },
      data: { current_lat: lat, current_lng: lng, location_updated_at: new Date(), on_duty: true },
    });

    await logAuditEvent({
      entityType: 'DeliveryPartner',
      entityId: partnerId,
      action: 'ATTENDANCE_CHECKIN',
      newState: { meal_type, lat, lng },
    });

    res.status(200).json({ success: true, data: log });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/delivery/attendance/today
 * @desc Which of today's 3 shifts this rider has already checked into (drives the UI's checkmarks)
 */
router.get('/attendance/today', async (req, res, next) => {
  try {
    const today = normalizeToStartOfDay(new Date());
    const logs = await prisma.attendanceLog.findMany({
      where: { delivery_partner_id: req.deliveryPartner.id, date: today },
    });
    const checkedIn = {};
    for (const mt of VALID_MEAL_TYPES) {
      const log = logs.find(l => l.meal_type === mt);
      checkedIn[mt] = log ? { checked_in_at: log.checked_in_at } : null;
    }
    res.status(200).json({ success: true, data: checkedIn });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/delivery/location
 * @desc Lightweight live-location ping, sent every ~15-30s by the rider's phone
 *       while they're on duty, so customers can see a moving marker + ETA.
 */
router.post('/location', async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'lat and lng are required' },
      });
    }

    await prisma.deliveryPartner.update({
      where: { id: req.deliveryPartner.id },
      data: { current_lat: lat, current_lng: lng, location_updated_at: new Date() },
    });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/delivery/duty/end
 * @desc Rider signs off for the day — stops sharing location, ends tracking for customers.
 */
router.post('/duty/end', async (req, res, next) => {
  try {
    await prisma.deliveryPartner.update({
      where: { id: req.deliveryPartner.id },
      data: { on_duty: false },
    });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/delivery/me
 * @desc Delivery partner profile + today's delivery stats
 */
router.get('/me', async (req, res, next) => {
  try {
    const partner = req.deliveryPartner;
    const today = new Date();
    const start = normalizeToStartOfDay(today);
    const end = normalizeToEndOfDay(today);

    const [total, delivered] = await Promise.all([
      prisma.dailyOrder.count({
        where: { delivery_partner_id: partner.id, date: { gte: start, lte: end } },
      }),
      prisma.dailyOrder.count({
        where: { delivery_partner_id: partner.id, date: { gte: start, lte: end }, status: 'delivered' },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        partner: {
          id: partner.id,
          name: partner.name,
          phone: partner.phone,
          assigned_area: partner.assigned_area,
        },
        today_stats: {
          date: formatDateIST(today),
          total_assigned: total,
          delivered,
          remaining: total - delivered,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/delivery/orders?date=YYYY-MM-DD&meal_type=lunch
 * @desc List this partner's assigned tiffins for a given day (default: today)
 */
router.get('/orders', async (req, res, next) => {
  try {
    const { date, meal_type } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const start = normalizeToStartOfDay(targetDate);
    const end = normalizeToEndOfDay(targetDate);

    const where = {
      delivery_partner_id: req.deliveryPartner.id,
      date: { gte: start, lte: end },
    };
    if (meal_type) where.meal_type = meal_type;

    const orders = await prisma.dailyOrder.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            area: true,
            address: true,
            plan: { select: { name: true, is_veg: true } },
          },
        },
      },
      orderBy: [{ meal_type: 'asc' }, { customer: { area: 'asc' } }, { customer: { name: 'asc' } }],
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
 * @route PATCH /api/delivery/orders/:id/delivered
 * @desc Mark (or unmark) one assigned tiffin as delivered.
 *       Decrements the customer's remaining-tiffin balance atomically, same as the admin daily-sheet flow.
 */
router.patch('/orders/:id/delivered', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { delivered = true } = req.body;

    const existingOrder = await prisma.dailyOrder.findUnique({
      where: { id },
      include: { customer: true },
    });

    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Order not found' },
      });
    }

    // Ownership check: a delivery partner may only update tiffins assigned to them
    if (existingOrder.delivery_partner_id !== req.deliveryPartner.id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'This tiffin is not assigned to you' },
      });
    }

    const newStatus = delivered ? 'delivered' : 'confirmed';

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const updateData = { status: newStatus };

      if (delivered && existingOrder.status !== 'delivered') {
        updateData.delivered_at = new Date();

        const currentRemaining = existingOrder.customer.tiffins_remaining;
        const newRemaining = Math.max(0, currentRemaining - 1);
        const newSent = existingOrder.customer.tiffins_sent + 1;
        const newCustomerStatus = newRemaining === 0 ? 'stopped_no_balance' : existingOrder.customer.status;

        await tx.customer.update({
          where: { id: existingOrder.customer_id },
          data: {
            tiffins_remaining: newRemaining,
            tiffins_sent: newSent,
            status: newCustomerStatus,
          },
        });

        await logAuditEvent({
          entityType: 'Customer',
          entityId: existingOrder.customer_id,
          action: 'DELIVERY_CONFIRMED_DECREMENT',
          previousState: { tiffins_remaining: currentRemaining, status: existingOrder.customer.status },
          newState: { tiffins_remaining: newRemaining, status: newCustomerStatus, order_id: id },
          metadata: { marked_by_delivery_partner_id: req.deliveryPartner.id },
          db: tx,
        });
      } else if (!delivered) {
        updateData.delivered_at = null;
      }

      return tx.dailyOrder.update({
        where: { id },
        data: updateData,
        include: { customer: { select: { id: true, name: true, area: true } } },
      });
    });

    res.status(200).json({
      success: true,
      message: delivered ? 'Marked as delivered' : 'Delivery mark reverted',
      data: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/delivery/summary?date=YYYY-MM-DD
 * @desc Packet-count summary (by meal type & area) for this partner's own route only
 */
router.get('/summary', async (req, res, next) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const start = normalizeToStartOfDay(targetDate);
    const end = normalizeToEndOfDay(targetDate);

    const orders = await prisma.dailyOrder.findMany({
      where: {
        delivery_partner_id: req.deliveryPartner.id,
        date: { gte: start, lte: end },
      },
      select: { meal_type: true, status: true, customer: { select: { area: true } } },
    });

    const byMeal = {};
    for (const o of orders) {
      byMeal[o.meal_type] = byMeal[o.meal_type] || { total: 0, delivered: 0 };
      byMeal[o.meal_type].total += 1;
      if (o.status === 'delivered') byMeal[o.meal_type].delivered += 1;
    }

    res.status(200).json({
      success: true,
      data: {
        date: formatDateIST(targetDate),
        by_meal_type: byMeal,
        total: orders.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
