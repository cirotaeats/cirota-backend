const app = require('../src/app');
const prisma = require('../src/config/prisma');

async function testApiEndpoints() {
  console.log('\n🌐 Testing Express API Endpoints...\n');
  const server = app.listen(3099, async () => {
    try {
      const axios = require('axios');
      const base = 'http://localhost:3099';

      // 1. Health check
      const healthRes = await axios.get(`${base}/health`);
      console.log(`✅ GET /health: ${healthRes.data.status} (database: ${healthRes.data.database})`);

      // 2. Plans list
      const plansRes = await axios.get(`${base}/api/menu/plans`);
      console.log(`✅ GET /api/menu/plans: ${plansRes.data.data.length} plans returned`);

      // 3. AddOns list
      const addOnsRes = await axios.get(`${base}/api/menu/add-ons`);
      console.log(`✅ GET /api/menu/add-ons: ${addOnsRes.data.data.length} add-ons returned`);

      // 4. VAPID public key
      const vapidRes = await axios.get(`${base}/api/push/vapid-public-key`);
      console.log(`✅ GET /api/push/vapid-public-key: status ${vapidRes.status}`);

      console.log('\n✨ All HTTP endpoints responding cleanly!\n');
    } catch (err) {
      console.error('❌ API Test Error:', err.message);
    } finally {
      server.close();
      await prisma.$disconnect();
    }
  });
}

testApiEndpoints();
