import { z } from 'zod';
import { toolResult, safeCall } from './util.mjs';

// The eBay Sell flow, end to end, is: business policies + inventory location
// exist up front (one-time account setup) -> create/update an inventory item
// (the product) -> create an offer (price + policies + location, tied to a
// SKU) -> publish the offer (goes live, returns a listingId). These tools
// mirror that pipeline one step at a time so an agent can inspect state
// between steps instead of one opaque mega-call.

export function registerSellingTools(server, { ebayRequest }) {
  server.registerTool(
    'ebay_get_business_policies',
    {
      title: 'Get seller business policies',
      description:
        "Fetch the seller's fulfillment (shipping), payment, and return policies. Required before ebay_create_offer — every offer must reference one policy ID of each type. If this returns empty arrays, the seller needs to opt into Business Policies and create at least one of each in Seller Hub first.",
      inputSchema: {
        marketplace: z.string().optional().describe('eBay marketplace ID, default EBAY_US'),
      },
    },
    ({ marketplace }) => safeCall(async () => {
      const marketplace_id = marketplace || 'EBAY_US';
      const [fulfillment, payment, ret] = await Promise.all([
        ebayRequest({ path: '/sell/account/v1/fulfillment_policy', query: { marketplace_id }, useUserToken: true }),
        ebayRequest({ path: '/sell/account/v1/payment_policy', query: { marketplace_id }, useUserToken: true }),
        ebayRequest({ path: '/sell/account/v1/return_policy', query: { marketplace_id }, useUserToken: true }),
      ]);
      for (const r of [fulfillment, payment, ret]) {
        if (r.status >= 400) throw new Error(JSON.stringify(r.data));
      }
      return {
        fulfillmentPolicies: (fulfillment.data.fulfillmentPolicies || []).map((p) => ({ id: p.fulfillmentPolicyId, name: p.name })),
        paymentPolicies: (payment.data.paymentPolicies || []).map((p) => ({ id: p.paymentPolicyId, name: p.name })),
        returnPolicies: (ret.data.returnPolicies || []).map((p) => ({ id: p.returnPolicyId, name: p.name })),
      };
    }),
  );

  server.registerTool(
    'ebay_get_inventory_locations',
    {
      title: 'Get seller inventory locations',
      description: 'List the merchant inventory locations (warehouses/ship-from addresses) on the seller account. Required before ebay_create_offer — every offer needs a merchantLocationKey. If empty, one must be created in Seller Hub or via the Inventory API first.',
      inputSchema: {},
    },
    () => safeCall(async () => {
      const result = await ebayRequest({ path: '/sell/inventory/v1/location', useUserToken: true });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );

  server.registerTool(
    'ebay_upsert_inventory_item',
    {
      title: 'Create or update an inventory item',
      description: 'Create a new SKU or update an existing one with product details (title, description, images, condition, quantity). This is step 1 of listing an item for sale — it does not make anything live yet, that happens in ebay_create_offer + ebay_publish_offer.',
      inputSchema: {
        sku: z.string().describe('Your own unique identifier for this product, e.g. "CARD-001"'),
        title: z.string().max(80).describe('Listing title, max 80 characters'),
        description: z.string().optional().describe('Full listing description (plain text or simple HTML)'),
        imageUrls: z.array(z.string()).min(1).describe('Publicly reachable image URLs, first one is the primary photo'),
        condition: z.string().describe('e.g. NEW, LIKE_NEW, USED_EXCELLENT, USED_VERY_GOOD, USED_GOOD, USED_ACCEPTABLE, FOR_PARTS_OR_NOT_WORKING'),
        quantity: z.number().int().min(0).describe('How many units are available'),
        aspects: z.record(z.string(), z.array(z.string())).optional().describe('Item specifics, e.g. { "Brand": ["Sony"], "Color": ["Black"] }'),
      },
    },
    ({ sku, title, description, imageUrls, condition, quantity, aspects }) => safeCall(async () => {
      const body = {
        availability: { shipToLocationAvailability: { quantity } },
        condition,
        product: {
          title,
          ...(description ? { description } : {}),
          imageUrls,
          ...(aspects ? { aspects } : {}),
        },
      };
      const result = await ebayRequest({ method: 'PUT', path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, body, useUserToken: true });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return { sku, status: result.status, ...result.data };
    }),
  );

  server.registerTool(
    'ebay_get_inventory_item',
    {
      title: 'Get one inventory item',
      description: 'Fetch the current stored details for one SKU.',
      inputSchema: { sku: z.string() },
    },
    ({ sku }) => safeCall(async () => {
      const result = await ebayRequest({ path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, useUserToken: true });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );

  server.registerTool(
    'ebay_list_inventory_items',
    {
      title: 'List inventory items',
      description: "List SKUs on the seller's account.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('Default 25'),
        offset: z.number().int().min(0).optional(),
      },
    },
    ({ limit, offset }) => safeCall(async () => {
      const result = await ebayRequest({ path: '/sell/inventory/v1/inventory_item', query: { limit: limit || 25, offset: offset || 0 }, useUserToken: true });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );

  server.registerTool(
    'ebay_create_offer',
    {
      title: 'Create an offer for a SKU',
      description: 'Create a draft listing (an "offer") tied to an existing SKU — sets price, category, and business policies. Does NOT go live yet; call ebay_publish_offer with the returned offerId to actually list it. Get policy IDs from ebay_get_business_policies and the location key from ebay_get_inventory_locations first.',
      inputSchema: {
        sku: z.string().describe('SKU created via ebay_upsert_inventory_item'),
        categoryId: z.string().describe('eBay category ID for this item — use ebay_api_request against /commerce/taxonomy/v1/category_tree/{tree_id} to look one up if unknown'),
        price: z.number().positive().describe('Listing price, e.g. 19.99'),
        currency: z.string().optional().describe('Default USD'),
        quantity: z.number().int().min(1).optional().describe('Defaults to the inventory item\'s available quantity if omitted'),
        description: z.string().optional().describe('Listing description shown to buyers; falls back to the inventory item\'s description if omitted'),
        fulfillmentPolicyId: z.string(),
        paymentPolicyId: z.string(),
        returnPolicyId: z.string(),
        merchantLocationKey: z.string(),
        marketplace: z.string().optional().describe('Default EBAY_US'),
      },
    },
    ({ sku, categoryId, price, currency, quantity, description, fulfillmentPolicyId, paymentPolicyId, returnPolicyId, merchantLocationKey, marketplace }) => safeCall(async () => {
      const body = {
        sku,
        marketplaceId: marketplace || 'EBAY_US',
        format: 'FIXED_PRICE',
        categoryId,
        ...(description ? { listingDescription: description } : {}),
        ...(quantity ? { availableQuantity: quantity } : {}),
        pricingSummary: { price: { value: String(price), currency: currency || 'USD' } },
        listingPolicies: { fulfillmentPolicyId, paymentPolicyId, returnPolicyId },
        merchantLocationKey,
      };
      const result = await ebayRequest({ method: 'POST', path: '/sell/inventory/v1/offer', body, useUserToken: true });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );

  server.registerTool(
    'ebay_list_offers',
    {
      title: 'List offers',
      description: 'List offers, optionally filtered to one SKU. Each offer shows its status (published/unpublished) and offerId.',
      inputSchema: {
        sku: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    ({ sku, limit }) => safeCall(async () => {
      const query = { limit: limit || 25 };
      if (sku) query.sku = sku;
      const result = await ebayRequest({ path: '/sell/inventory/v1/offer', query, useUserToken: true });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );

  server.registerTool(
    'ebay_publish_offer',
    {
      title: 'Publish an offer (go live)',
      description: 'Publish a draft offer, making it a live eBay listing. Returns a listingId on success. This is the final step of the sell pipeline.',
      inputSchema: { offerId: z.string() },
    },
    ({ offerId }) => safeCall(async () => {
      const result = await ebayRequest({ method: 'POST', path: `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, useUserToken: true });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );

  server.registerTool(
    'ebay_end_listing',
    {
      title: 'End a live listing',
      description: 'Withdraw a published offer, ending the live eBay listing. The offer and inventory item still exist and can be republished later with ebay_publish_offer.',
      inputSchema: { offerId: z.string() },
    },
    ({ offerId }) => safeCall(async () => {
      const result = await ebayRequest({ method: 'POST', path: `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`, useUserToken: true });
      if (result.status >= 400) throw new Error(JSON.stringify(result.data));
      return result.data;
    }),
  );
}
