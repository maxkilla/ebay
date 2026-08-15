const axios = require('axios');
const config = require('./config');
const ebayAuth = require('./ebayAuthClient');

/**
 * Makes an authenticated call to any eBay REST API path.
 *
 * Set `useUserToken: true` for Sell APIs that act on behalf of the
 * authorized seller (inventory, fulfillment, account, marketing).
 * Leave it false/omit for public application-token APIs (Browse,
 * Taxonomy, Catalog, Marketplace Insights).
 *
 * Never throws on eBay error responses (4xx/5xx) — returns them as
 * { status, data } so callers (including agents) can see exactly what
 * eBay said instead of losing the error body to a caught exception.
 */
async function ebayRequest({ method = 'GET', path, query, body, useUserToken = false, marketplace = 'EBAY_US' }) {
  if (!path || !path.startsWith('/')) {
    throw new Error('path must be an absolute path starting with "/", e.g. /buy/browse/v1/item_summary/search');
  }

  const token = useUserToken ? await ebayAuth.getUserAccessToken() : await ebayAuth.getApplicationToken();

  const res = await axios({
    method,
    url: `${config.apiBaseUrl}${path}`,
    params: query,
    data: body,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
    },
    validateStatus: () => true,
  });

  return { status: res.status, data: res.data };
}

module.exports = { ebayRequest };
