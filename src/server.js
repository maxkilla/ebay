const express = require('express');
const axios = require('axios');
const config = require('./config');
const ebayAuth = require('./ebayAuthClient');
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
    const token = await ebayAuth.getApplicationToken();
    const result = await axios.get(`${config.apiBaseUrl}/buy/browse/v1/item_summary/search`, {
      params: { q, limit: 5 },
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });
    res.json(result.data);
  } catch (err) {
    const detail = err.response ? err.response.data : err.message;
    res.status(500).json({ error: 'ebay_api_error', detail });
  }
});

// Demo: proves the user (3-legged) token works by calling a Sell API endpoint
// that requires a logged-in seller. Requires /auth/ebay/login to have been
// completed first.
app.get('/api/demo/privileges', async (req, res) => {
  try {
    const token = await ebayAuth.getUserAccessToken();
    const result = await axios.get(`${config.apiBaseUrl}/sell/account/v1/privilege`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    res.json(result.data);
  } catch (err) {
    const detail = err.response ? err.response.data : err.message;
    res.status(err.response ? err.response.status : 500).json({ error: 'ebay_api_error', detail });
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
