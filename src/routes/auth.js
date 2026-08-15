const express = require('express');
const ebayAuth = require('../ebayAuthClient');

const router = express.Router();

router.get('/login', (req, res) => {
  try {
    const { url } = ebayAuth.beginUserAuthorization();
    res.redirect(url);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return res.status(400).json({ error, error_description: errorDescription });
  }
  if (!code) {
    return res.status(400).json({ error: 'missing_code', message: 'eBay did not return an authorization code.' });
  }
  if (!state || !ebayAuth.consumeState(state)) {
    return res.status(400).json({ error: 'invalid_state', message: 'State parameter missing, unrecognized, or expired. Possible CSRF or a stale login link (states expire after 15 minutes).' });
  }

  try {
    const record = await ebayAuth.exchangeCodeForToken(code);
    res.json({
      message: 'eBay account authorized successfully. Tokens stored.',
      expires_in: record.expires_in,
      refresh_token_expires_in: record.refresh_token_expires_in,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', (req, res) => {
  res.json(ebayAuth.getUserTokenStatus());
});

router.post('/refresh', async (req, res) => {
  try {
    const record = await ebayAuth.refreshUserToken();
    res.json({ message: 'Token refreshed.', expires_in: record.expires_in });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
