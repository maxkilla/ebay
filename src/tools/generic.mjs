import { z } from 'zod';
import { toolResult, safeCall } from './util.mjs';

export function registerGenericTools(server, { ebayRequest }) {
  server.registerTool(
    'ebay_api_request',
    {
      title: 'Call any eBay REST API endpoint',
      description: `Escape hatch for anything not covered by a dedicated tool (pricing: ebay_search_items/ebay_price_check/ebay_get_item; selling: ebay_get_business_policies/ebay_get_inventory_locations/ebay_upsert_inventory_item/ebay_create_offer/ebay_publish_offer/ebay_end_listing; orders: ebay_get_orders/ebay_get_order/ebay_ship_order). Handles OAuth automatically.

Set useUserToken:true for Sell APIs acting on behalf of the authorized seller. Leave it false for public application-token APIs.

Full API reference: https://developer.ebay.com/docs`,
      inputSchema: {
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
        path: z.string().describe('Absolute API path, e.g. /sell/inventory/v1/inventory_item/{sku}'),
        query: z.record(z.string(), z.any()).optional().describe('Query string parameters'),
        body: z.any().optional().describe('JSON request body for POST/PUT/PATCH'),
        useUserToken: z.boolean().optional().describe('true = call as the authorized seller; false/omit = public application token'),
        marketplace: z.string().optional().describe('eBay marketplace ID, default EBAY_US'),
      },
    },
    async ({ method, path, query, body, useUserToken, marketplace }) => {
      try {
        const result = await ebayRequest({ method, path, query, body, useUserToken, marketplace: marketplace || 'EBAY_US' });
        return toolResult(result, result.status >= 400);
      } catch (err) {
        return toolResult({ error: err.message }, true);
      }
    },
  );
}
