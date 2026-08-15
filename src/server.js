const express = require('express');
const config = require('./config');
const { ebayRequest } = require('./apiClient');
const authRoutes = require('./routes/auth');

const app = express();

app.use('/auth/ebay', authRoutes);

app.get('/health', (req, res) => {
  res.json({ ok: true, env: config.env });
});

// Demo: proves the client-credentials (application) token actually works
// by hitting the Browse API's public item search.
app.get('/api/demo/search', async (req, res) => {
  const q = req.query.q || 'baseball card';
  try {
    const result = await ebayRequest({ path: '/buy/browse/v1/item_summary/search', query: { q, limit: 5 } });
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Demo: proves the user (3-legged) token works by calling a Sell API endpoint
// that requires a logged-in seller. Requires /auth/ebay/login to have been
// completed first.
app.get('/api/demo/privileges', async (req, res) => {
  try {
    const result = await ebayRequest({ path: '/sell/account/v1/privilege', useUserToken: true });
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(config.port, () => {
  console.log(`eBay OAuth server listening on port ${config.port} [env=${config.env}]`);
  console.log(`  Health:            GET  ${config.publicBaseUrl}/health`);
  console.log(`  Start user login:  GET  ${config.publicBaseUrl}/auth/ebay/login`);
  console.log(`  Token status:      GET  ${config.publicBaseUrl}/auth/ebay/status`);
  console.log(`  Demo (app token):  GET  ${config.publicBaseUrl}/api/demo/search?q=iphone`);
  console.log(`  Demo (user token): GET  ${config.publicBaseUrl}/api/demo/privileges`);
});
