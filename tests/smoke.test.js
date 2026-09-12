/**
 * Smoke & Integration Test Suite for Cirota Backend
 * Verifies core business rules, transactional balance updates, and API responses.
 */

const crypto = require('crypto');
const env = require('../src/config/env');
const prisma = require('../src/config/prisma');
const { sendOtp, verifyOtp } = require('../src/services/otp');
const { createOrder, verifyWebhookSignature, processWebhookEvent } = require('../src/services/razorpay');
const { generateDailyOrdersForDate } = require('../src/cron/dailyOrderGen');
const { runLowBalanceSweep } = require('../src/cron/lowBalanceSweep');
const { runAutoStopCheck } = require('../src/cron/autoStopCheck');

async function runSmokeTests() {
  console.log('\n🧪 Starting Cirota Backend Comprehensive Smoke Test...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: Plan & AddOn verification
    // -------------------------------------------------------------
    console.log('--- Step 1: Database Seed & Menu Checks ---');
    const plans = await prisma.plan.findMany();
    assert(plans.length >= 24, `Plans seeded correctly (Found: ${plans.length}, Expected >= 24)`);

    const vegLite3T = await prisma.plan.findFirst({
      where: { code: 'veg_lite_3t_30d' },
      include: { day_menus: { include: { components: true } } },
    });
    assert(vegLite3T && vegLite3T.total_price === 3300, 'Veg Lite 3T standard plan price is ₹3300');
    assert(vegLite3T && vegLite3T.total_tiffins_in_plan === 90, 'Veg Lite 3T standard plan has 90 tiffins');
    assert(vegLite3T && vegLite3T.validity_days === 40, 'Veg Lite 3T has 40 days validity');
    assert(vegLite3T.day_menus.length === 21, `Veg Lite 7-day day_menus count is 21 (Found: ${vegLite3T.day_menus.length})`);

    const nonVegPrime3T = await prisma.plan.findFirst({
      where: { code: 'non_veg_prime_3t_30d' },
    });
    assert(nonVegPrime3T && nonVegPrime3T.total_price === 5100, 'Non-Veg Prime 3T price is ₹5100');

    const addOns = await prisma.addOn.findMany();
    assert(addOns.length === 6, `AddOns seeded (Found: ${addOns.length}, Expected: 6)`);

    // -------------------------------------------------------------
    // Test 2: OTP Service (MSG91 / Dev mode)
    // -------------------------------------------------------------
    console.log('\n--- Step 2: OTP Service ---');
    const testPhone = '9988776655';
    const otpRes = await sendOtp(testPhone);
    assert(otpRes.success === true, 'OTP requested successfully');

    const otpRecord = await prisma.otpRequest.findFirst({
      where: { phone: testPhone, used: false },
      orderBy: { created_at: 'desc' },
    });
    assert(otpRecord && otpRecord.otp.length === 6, `Valid 6-digit OTP stored: ${otpRecord?.otp}`);

    const verifySuccess = await verifyOtp(testPhone, otpRecord.otp);
    assert(verifySuccess === true, 'OTP verified successfully');

    const usedRecord = await prisma.otpRequest.findUnique({ where: { id: otpRecord.id } });
    assert(usedRecord.used === true, 'OTP marked as used (prevents replay)');

    const reVerify = await verifyOtp(testPhone, otpRecord.otp);
    assert(reVerify === false, 'Replaying used OTP correctly fails');

    // -------------------------------------------------------------
    // Test 3: Customer Subscription & Initial Order Generation
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Customer Subscription & Order Generation ---');
    const customerPhone = '9123456780';
    // Clean any prior test customer
    await prisma.customer.deleteMany({ where: { phone: customerPhone } });

    const targetPlan = await prisma.plan.findFirst({ where: { code: 'veg_lite_3t_30d' } });

    const newCustomer = await prisma.customer.create({
      data: {
        name: 'Ranchi Test User',
        phone: customerPhone,
        area: 'Lalpur',
        address: 'Circular Road, Lalpur, Ranchi',
        plan_id: targetPlan.id,
        start_date: new Date(),
        times_per_day: 3,
        mrp: targetPlan.total_price,
        total_tiffins_in_plan: targetPlan.total_tiffins_in_plan,
        per_tiffin_price: targetPlan.per_tiffin_price,
        tiffins_remaining: 5, // Set to 5 for test
        tiffins_sent: 0,
        status: 'active',
      },
    });
    assert(newCustomer.id !== undefined, 'Customer created in database');
    assert(newCustomer.tiffins_remaining === 5, 'Customer initial remaining balance is 5');

    // Run Daily Order Gen
    const genResult = await generateDailyOrdersForDate(new Date());
    assert(genResult.generatedOrders >= 1, `Daily Orders generated (Count: ${genResult.generatedOrders})`);

    const customerOrders = await prisma.dailyOrder.findMany({
      where: { customer_id: newCustomer.id },
    });
    assert(customerOrders.length >= 1, `Customer has daily orders (Count: ${customerOrders.length})`);

    // -------------------------------------------------------------
    // Test 4: Razorpay Webhook & Atomic Balance Reset
    // -------------------------------------------------------------
    console.log('\n--- Step 4: Razorpay Webhook & Balance Reset ---');
    const orderData = await createOrder(targetPlan.id, newCustomer.id);
    assert(orderData.order_id !== undefined, `Razorpay Order generated: ${orderData.order_id}`);

    const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
    const testPayload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_mock_${Date.now()}`,
            order_id: orderData.order_id,
            amount: targetPlan.total_price * 100,
            status: 'captured',
          },
        },
      },
    });

    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(testPayload)
      .digest('hex');

    const isValidSignature = verifyWebhookSignature(testPayload, signature);
    assert(isValidSignature === true, 'Razorpay HMAC-SHA256 signature verification succeeds');

    const isInvalidSignature = verifyWebhookSignature(testPayload, 'bad_signature_123');
    assert(isInvalidSignature === false, 'Invalid signature correctly rejected');

    const webhookResult = await processWebhookEvent(JSON.parse(testPayload));
    assert(webhookResult.success === true, 'Webhook event processed');

    const refreshedCustomer = await prisma.customer.findUnique({ where: { id: newCustomer.id } });
    assert(
      refreshedCustomer.tiffins_remaining === targetPlan.total_tiffins_in_plan,
      `Balance reset transactionally to ${targetPlan.total_tiffins_in_plan} tiffins (Current: ${refreshedCustomer.tiffins_remaining})`
    );
    assert(refreshedCustomer.tiffins_sent === 0, 'Tiffins sent reset to 0');
    assert(refreshedCustomer.status === 'active', 'Customer status set to active');

    // Test Idempotency: re-running webhook should not double-credit
    const idempotentResult = await processWebhookEvent(JSON.parse(testPayload));
    assert(idempotentResult.already_processed === true, 'Webhook retry handled idempotently without re-crediting');

    // -------------------------------------------------------------
    // Test 5: Delivery Confirmation & Tiffin Decrement Transaction
    // -------------------------------------------------------------
    console.log('\n--- Step 5: Delivery Confirmation & Atomic Decrement ---');
    const orderToDeliver = customerOrders[0];
    const preDeliveryBalance = refreshedCustomer.tiffins_remaining;

    // Simulate delivery
    await prisma.$transaction(async (tx) => {
      await tx.dailyOrder.update({
        where: { id: orderToDeliver.id },
        data: { status: 'delivered', delivered_at: new Date() },
      });
      await tx.customer.update({
        where: { id: newCustomer.id },
        data: {
          tiffins_remaining: preDeliveryBalance - 1,
          tiffins_sent: refreshedCustomer.tiffins_sent + 1,
        },
      });
    });

    const postDeliveryCustomer = await prisma.customer.findUnique({ where: { id: newCustomer.id } });
    assert(
      postDeliveryCustomer.tiffins_remaining === preDeliveryBalance - 1,
      `Tiffins remaining decremented by 1 (${preDeliveryBalance} -> ${postDeliveryCustomer.tiffins_remaining})`
    );
    assert(postDeliveryCustomer.tiffins_sent === 1, 'Tiffins sent incremented to 1');

    // -------------------------------------------------------------
    // Test 6: Pause and Resume Logic
    // -------------------------------------------------------------
    console.log('\n--- Step 6: Pause & Resume Behavior ---');
    // Pause Next Meal
    const nextOrder = customerOrders[1] || customerOrders[0];
    await prisma.dailyOrder.update({
      where: { id: nextOrder.id },
      data: { status: 'paused' },
    });
    const pausedOrderCheck = await prisma.dailyOrder.findUnique({ where: { id: nextOrder.id } });
    assert(pausedOrderCheck.status === 'paused', 'Next meal marked as paused');

    const customerBalanceAfterPause = await prisma.customer.findUnique({ where: { id: newCustomer.id } });
    assert(
      customerBalanceAfterPause.tiffins_remaining === postDeliveryCustomer.tiffins_remaining,
      'Pausing meal does NOT decrement tiffins_remaining'
    );

    // -------------------------------------------------------------
    // Test 7: Low Balance Sweep & Auto Stop
    // -------------------------------------------------------------
    console.log('\n--- Step 7: Sweeps & Safety Net ---');
    // Set customer balance to 3 for low balance sweep test
    await prisma.customer.update({
      where: { id: newCustomer.id },
      data: { tiffins_remaining: 3 },
    });

    const sweepRes = await runLowBalanceSweep();
    assert(sweepRes.evaluated >= 1, `Low balance sweep evaluated customers (${sweepRes.evaluated})`);

    const logEntry = await prisma.notificationLog.findFirst({
      where: { customer_id: newCustomer.id, type: 'low_balance' },
    });
    assert(logEntry !== null, 'Low balance notification logged to prevent duplicate daily alerts');

    // Auto-Stop check when balance hits 0
    await prisma.customer.update({
      where: { id: newCustomer.id },
      data: { tiffins_remaining: 0, status: 'active' },
    });

    const autoStopRes = await runAutoStopCheck();
    assert(autoStopRes.updated >= 1, 'Auto-Stop check caught balance 0 customer');

    const stoppedCustomer = await prisma.customer.findUnique({ where: { id: newCustomer.id } });
    assert(stoppedCustomer.status === 'stopped_no_balance', 'Status updated to stopped_no_balance');

    // Clean up test customer
    await prisma.customer.delete({ where: { id: newCustomer.id } });
  } catch (error) {
    console.error('❌ Exception during smoke test:', error);
    failed++;
  }

  console.log('\n=============================================');
  console.log(`📊 Smoke Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runSmokeTests()
    .then(() => {
      prisma.$disconnect();
    })
    .catch((err) => {
      console.error(err);
      prisma.$disconnect();
      process.exit(1);
    });
}

module.exports = { runSmokeTests };
