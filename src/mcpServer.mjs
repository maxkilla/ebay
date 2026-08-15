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

import ebayAuthModule from './ebayAuthClient.js';
import apiClientModule from './apiClient.js';
import configModule from './config.js';

import { registerAuthTools } from './tools/auth.mjs';
import { registerPricingTools } from './tools/pricing.mjs';
import { registerSellingTools } from './tools/selling.mjs';
import { registerOrderTools } from './tools/orders.mjs';
import { registerGenericTools } from './tools/generic.mjs';

const ebayAuth = ebayAuthModule;
const { ebayRequest } = apiClientModule;
const config = configModule;

const server = new McpServer({ name: 'ebay-oauth', version: '1.1.0' });

registerAuthTools(server, { ebayAuth, config });
registerPricingTools(server, { ebayRequest });
registerSellingTools(server, { ebayRequest });
registerOrderTools(server, { ebayRequest });
registerGenericTools(server, { ebayRequest });

const transport = new StdioServerTransport();
await server.connect(transport);
