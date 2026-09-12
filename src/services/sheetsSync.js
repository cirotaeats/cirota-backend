const { google } = require('googleapis');
const prisma = require('../config/prisma');
const env = require('../config/env');
const logger = require('../utils/logger');
const { getDaysInMonth, formatDateIST } = require('../utils/dateUtils');

/**
 * Get Authenticated Google Sheets Client
 */
function getSheetsClient() {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return null;
  }

  try {
    const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
  } catch (err) {
    logger.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', err);
    return null;
  }
}

/**
 * Retry helper with exponential backoff
 */
async function withRetry(fn, retries = 3, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) {
        logger.error('Google Sheets sync failed after max retries:', err.message || err);
        return null;
      }
      logger.warn(`Google Sheets sync attempt ${i + 1} failed (${err.message}). Retrying in ${delayMs * (i + 1)}ms...`);
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
}

/**
 * Regenerate and overwrite Master Sheet (Postgres -> Google Sheets)
 */
async function syncMasterSheet() {
  const sheets = getSheetsClient();
  const spreadsheetId = env.MASTER_SHEET_ID;

  if (!sheets || !spreadsheetId) {
    logger.info('Google Sheets sync skipped (GOOGLE_SERVICE_ACCOUNT_JSON or MASTER_SHEET_ID not configured).');
    return { skipped: true, reason: 'unconfigured' };
  }

  return await withRetry(async () => {
    // 1. Query all customers with related Plan and DeliveryPartner
    const customers = await prisma.customer.findMany({
      include: {
        plan: true,
        delivery_partner: true,
      },
      orderBy: [{ area: 'asc' }, { name: 'asc' }],
    });

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const daysCount = getDaysInMonth(currentYear, currentMonth);

    // Fetch this month's delivered orders for all customers to fill day-wise matrix
    const monthStart = new Date(Date.UTC(currentYear, currentMonth, 1, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(currentYear, currentMonth, daysCount, 23, 59, 59));

    const monthOrders = await prisma.dailyOrder.findMany({
      where: {
        date: { gte: monthStart, lte: monthEnd },
        status: 'delivered',
      },
      select: {
        customer_id: true,
        date: true,
      },
    });

    // Map customer orders by day of month
    const customerDayDeliveryMap = {};
    for (const order of monthOrders) {
      const day = new Date(order.date).getUTCDate();
      if (!customerDayDeliveryMap[order.customer_id]) {
        customerDayDeliveryMap[order.customer_id] = {};
      }
      customerDayDeliveryMap[order.customer_id][day] = (customerDayDeliveryMap[order.customer_id][day] || 0) + 1;
    }

    // 2. Build Header Row matching owner's layout
    const headerRow = [
      'Area',
      'Customer Name',
      'Phone',
      'Start Date',
      'Plan',
      'Times/Day',
      'MRP (₹)',
      'Payment Status',
      'Total Tiffins',
      'Per Tiffin (₹)',
      'Tiffins Sent',
      'Sent Value (₹)',
      'Tiffins Left',
      'Additional Charges (₹)',
      'Advance (₹)',
      'Due Amount (₹)',
      'Due Date',
      'Status',
      'Delivery Partner',
    ];

    // Append day columns 1..N of current month
    for (let day = 1; day <= daysCount; day++) {
      headerRow.push(`Day ${day}`);
    }

    const rows = [headerRow];

    // 3. Build Data Rows
    for (const c of customers) {
      const planName = c.plan ? c.plan.name : 'Custom';
      const sentValue = (c.tiffins_sent * (c.per_tiffin_price || 0)).toFixed(2);
      const row = [
        c.area || '',
        c.name || '',
        c.phone || '',
        formatDateIST(c.start_date),
        planName,
        c.times_per_day || 1,
        c.mrp || 0,
        c.payment_status || '',
        c.total_tiffins_in_plan || 0,
        c.per_tiffin_price || 0,
        c.tiffins_sent || 0,
        Number(sentValue),
        c.tiffins_remaining || 0,
        c.additional_charges || 0,
        c.advance_amount || 0,
        c.due_amount || 0,
        formatDateIST(c.due_date),
        c.status || '',
        c.delivery_partner ? c.delivery_partner.name : '',
      ];

      // Fill daily counts
      const dayCounts = customerDayDeliveryMap[c.id] || {};
      for (let day = 1; day <= daysCount; day++) {
        row.push(dayCounts[day] || '');
      }

      rows.push(row);
    }

    // 4. Overwrite Master Sheet with a single batch update
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'MasterSheet!A1',
      valueInputOption: 'RAW',
      requestBody: {
        values: rows,
      },
    });

    logger.info(`Master Sheet synced successfully with ${customers.length} customer records.`);
    return { success: true, count: customers.length };
  });
}

/**
 * Regenerate and overwrite Daily Sheet for a specific date (default: today)
 */
async function syncDailySheet(targetDate = new Date()) {
  const sheets = getSheetsClient();
  const spreadsheetId = env.DAILY_SHEET_ID;

  if (!sheets || !spreadsheetId) {
    logger.info('Daily Google Sheets sync skipped (GOOGLE_SERVICE_ACCOUNT_JSON or DAILY_SHEET_ID not configured).');
    return { skipped: true, reason: 'unconfigured' };
  }

  return await withRetry(async () => {
    const start = new Date(targetDate);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(targetDate);
    end.setUTCHours(23, 59, 59, 999);

    const orders = await prisma.dailyOrder.findMany({
      where: {
        date: { gte: start, lte: end },
      },
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

    const headerRow = [
      'Date',
      'Partner',
      'Area',
      'Customer Name',
      'Phone',
      'Address',
      'Plan',
      'Meal Type',
      'Roti/Paratha Count',
      'Status',
      'Tiffins Remaining',
      'Delivered At',
    ];

    const rows = [headerRow];

    for (const ord of orders) {
      rows.push([
        formatDateIST(ord.date),
        ord.delivery_partner ? ord.delivery_partner.name : 'Unassigned',
        ord.customer.area || '',
        ord.customer.name || '',
        ord.customer.phone || '',
        ord.customer.address || '',
        ord.customer.plan ? ord.customer.plan.name : 'Custom',
        ord.meal_type,
        ord.roti_paratha_count || 0,
        ord.status,
        ord.customer.tiffins_remaining,
        ord.delivered_at ? formatDateIST(ord.delivered_at) : '',
      ]);
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'DailySheet!A1',
      valueInputOption: 'RAW',
      requestBody: {
        values: rows,
      },
    });

    logger.info(`Daily Sheet synced successfully for ${formatDateIST(targetDate)} with ${orders.length} orders.`);
    return { success: true, count: orders.length, date: formatDateIST(targetDate) };
  });
}

module.exports = {
  syncMasterSheet,
  syncDailySheet,
};
