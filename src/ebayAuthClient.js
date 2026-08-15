const axios = require('axios');
const config = require('./config');
const tokenStore = require('./tokenStore');

const APP_TOKEN_KEY = 'application_token';
const USER_TOKEN_KEY = 'user_token';

// Refresh this many seconds before actual expiry so a request never races an expiring token.
const EXPIRY_SAFETY_MARGIN_SECONDS = 60;

function basicAuthHeader() {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  return `Basic ${credentials}`;
}

async function postToken(params) {
  const body = new URLSearchParams(params);
  try {
    const res = await axios.post(config.tokenEndpoint, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuthHeader(),
      },
    });
    return res.data;
  } catch (err) {
    if (err.response) {
      const detail = JSON.stringify(err.response.data);
      throw new Error(`eBay token request failed (${err.response.status}): ${detail}`);
    }
    throw err;
  }
}

function isExpired(record) {
  if (!record || !record.obtained_at || !record.expires_in) return true;
  const expiresAtMs = record.obtained_at + (record.expires_in - EXPIRY_SAFETY_MARGIN_SECONDS) * 1000;
  return Date.now() >= expiresAtMs;
}

/**
 * Application-level token (client credentials grant). No user involved —
 * used for public read APIs like Browse, Taxonomy, Catalog.
 */
async function getApplicationToken() {
  const cached = tokenStore.get(APP_TOKEN_KEY);
  if (!isExpired(cached)) {
    return cached.access_token;
  }

  const data = await postToken({
    grant_type: 'client_credentials',
    scope: config.scopes.join(' '),
  });

  tokenStore.set(APP_TOKEN_KEY, {
    access_token: data.access_token,
    expires_in: data.expires_in,
    obtained_at: Date.now(),
  });

  return data.access_token;
}

/**
 * Builds the URL to send a user to for the 3-legged consent flow.
 * `state` is passed through to the callback — use it to prevent CSRF and/or
 * to correlate the callback with the request that started it.
 */
function getAuthorizeUrl(state) {
  if (!config.ruName) {
    throw new Error('EBAY_RU_NAME is not set. Register a RuName in the Developer Portal under Application Keys -> User Tokens.');
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.ruName,
    response_type: 'code',
    scope: config.userScopes.join(' '),
  });
  if (state) params.set('state', state);
  return `${config.authorizeEndpoint}?${params.toString()}`;
}

/**
 * Exchanges the `code` eBay redirected back with for an access + refresh token pair.
 */
async function exchangeCodeForToken(code) {
  if (!config.ruName) {
    throw new Error('EBAY_RU_NAME is not set. Register a RuName in the Developer Portal under Application Keys -> User Tokens.');
  }
  const data = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.ruName,
  });

  const record = {
    access_token: data.access_token,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token,
    refresh_token_expires_in: data.refresh_token_expires_in,
    obtained_at: Date.now(),
  };
  tokenStore.set(USER_TOKEN_KEY, record);
  return record;
}

/**
 * Uses a stored refresh token to mint a new access token. eBay refresh tokens
 * are long-lived (~18 months) and are not themselves rotated on refresh.
 */
async function refreshUserToken() {
  const existing = tokenStore.get(USER_TOKEN_KEY);
  if (!existing || !existing.refresh_token) {
    throw new Error('No refresh token on file. Complete the /auth/ebay/login flow first.');
  }

  const data = await postToken({
    grant_type: 'refresh_token',
    refresh_token: existing.refresh_token,
    scope: config.userScopes.join(' '),
  });

  const record = {
    ...existing,
    access_token: data.access_token,
    expires_in: data.expires_in,
    obtained_at: Date.now(),
  };
  tokenStore.set(USER_TOKEN_KEY, record);
  return record;
}

/**
 * Returns a valid user access token, refreshing automatically if the cached
 * one is expired or close to expiring. Throws if no user has ever authorized.
 */
async function getUserAccessToken() {
  const cached = tokenStore.get(USER_TOKEN_KEY);
  if (!cached) {
    throw new Error('No user token on file. Complete the /auth/ebay/login flow first.');
  }
  if (!isExpired(cached)) {
    return cached.access_token;
  }
  const refreshed = await refreshUserToken();
  return refreshed.access_token;
}

function getUserTokenStatus() {
  const record = tokenStore.get(USER_TOKEN_KEY);
  if (!record) return { authorized: false };
  return {
    authorized: true,
    expired: isExpired(record),
    expires_at: new Date(record.obtained_at + record.expires_in * 1000).toISOString(),
    has_refresh_token: Boolean(record.refresh_token),
  };
}

module.exports = {
  getApplicationToken,
  getAuthorizeUrl,
  exchangeCodeForToken,
  refreshUserToken,
  getUserAccessToken,
  getUserTokenStatus,
};
