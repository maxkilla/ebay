require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name} (see .env.example)`);
  }
  return value;
}

const env = (process.env.EBAY_ENV || 'sandbox').toLowerCase();
if (env !== 'sandbox' && env !== 'production') {
  throw new Error(`EBAY_ENV must be "sandbox" or "production", got "${env}"`);
}

const isProduction = env === 'production';

const config = {
  env,
  isProduction,
  clientId: required('EBAY_CLIENT_ID'),
  clientSecret: required('EBAY_CLIENT_SECRET'),
  ruName: process.env.EBAY_RU_NAME || '',
  scopes: (process.env.EBAY_SCOPES || 'https://api.ebay.com/oauth/api_scope').split(/\s+/).filter(Boolean),
  userScopes: (process.env.EBAY_USER_SCOPES || process.env.EBAY_SCOPES || 'https://api.ebay.com/oauth/api_scope').split(/\s+/).filter(Boolean),
  port: parseInt(process.env.PORT || '3000', 10),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  tokenStorePath: process.env.TOKEN_STORE_PATH || '.data/tokens.json',

  // eBay base URLs differ between sandbox and production for both the
  // OAuth token endpoint and the user-consent (authorize) endpoint.
  apiBaseUrl: isProduction ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com',
  authorizeBaseUrl: isProduction ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com',
};

config.tokenEndpoint = `${config.apiBaseUrl}/identity/v1/oauth2/token`;
config.authorizeEndpoint = `${config.authorizeBaseUrl}/oauth2/authorize`;

module.exports = config;
