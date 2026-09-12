const prisma = require('../config/prisma');
const { normalizeToStartOfDay } = require('../utils/dateUtils');
const { logAuditEvent } = require('./audit');

/**
 * Create or renew a customer's subscription against a plan.
 * Shared by:
 *   - POST /api/customer/subscribe   (self-serve, via app/website)
 *   - POST /api/admin/orders/manual  (CRM: staff logging a phone-in order)
 *
 * `source` is just for the audit trail ("self_serve" | "admin_phone_order").
 */
async function createOrRenewSubscription({ name, phone, area, address, lat, lng, plan_id, times_per_day, start_date, source = 'self_serve', createdByAdminId = null }) {
  const cleanPhone = phone.replace(/^\+?91/, '').replace(/^0/, '').trim();

  const plan = await prisma.plan.findUnique({ where: { id: plan_id } });
  if (!plan) {
    const err = new Error('Selected plan not found');
    err.statusCode = 404;
    err.code = 'PLAN_NOT_FOUND';
    throw err;
  }

  const startDateObj = start_date ? new Date(start_date) : new Date();
  const dueDate = new Date(startDateObj);
  dueDate.setDate(dueDate.getDate() + (plan.validity_days || 40));

  const matchingPartner = await prisma.deliveryPartner.findFirst({
    where: { assigned_area: { contains: area, mode: 'insensitive' }, is_active: true },
  });

  const customer = await prisma.$transaction(async (tx) => {
    const existing = await tx.customer.findUnique({ where: { phone: cleanPhone } });

    const sharedData = {
      name,
      area,
      address,
      lat: lat ?? undefined,
      lng: lng ?? undefined,
      plan_id: plan.id,
      start_date: startDateObj,
      times_per_day,
      mrp: plan.total_price,
      total_tiffins_in_plan: plan.total_tiffins_in_plan,
      per_tiffin_price: plan.per_tiffin_price,
      tiffins_remaining: plan.total_tiffins_in_plan,
      tiffins_sent: 0,
      due_amount: 0,
      due_date: dueDate,
      status: 'active',
      delivery_partner_id: matchingPartner ? matchingPartner.id : null,
    };

    let cust;
    if (existing) {
      cust = await tx.customer.update({ where: { id: existing.id }, data: sharedData });
    } else {
      cust = await tx.customer.create({ data: { ...sharedData, phone: cleanPhone } });
    }

    const mealTypesForTimes = times_per_day === 3 ? ['breakfast', 'lunch', 'dinner'] : times_per_day === 2 ? ['lunch', 'dinner'] : ['lunch'];

    for (let i = 0; i < 7; i++) {
      const orderDate = new Date(startDateObj);
      orderDate.setDate(orderDate.getDate() + i);
      const dayNormalized = normalizeToStartOfDay(orderDate);

      for (const mType of mealTypesForTimes) {
        await tx.dailyOrder.upsert({
          where: {
            customer_id_date_meal_type: { customer_id: cust.id, date: dayNormalized, meal_type: mType },
          },
          update: { status: 'confirmed', delivery_partner_id: matchingPartner ? matchingPartner.id : null },
          create: {
            customer_id: cust.id,
            date: dayNormalized,
            meal_type: mType,
            status: 'confirmed',
            roti_paratha_count: 0,
            delivery_partner_id: matchingPartner ? matchingPartner.id : null,
          },
        });
      }
    }

    await logAuditEvent({
      entityType: 'Customer',
      entityId: cust.id,
      action: 'CUSTOMER_SUBSCRIBED',
      newState: { plan_id: plan.id, plan_name: plan.name, tiffins: plan.total_tiffins_in_plan },
      metadata: { source, created_by_admin_id: createdByAdminId },
      db: tx,
    });

    return cust;
  });

  return customer;
}

module.exports = { createOrRenewSubscription };
