import { z } from 'zod';
import { toolResult, safeCall } from './util.mjs';

export function registerOrderTools(server, { ebayRequest }) {
  server.registerTool(
    'ebay_get_orders',
    {
      title: 'List orders',
      description: "List the seller's orders, optionally filtered by fulfillment status.",
      inputSchema: {
        fulfillmentStatus: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'FULFILLED']).optional().describe('Omit to get all orders regardless of status'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 25'),
      },
    },
    ({ fulfillmentStatus, limit }) => safeCall(async () => {
      const query = { limit: limit || 25 };
      if (fulfillmentStatus) query.filter = `orderfulfillmentstatus:{${fulfillmentStatus}}`;
      const result = await ebayRequest({ path: '/sell/fulfillment/v1/order', query, useUserToken: true });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );

  server.registerTool(
    'ebay_get_order',
    {
      title: 'Get one order',
      description: 'Fetch full details for one order by orderId, including line items (needed to fulfill/ship it).',
      inputSchema: { orderId: z.string() },
    },
    ({ orderId }) => safeCall(async () => {
      const result = await ebayRequest({ path: `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`, useUserToken: true });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );

  server.registerTool(
    'ebay_ship_order',
    {
      title: 'Mark an order line item as shipped',
      description: 'Create a shipping fulfillment for an order, marking its line item(s) as shipped with a tracking number. Get lineItemId values from ebay_get_order first.',
      inputSchema: {
        orderId: z.string(),
        lineItemId: z.string().describe('From the order\'s lineItems[].lineItemId'),
        quantity: z.number().int().min(1).describe('How many units of this line item are in this shipment'),
        trackingNumber: z.string(),
        carrierCode: z.string().describe('eBay shipping carrier code, e.g. USPS, UPS, FEDEX, DHL'),
        shippedDate: z.string().optional().describe('ISO 8601 timestamp, defaults to now'),
      },
    },
    ({ orderId, lineItemId, quantity, trackingNumber, carrierCode, shippedDate }) => safeCall(async () => {
      const body = {
        lineItems: [{ lineItemId, quantity }],
        shippedDate: shippedDate || new Date().toISOString(),
        shippingCarrierCode: carrierCode,
        trackingNumber,
      };
      const result = await ebayRequest({ method: 'POST', path: `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`, body, useUserToken: true });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );
}
