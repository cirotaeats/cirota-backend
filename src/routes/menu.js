const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');

/**
 * @route GET /api/menu/plans
 * @desc Get all available plans (Standard & Short Term)
 */
router.get('/plans', async (req, res, next) => {
  try {
    const { is_short_term, tier, is_veg, times_per_week } = req.query;

    const where = {};
    if (is_short_term !== undefined) where.is_short_term = is_short_term === 'true';
    if (tier) where.tier = tier;
    if (is_veg !== undefined) where.is_veg = is_veg === 'true';
    if (times_per_week) where.times_per_week = parseInt(times_per_week, 10);

    const plans = await prisma.plan.findMany({
      where,
      orderBy: [
        { is_short_term: 'asc' },
        { name: 'asc' },
        { times_per_week: 'desc' },
        { duration_days: 'desc' },
      ],
    });

    res.status(200).json({
      success: true,
      data: plans,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/menu/plans/:id
 * @desc Get single plan with complete 7-day menu & components
 */
router.get('/plans/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const plan = await prisma.plan.findUnique({
      where: { id },
      include: {
        day_menus: {
          include: {
            components: {
              include: { addon: true },
            },
          },
          orderBy: [
            { day_of_week: 'asc' },
            { meal_type: 'asc' },
          ],
        },
      },
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Plan not found' },
      });
    }

    res.status(200).json({
      success: true,
      data: plan,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/menu/add-ons
 * @desc Get all available add-ons for custom meal modification
 */
router.get('/add-ons', async (req, res, next) => {
  try {
    const addOns = await prisma.addOn.findMany({
      orderBy: { per_unit_price: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: addOns,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/menu/day
 * @desc Get Day Menu for a given day_of_week and plan_id
 */
router.get('/day', async (req, res, next) => {
  try {
    const { plan_id, day } = req.query;
    if (!plan_id || !day) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAMS', message: 'plan_id and day are required' },
      });
    }

    const dayEntries = await prisma.dayMenuEntry.findMany({
      where: {
        plan_id,
        day_of_week: day,
      },
      include: {
        components: {
          include: { addon: true },
        },
      },
      orderBy: { meal_type: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: dayEntries,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
