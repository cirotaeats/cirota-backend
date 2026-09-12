const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding for Cirota...');

  // 1. Seed Add-Ons
  console.log('Seeding Add-Ons...');
  const addOnsData = [
    { name: '+1 Roti', per_unit_price: 7, monthly_price: 210 },
    { name: '+1 Paratha', per_unit_price: 10, monthly_price: 300 },
    { name: '+Half Rice', per_unit_price: 10, monthly_price: 300 },
    { name: '+extra sabzi', per_unit_price: 20, monthly_price: null },
    { name: '+1pc chicken/egg', per_unit_price: 25, monthly_price: null },
    { name: '+green salad', per_unit_price: 10, monthly_price: 300 },
  ];

  const addOnMap = {};
  for (const addon of addOnsData) {
    const record = await prisma.addOn.upsert({
      where: { name: addon.name },
      update: addon,
      create: addon,
    });
    addOnMap[addon.name] = record.id;
  }

  // 2. Base Menu Definitions
  const vegLiteMenu = {
    Mon: {
      breakfast: 'Paratha (2) + aalu bhujia',
      lunch: 'Aalo Dum + Rice + Fryums',
      dinner: 'Seasonal veg + Roti (4)',
    },
    Tue: {
      breakfast: 'Aaloo Paratha (2)',
      lunch: 'Seasonal Veg + Dal + Rice + Fryums',
      dinner: 'Dal Tadka + Roti (4)',
    },
    Wed: {
      breakfast: 'Chhole Bhature (2)',
      lunch: 'Rajma + Rice + Fryums',
      dinner: 'Seasonal veg + Roti (4)',
    },
    Thu: {
      breakfast: 'Paratha (2) + sabzi',
      lunch: 'Seasonal Veg + Dal + Rice + Fryums',
      dinner: 'Matar ke chhole + Roti (4)',
    },
    Fri: {
      breakfast: 'Sattu Paratha (2)',
      lunch: 'Aalo Soyabean + Dal + Rice + Fryums',
      dinner: 'Matar Paneer + Roti (4)',
    },
    Sat: {
      breakfast: 'Idli (4) + sambhar',
      lunch: 'Khichdi + Chokha + Fryums',
      dinner: 'Veg Chowmin',
    },
    Sun: {
      breakfast: 'Aalo chana + poori (4) + dessert',
      lunch: 'Veg Special + Rice + Fryums',
      dinner: '~off~',
    },
  };

  const nonVegLiteMenu = {
    Mon: {
      breakfast: 'Paratha (2) + aalu bhujia',
      lunch: 'Aalo Dum + Rice + Fryums',
      dinner: 'Seasonal veg + Roti (4)',
    },
    Tue: {
      breakfast: 'Aaloo Paratha (2)',
      lunch: 'Seasonal Veg + Dal + Rice + Fryums',
      dinner: 'Dal Tadka + Roti (4)',
    },
    Wed: {
      breakfast: 'Chhole Bhature (2)',
      lunch: 'Egg Curry (2) + Rice + Fryums',
      dinner: 'Seasonal veg + Roti (4)',
    },
    Thu: {
      breakfast: 'Paratha (2) + sabzi',
      lunch: 'Seasonal Veg + Dal + Rice + Fryums',
      dinner: 'Matar ke chhole + Roti (4)',
    },
    Fri: {
      breakfast: 'Sattu Paratha (2)',
      lunch: 'Aalo Soyabean + Dal + Rice + Fryums ⭐',
      dinner: 'Chicken Masala (2) + Roti (4) ⭐',
    },
    Sat: {
      breakfast: 'Idli (4) + sambhar',
      lunch: 'Khichdi + Chokha + Fryums',
      dinner: 'Egg Chowmin ⭐',
    },
    Sun: {
      breakfast: 'Aalo chana + poori (4) + dessert',
      lunch: 'Chicken Curry (2) + Rice + Fryums ⭐',
      dinner: '~off~',
    },
  };

  const vegPrimeMenu = {
    Mon: {
      breakfast: 'Paratha (3) + aalu bhujia + fruit',
      lunch: 'Aalo Dum + Veg Pulao + Salad + Fryums',
      dinner: 'Paneer Butter Masala + Roti(5)/Paratha(4) + salad',
    },
    Tue: {
      breakfast: 'Aaloo Paratha (3) + curd',
      lunch: 'Seasonal Veg + Dal + Rice + Salad + Fryums',
      dinner: 'Dal Tadka + Roti(5)/Paratha(4) + salad',
    },
    Wed: {
      breakfast: 'Chhole Bhature (2) + salad + achar',
      lunch: 'Rajma + Jeera Rice + Salad + Fryums',
      dinner: 'Soya Chaap/mix veg + Roti(5)/Paratha(4) + salad',
    },
    Thu: {
      breakfast: 'Paratha (3) + sabzi + fruit',
      lunch: 'Veg Kofta + Dal + Rice + Salad + Fryums',
      dinner: 'Matar ke chhole + Roti(5)/Paratha(4) + salad',
    },
    Fri: {
      breakfast: 'Sattu Paratha (3) + pudina chutney',
      lunch: 'Aalo Soyabean + Dal + Rice + Salad + Fryums',
      dinner: 'Matar Paneer + Roti(5)/Paratha(4) + salad',
    },
    Sat: {
      breakfast: 'Idli (6) + sambhar',
      lunch: 'Ghee Khichdi + Chokha + Salad + Papad',
      dinner: 'Veg Chowmin/Roti(5)/Paratha + Veg Chilli',
    },
    Sun: {
      breakfast: 'Aalo chana + poori (6) + dessert',
      lunch: 'Veg Special + Rice + salad + Fryums',
      dinner: '~off~',
    },
  };

  const nonVegPrimeMenu = {
    Mon: {
      breakfast: 'Paratha (3) + aalu bhujia + fruit',
      lunch: 'Aalo Dum + Veg Pulao + Salad + Fryums',
      dinner: 'Butter Chicken (2) + Roti(5)/Paratha(4) + salad',
    },
    Tue: {
      breakfast: 'Aaloo Paratha (3) + curd',
      lunch: 'Seasonal Veg + Dal + Rice + Salad + Fryums',
      dinner: 'Dal Tadka + Roti(5)/Paratha(4) + salad',
    },
    Wed: {
      breakfast: 'Chhole Bhature (2) + salad + achar',
      lunch: 'Egg Curry (3) + Jeera Rice + Salad + Fryums',
      dinner: 'Soya Chaap/mix veg + Roti(5)/Paratha(4) + salad',
    },
    Thu: {
      breakfast: 'Paratha (3) + sabzi + fruit',
      lunch: 'Veg Kofta + Dal + Rice + Salad + Fryums',
      dinner: 'Matar ke chhole + Roti(5)/Paratha(4) + salad',
    },
    Fri: {
      breakfast: 'Sattu Paratha (3) + pudina chutney',
      lunch: 'Aalo Soyabean + Dal + Rice + Salad + Fryums ⭐',
      dinner: 'Chicken Masala (3) + Roti(5)/Paratha(4) + salad ⭐',
    },
    Sat: {
      breakfast: 'Idli (6) + sambhar',
      lunch: 'Ghee Khichdi + Chokha + Salad + Papad',
      dinner: 'Egg Chowmin/Roti(5)/Paratha(4) + Chicken Chilli(4) ⭐',
    },
    Sun: {
      breakfast: 'Aalo chana + poori (6) + dessert',
      lunch: 'Chicken Curry (3) + Rice + salad + Fryums ⭐',
      dinner: '~off~',
    },
  };

  const menuByPlanName = {
    'Veg Lite': vegLiteMenu,
    'Non-Veg Lite': nonVegLiteMenu,
    'Veg Prime': vegPrimeMenu,
    'Non-Veg Prime': nonVegPrimeMenu,
  };

  // Helper to parse components from description
  function parseComponents(description) {
    if (description === '~off~') return [];
    const cleanDesc = description.replace('⭐', '').trim();
    const parts = cleanDesc.split('+').map((p) => p.trim());
    return parts.map((part) => {
      let linkedAddonId = null;
      const lower = part.toLowerCase();
      if (lower.includes('roti')) linkedAddonId = addOnMap['+1 Roti'];
      else if (lower.includes('paratha')) linkedAddonId = addOnMap['+1 Paratha'];
      else if (lower.includes('rice') || lower.includes('pulao') || lower.includes('biryani')) linkedAddonId = addOnMap['+Half Rice'];
      else if (lower.includes('sabzi') || lower.includes('veg') || lower.includes('chhole') || lower.includes('paneer') || lower.includes('dum')) linkedAddonId = addOnMap['+extra sabzi'];
      else if (lower.includes('chicken') || lower.includes('egg')) linkedAddonId = addOnMap['+1pc chicken/egg'];
      else if (lower.includes('salad')) linkedAddonId = addOnMap['+green salad'];

      return {
        name: part,
        addon_id: linkedAddonId,
      };
    });
  }

  // 3. Seed Standard Plans
  console.log('Seeding Standard Monthly Plans...');
  const standardPlans = [
    // Veg Lite
    {
      code: 'veg_lite_3t_30d',
      name: 'Veg Lite',
      is_veg: true,
      tier: 'Lite',
      times_per_week: 3,
      duration_days: 30,
      validity_days: 40,
      total_price: 3200,
      per_tiffin_price: 35.56,
      total_tiffins_in_plan: 90,
      trial_price: 50,
      is_short_term: false,
    },
    {
      code: 'veg_lite_2t_30d',
      name: 'Veg Lite',
      is_veg: true,
      tier: 'Lite',
      times_per_week: 2,
      duration_days: 30,
      validity_days: 40,
      total_price: 2500,
      per_tiffin_price: 41.67,
      total_tiffins_in_plan: 60,
      trial_price: 50,
      is_short_term: false,
    },
    {
      code: 'veg_lite_1t_30d',
      name: 'Veg Lite',
      is_veg: true,
      tier: 'Lite',
      times_per_week: 1,
      duration_days: 30,
      validity_days: 40,
      total_price: 1350,
      per_tiffin_price: 45.0,
      total_tiffins_in_plan: 30,
      trial_price: 50,
      is_short_term: false,
    },

    // Non-Veg Lite
    {
      code: 'non_veg_lite_3t_30d',
      name: 'Non-Veg Lite',
      is_veg: false,
      tier: 'Lite',
      times_per_week: 3,
      duration_days: 30,
      validity_days: 40,
      total_price: 3600,
      per_tiffin_price: 40.0,
      total_tiffins_in_plan: 90,
      trial_price: 65,
      is_short_term: false,
    },
    {
      code: 'non_veg_lite_2t_30d',
      name: 'Non-Veg Lite',
      is_veg: false,
      tier: 'Lite',
      times_per_week: 2,
      duration_days: 30,
      validity_days: 40,
      total_price: 2800,
      per_tiffin_price: 46.67,
      total_tiffins_in_plan: 60,
      trial_price: 65,
      is_short_term: false,
    },
    {
      code: 'non_veg_lite_1t_30d',
      name: 'Non-Veg Lite',
      is_veg: false,
      tier: 'Lite',
      times_per_week: 1,
      duration_days: 30,
      validity_days: 40,
      total_price: 1500,
      per_tiffin_price: 50.0,
      total_tiffins_in_plan: 30,
      trial_price: 65,
      is_short_term: false,
    },

    // Veg Prime
    {
      code: 'veg_prime_3t_30d',
      name: 'Veg Prime',
      is_veg: true,
      tier: 'Prime',
      times_per_week: 3,
      duration_days: 30,
      validity_days: 45,
      total_price: 4500,
      per_tiffin_price: 50.0,
      total_tiffins_in_plan: 90,
      trial_price: 70,
      is_short_term: false,
    },
    {
      code: 'veg_prime_2t_30d',
      name: 'Veg Prime',
      is_veg: true,
      tier: 'Prime',
      times_per_week: 2,
      duration_days: 30,
      validity_days: 45,
      total_price: 3500,
      per_tiffin_price: 58.33,
      total_tiffins_in_plan: 60,
      trial_price: 70,
      is_short_term: false,
    },
    {
      code: 'veg_prime_1t_30d',
      name: 'Veg Prime',
      is_veg: true,
      tier: 'Prime',
      times_per_week: 1,
      duration_days: 30,
      validity_days: 45,
      total_price: 1800,
      per_tiffin_price: 60.0,
      total_tiffins_in_plan: 30,
      trial_price: 70,
      is_short_term: false,
    },

    // Non-Veg Prime
    {
      code: 'non_veg_prime_3t_30d',
      name: 'Non-Veg Prime',
      is_veg: false,
      tier: 'Prime',
      times_per_week: 3,
      duration_days: 30,
      validity_days: 45,
      total_price: 5100,
      per_tiffin_price: 56.67,
      total_tiffins_in_plan: 90,
      trial_price: 90,
      is_short_term: false,
    },
    {
      code: 'non_veg_prime_2t_30d',
      name: 'Non-Veg Prime',
      is_veg: false,
      tier: 'Prime',
      times_per_week: 2,
      duration_days: 30,
      validity_days: 45,
      total_price: 3900,
      per_tiffin_price: 65.0,
      total_tiffins_in_plan: 60,
      trial_price: 90,
      is_short_term: false,
    },
    {
      code: 'non_veg_prime_1t_30d',
      name: 'Non-Veg Prime',
      is_veg: false,
      tier: 'Prime',
      times_per_week: 1,
      duration_days: 30,
      validity_days: 45,
      total_price: 2000,
      per_tiffin_price: 66.67,
      total_tiffins_in_plan: 30,
      trial_price: 90,
      is_short_term: false,
    },
  ];

  // 4. Seed Short Term Plans
  console.log('Seeding Short Term Plans...');
  const shortTermPlans = [
    // Veg Lite Short Term
    { code: 'veg_lite_3t_15d_st', name: 'Veg Lite', is_veg: true, tier: 'Lite', times_per_week: 3, duration_days: 15, validity_days: 20, total_price: 1700, per_tiffin_price: 37.78, total_tiffins_in_plan: 45, is_short_term: true },
    { code: 'veg_lite_2t_15d_st', name: 'Veg Lite', is_veg: true, tier: 'Lite', times_per_week: 2, duration_days: 15, validity_days: 20, total_price: 1300, per_tiffin_price: 43.33, total_tiffins_in_plan: 30, is_short_term: true },
    { code: 'veg_lite_1t_15d_st', name: 'Veg Lite', is_veg: true, tier: 'Lite', times_per_week: 1, duration_days: 15, validity_days: 20, total_price: 700, per_tiffin_price: 46.67, total_tiffins_in_plan: 15, is_short_term: true },
    { code: 'veg_lite_3t_7d_st', name: 'Veg Lite', is_veg: true, tier: 'Lite', times_per_week: 3, duration_days: 7, validity_days: 10, total_price: 850, per_tiffin_price: 40.48, total_tiffins_in_plan: 21, is_short_term: true },
    { code: 'veg_lite_2t_7d_st', name: 'Veg Lite', is_veg: true, tier: 'Lite', times_per_week: 2, duration_days: 7, validity_days: 10, total_price: 700, per_tiffin_price: 50.0, total_tiffins_in_plan: 14, is_short_term: true },
    { code: 'veg_lite_1t_7d_st', name: 'Veg Lite', is_veg: true, tier: 'Lite', times_per_week: 1, duration_days: 7, validity_days: 10, total_price: 360, per_tiffin_price: 51.43, total_tiffins_in_plan: 7, is_short_term: true },

    // Non-Veg Lite Short Term
    { code: 'non_veg_lite_3t_15d_st', name: 'Non-Veg Lite', is_veg: false, tier: 'Lite', times_per_week: 3, duration_days: 15, validity_days: 20, total_price: 1900, per_tiffin_price: 42.22, total_tiffins_in_plan: 45, is_short_term: true },
    { code: 'non_veg_lite_2t_15d_st', name: 'Non-Veg Lite', is_veg: false, tier: 'Lite', times_per_week: 2, duration_days: 15, validity_days: 20, total_price: 1500, per_tiffin_price: 50.0, total_tiffins_in_plan: 30, is_short_term: true },
    { code: 'non_veg_lite_1t_15d_st', name: 'Non-Veg Lite', is_veg: false, tier: 'Lite', times_per_week: 1, duration_days: 15, validity_days: 20, total_price: 800, per_tiffin_price: 53.33, total_tiffins_in_plan: 15, is_short_term: true },
    { code: 'non_veg_lite_3t_7d_st', name: 'Non-Veg Lite', is_veg: false, tier: 'Lite', times_per_week: 3, duration_days: 7, validity_days: 10, total_price: 950, per_tiffin_price: 45.24, total_tiffins_in_plan: 21, is_short_term: true },
    { code: 'non_veg_lite_2t_7d_st', name: 'Non-Veg Lite', is_veg: false, tier: 'Lite', times_per_week: 2, duration_days: 7, validity_days: 10, total_price: 750, per_tiffin_price: 53.57, total_tiffins_in_plan: 14, is_short_term: true },
    { code: 'non_veg_lite_1t_7d_st', name: 'Non-Veg Lite', is_veg: false, tier: 'Lite', times_per_week: 1, duration_days: 7, validity_days: 10, total_price: 400, per_tiffin_price: 57.14, total_tiffins_in_plan: 7, is_short_term: true },

    // Veg Prime Short Term
    { code: 'veg_prime_3t_15d_st', name: 'Veg Prime', is_veg: true, tier: 'Prime', times_per_week: 3, duration_days: 15, validity_days: 20, total_price: 2300, per_tiffin_price: 51.11, total_tiffins_in_plan: 45, is_short_term: true },
    { code: 'veg_prime_2t_15d_st', name: 'Veg Prime', is_veg: true, tier: 'Prime', times_per_week: 2, duration_days: 15, validity_days: 20, total_price: 1800, per_tiffin_price: 60.0, total_tiffins_in_plan: 30, is_short_term: true },
    { code: 'veg_prime_1t_15d_st', name: 'Veg Prime', is_veg: true, tier: 'Prime', times_per_week: 1, duration_days: 15, validity_days: 20, total_price: 1000, per_tiffin_price: 66.67, total_tiffins_in_plan: 15, is_short_term: true },
    { code: 'veg_prime_3t_7d_st', name: 'Veg Prime', is_veg: true, tier: 'Prime', times_per_week: 3, duration_days: 7, validity_days: 10, total_price: 1150, per_tiffin_price: 54.76, total_tiffins_in_plan: 21, is_short_term: true },
    { code: 'veg_prime_2t_7d_st', name: 'Veg Prime', is_veg: true, tier: 'Prime', times_per_week: 2, duration_days: 7, validity_days: 10, total_price: 900, per_tiffin_price: 64.29, total_tiffins_in_plan: 14, is_short_term: true },
    { code: 'veg_prime_1t_7d_st', name: 'Veg Prime', is_veg: true, tier: 'Prime', times_per_week: 1, duration_days: 7, validity_days: 10, total_price: 500, per_tiffin_price: 71.43, total_tiffins_in_plan: 7, is_short_term: true },

    // Non-Veg Prime Short Term
    { code: 'non_veg_prime_3t_15d_st', name: 'Non-Veg Prime', is_veg: false, tier: 'Prime', times_per_week: 3, duration_days: 15, validity_days: 20, total_price: 2600, per_tiffin_price: 57.78, total_tiffins_in_plan: 45, is_short_term: true },
    { code: 'non_veg_prime_2t_15d_st', name: 'Non-Veg Prime', is_veg: false, tier: 'Prime', times_per_week: 2, duration_days: 15, validity_days: 20, total_price: 2000, per_tiffin_price: 66.67, total_tiffins_in_plan: 30, is_short_term: true },
    { code: 'non_veg_prime_1t_15d_st', name: 'Non-Veg Prime', is_veg: false, tier: 'Prime', times_per_week: 1, duration_days: 15, validity_days: 20, total_price: 1100, per_tiffin_price: 73.33, total_tiffins_in_plan: 15, is_short_term: true },
    { code: 'non_veg_prime_3t_7d_st', name: 'Non-Veg Prime', is_veg: false, tier: 'Prime', times_per_week: 3, duration_days: 7, validity_days: 10, total_price: 1300, per_tiffin_price: 61.90, total_tiffins_in_plan: 21, is_short_term: true },
    { code: 'non_veg_prime_2t_7d_st', name: 'Non-Veg Prime', is_veg: false, tier: 'Prime', times_per_week: 2, duration_days: 7, validity_days: 10, total_price: 1000, per_tiffin_price: 71.43, total_tiffins_in_plan: 14, is_short_term: true },
    { code: 'non_veg_prime_1t_7d_st', name: 'Non-Veg Prime', is_veg: false, tier: 'Prime', times_per_week: 1, duration_days: 7, validity_days: 10, total_price: 550, per_tiffin_price: 78.57, total_tiffins_in_plan: 7, is_short_term: true },
  ];

  // 4b. Single-Tiffin "Try Once" Orders (one meal, no subscription — trial_price from the menu card)
  console.log('Seeding Single-Tiffin Trial Orders...');
  const singleTiffinPlans = [
    { code: 'veg_lite_trial_1d', name: 'Veg Lite', is_veg: true, tier: 'Lite', times_per_week: 1, duration_days: 1, validity_days: 1, total_price: 50, per_tiffin_price: 50, total_tiffins_in_plan: 1, is_short_term: true, trial_price: 50 },
    { code: 'non_veg_lite_trial_1d', name: 'Non-Veg Lite', is_veg: false, tier: 'Lite', times_per_week: 1, duration_days: 1, validity_days: 1, total_price: 65, per_tiffin_price: 65, total_tiffins_in_plan: 1, is_short_term: true, trial_price: 65 },
    { code: 'veg_prime_trial_1d', name: 'Veg Prime', is_veg: true, tier: 'Prime', times_per_week: 1, duration_days: 1, validity_days: 1, total_price: 70, per_tiffin_price: 70, total_tiffins_in_plan: 1, is_short_term: true, trial_price: 70 },
    { code: 'non_veg_prime_trial_1d', name: 'Non-Veg Prime', is_veg: false, tier: 'Prime', times_per_week: 1, duration_days: 1, validity_days: 1, total_price: 90, per_tiffin_price: 90, total_tiffins_in_plan: 1, is_short_term: true, trial_price: 90 },
  ];

  const allPlans = [...standardPlans, ...shortTermPlans, ...singleTiffinPlans];

  for (const planData of allPlans) {
    const plan = await prisma.plan.upsert({
      where: { code: planData.code },
      update: planData,
      create: planData,
    });

    // Populate day menu entries for this plan
    const menu = menuByPlanName[plan.name];
    if (menu) {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const mealTypes = ['breakfast', 'lunch', 'dinner'];

      for (const day of days) {
        for (const mealType of mealTypes) {
          const description = menu[day][mealType];
          if (!description) continue;

          const isHighlighted = description.includes('⭐');
          const entry = await prisma.dayMenuEntry.upsert({
            where: {
              plan_id_day_of_week_meal_type: {
                plan_id: plan.id,
                day_of_week: day,
                meal_type: mealType,
              },
            },
            update: {
              description,
              is_highlighted: isHighlighted,
            },
            create: {
              plan_id: plan.id,
              day_of_week: day,
              meal_type: mealType,
              description,
              is_highlighted: isHighlighted,
            },
          });

          // Delete existing components and re-create to keep sync
          await prisma.mealComponent.deleteMany({
            where: { day_menu_entry_id: entry.id },
          });

          const components = parseComponents(description);
          for (const comp of components) {
            await prisma.mealComponent.create({
              data: {
                day_menu_entry_id: entry.id,
                name: comp.name,
                addon_id: comp.addon_id,
              },
            });
          }
        }
      }
    }
  }

  // 5. Seed Delivery Partners (Sample Ranchi Areas)
  console.log('Seeding Sample Delivery Partners...');
  const partners = [
    { name: 'Ramesh Kumar', phone: '9876543210', assigned_area: 'Lalpur' },
    { name: 'Suresh Singh', phone: '9876543211', assigned_area: 'Hinoo' },
    { name: 'Amit Verma', phone: '9876543212', assigned_area: 'Morabadi' },
    { name: 'Vikas Oraon', phone: '9876543213', assigned_area: 'Doranda' },
  ];

  const defaultDeliveryPin = process.env.DELIVERY_DEFAULT_PIN || '1234';
  const deliveryPinHash = await bcrypt.hash(defaultDeliveryPin, 10);

  for (const partner of partners) {
    await prisma.deliveryPartner.upsert({
      where: { phone: partner.phone },
      update: { ...partner, pin_hash: deliveryPinHash },
      create: { ...partner, pin_hash: deliveryPinHash },
    });
  }
  console.log(`  (Delivery partner login PIN defaults to "${defaultDeliveryPin}" — reset from Admin Hub before going live)`);

  // 6. Seed Default Admin User
  console.log('Seeding Default Admin User...');
  const defaultAdminEmail = process.env.ADMIN_DEFAULT_EMAIL || 'admin@cirota.in';
  const defaultAdminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'CirotaAdmin#2026';
  const passwordHash = await bcrypt.hash(defaultAdminPassword, 10);

  await prisma.adminUser.upsert({
    where: { email: defaultAdminEmail },
    update: {
      password_hash: passwordHash,
      role: 'SUPER_ADMIN',
    },
    create: {
      email: defaultAdminEmail,
      password_hash: passwordHash,
      role: 'SUPER_ADMIN',
    },
  });

  console.log('✅ Seeding completed successfully!');
  console.log(`- Seeded Plans: ${allPlans.length}`);
  console.log(`- Seeded AddOns: ${addOnsData.length}`);
  console.log(`- Default Admin: ${defaultAdminEmail}`);
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
