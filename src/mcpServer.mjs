#!/usr/bin/env node
// MCP server exposing this eBay OAuth integration as tools any MCP-compatible
// agent (Claude Code, Claude Desktop, etc.) can call directly. Talks over
// stdio, so it's launched as a subprocess by the agent's MCP client — see
// README.md for the client config snippet.
//
// This file is ESM (.mjs) because @modelcontextprotocol/sdk ships ESM-only;
// the rest of this project is CommonJS and is imported here via default import.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import ebayAuthModule from './ebayAuthClient.js';
import apiClientModule from './apiClient.js';
import configModule from './config.js';

const ebayAuth = ebayAuthModule;
const { ebayRequest } = apiClientModule;
const config = configModule;

const server = new McpServer({ name: 'ebay-oauth', version: '1.0.0' });

function json(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError };
}

server.registerTool(
  'ebay_auth_status',
  {
    title: 'eBay auth status',
    description:
      'Check eBay OAuth status: which environment (sandbox/production) is configured, and whether a seller has completed the 3-legged login. Call this first, before ebay_api_request with useUserToken, to know if login is needed.',
    inputSchema: {},
  },
  async () => json({ env: config.env, apiBaseUrl: config.apiBaseUrl, user: ebayAuth.getUserTokenStatus() }),
);

server.registerTool(
  'ebay_login_url',
  {
    title: 'Get eBay seller login URL',
    description:
      "Generate a URL for a human to open in a browser to authorize this app against their eBay seller account (3-legged OAuth). Only needed before calling ebay_api_request with useUserToken:true (Sell APIs — inventory, orders, account, marketing). The app's HTTP callback server (`npm start`, i.e. src/server.js) must already be running to complete the exchange once the human approves. After they approve, call ebay_auth_status to confirm it succeeded.",
    inputSchema: {},
  },
  async () => {
    const { url } = ebayAuth.beginUserAuthorization();
    return json({
      url,
      instructions:
        'Give this URL to a human — eBay requires interactive login and consent, an agent cannot complete this step alone. Once they approve, call ebay_auth_status to confirm.',
    });
  },
);

server.registerTool(
  'ebay_refresh_user_token',
  {
    title: 'Refresh eBay user token',
    description: 'Force-refresh the stored eBay seller access token using the saved refresh token. Usually unnecessary — ebay_api_request refreshes automatically when a user token has expired.',
    inputSchema: {},
  },
  async () => {
    try {
      const record = await ebayAuth.refreshUserToken();
      return json({ refreshed: true, expires_in: record.expires_in });
    } catch (err) {
      return json({ refreshed: false, error: err.message }, true);
    }
  },
);

server.registerTool(
  'ebay_search_items',
  {
    title: 'Search eBay listings',
    description: 'Search public eBay listings via the Browse API. No seller login required — uses the application (client-credentials) token.',
    inputSchema: {
      q: z.string().describe('Search keywords, e.g. "funko pop batman"'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results, default 5'),
      marketplace: z.string().optional().describe('eBay marketplace ID, default EBAY_US'),
    },
  },
  async ({ q, limit, marketplace }) => {
    const result = await ebayRequest({
      path: '/buy/browse/v1/item_summary/search',
      query: { q, limit: limit || 5 },
      marketplace: marketplace || 'EBAY_US',
    });
    return json(result.data, result.status >= 400);
  },
);

server.registerTool(
  'ebay_api_request',
  {
    title: 'Call any eBay REST API endpoint',
    description: `Make an authenticated request to any eBay REST API path, handling OAuth automatically. Use this for anything not covered by a dedicated tool.

Set useUserToken:true for Sell APIs acting on behalf of the authorized seller (requires ebay_login_url to have been completed first). Leave it false for public application-token APIs.

Common paths:
- GET /buy/browse/v1/item_summary/search?q=... (public search, useUserToken:false)
- GET /sell/inventory/v1/inventory_item (seller's inventory, useUserToken:true)
- PUT /sell/inventory/v1/inventory_item/{sku} (create/update a listing draft, useUserToken:true)
- GET /sell/fulfillment/v1/order (seller's orders, useUserToken:true)
- GET /sell/account/v1/privilege (seller account status, useUserToken:true)
- GET /commerce/taxonomy/v1/category_tree/{tree_id} (category taxonomy, useUserToken:false)

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
      return json(result, result.status >= 400);
    } catch (err) {
      return json({ error: err.message }, true);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
