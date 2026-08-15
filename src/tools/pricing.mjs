import { z } from 'zod';
import { toolResult, safeCall } from './util.mjs';

function summarize(items) {
  const prices = items
    .map((i) => parseFloat(i.price && i.price.value))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (prices.length === 0) {
    return { count: 0, currency: null, min: null, max: null, avg: null, median: null };
  }

  const currency = items.find((i) => i.price && i.price.currency)?.price.currency || null;
  const sum = prices.reduce((a, b) => a + b, 0);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];

  return {
    count: prices.length,
    currency,
    min: prices[0],
    max: prices[prices.length - 1],
    avg: Math.round((sum / prices.length) * 100) / 100,
    median,
  };
}

export function registerPricingTools(server, { ebayRequest }) {
  server.registerTool(
    'ebay_search_items',
    {
      title: 'Search eBay listings',
      description: 'Search public eBay listings via the Browse API. No seller login required — uses the application (client-credentials) token. Returns raw listing summaries; use ebay_price_check instead if you just want market-rate stats.',
      inputSchema: {
        q: z.string().describe('Search keywords, e.g. "funko pop batman"'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results, default 10'),
        condition: z.string().optional().describe('e.g. "NEW", "USED" — filters via eBay condition IDs are not applied here, this is a free-text search filter passthrough'),
        marketplace: z.string().optional().describe('eBay marketplace ID, default EBAY_US'),
      },
    },
    ({ q, limit, marketplace }) => safeCall(async () => {
      const result = await ebayRequest({
        path: '/buy/browse/v1/item_summary/search',
        query: { q, limit: limit || 10 },
        marketplace: marketplace || 'EBAY_US',
      });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );

  server.registerTool(
    'ebay_price_check',
    {
      title: 'Check current eBay market price for an item',
      description:
        'Search current active eBay listings for a query and return price stats (min/max/avg/median) plus a handful of sample listings. This is the fast path for "what is X worth / selling for on eBay right now" — use it before manually calling ebay_search_items. Note: this reflects ASKING prices of active listings, not confirmed sold prices (eBay\'s sold-price API requires special account approval most developer keys do not have).',
      inputSchema: {
        q: z.string().describe('Search keywords describing the item, e.g. "PS5 disc console"'),
        condition: z.enum(['NEW', 'USED', 'ANY']).optional().describe('Rough condition filter, default ANY'),
        sampleSize: z.number().int().min(5).max(100).optional().describe('How many listings to sample for stats, default 30'),
        marketplace: z.string().optional().describe('eBay marketplace ID, default EBAY_US'),
      },
    },
    ({ q, condition, sampleSize, marketplace }) => safeCall(async () => {
      const query = { q, limit: sampleSize || 30 };
      if (condition && condition !== 'ANY') {
        query.filter = `conditionIds:{${condition === 'NEW' ? '1000' : '3000'}}`;
      }
      const result = await ebayRequest({
        path: '/buy/browse/v1/item_summary/search',
        query,
        marketplace: marketplace || 'EBAY_US',
      });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));

      const items = result.data.itemSummaries || [];
      const stats = summarize(items);
      const samples = items.slice(0, 8).map((i) => ({
        title: i.title,
        price: i.price,
        condition: i.condition,
        itemWebUrl: i.itemWebUrl,
        itemId: i.itemId,
      }));

      return { query: q, stats, samples };
    }),
  );

  server.registerTool(
    'ebay_get_item',
    {
      title: 'Get full eBay item details',
      description: 'Fetch full details (price, condition, seller, item specifics, images) for one item by its itemId, as returned by ebay_search_items or ebay_price_check.',
      inputSchema: {
        itemId: z.string().describe('eBay item ID, e.g. "v1|110569598002|0"'),
      },
    },
    ({ itemId }) => safeCall(async () => {
      const result = await ebayRequest({ path: `/buy/browse/v1/item/${encodeURIComponent(itemId)}` });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );
}
