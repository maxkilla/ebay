#!/usr/bin/env node
// HTTP variant of the MCP server (see src/mcpServer.mjs for the stdio
// version, used by local clients like Claude Desktop). This one is meant to
// run on a server you control and be reachable from anywhere — so unlike
// the stdio version, every request must carry a bearer token. There is no
// "no auth configured" fallback: an unauthenticated version of this would
// let anyone who finds the URL list, sell, and ship on your eBay account.
//
// Put this behind HTTPS (a reverse proxy like nginx/Caddy, or your host's
// built-in TLS) before exposing it publicly — the bearer token is sent as a
// plain header and is only as safe as the transport it rides on.

import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';

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

const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
if (!AUTH_TOKEN || AUTH_TOKEN.length < 20) {
  console.error('MCP_AUTH_TOKEN is missing or too short. Refusing to start an HTTP MCP server without real authentication.');
  console.error('Generate one with: openssl rand -hex 32');
  console.error('Then set MCP_AUTH_TOKEN in your .env.');
  process.exit(1);
}

const PORT = parseInt(process.env.MCP_HTTP_PORT || '3100', 10);
const HOST = process.env.MCP_HTTP_HOST || '0.0.0.0';
const ALLOWED_HOSTS = (process.env.MCP_ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);

function safeTokenEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token || !safeTokenEqual(token, AUTH_TOKEN)) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    return;
  }
  next();
}

function buildMcpServer() {
  const server = new McpServer({ name: 'ebay-oauth', version: '1.1.0' });
  registerAuthTools(server, { ebayAuth, config });
  registerPricingTools(server, { ebayRequest });
  registerSellingTools(server, { ebayRequest });
  registerOrderTools(server, { ebayRequest });
  registerGenericTools(server, { ebayRequest });
  return server;
}

const app = createMcpExpressApp({
  host: HOST,
  ...(ALLOWED_HOSTS.length ? { allowedHosts: ALLOWED_HOSTS } : {}),
});

// Stateless: each request gets a fresh McpServer + transport, no session
// state kept between calls. Simpler to run behind a load balancer and
// matches how most remote MCP clients (including Claude) call tools —
// one request in, one response out, no server-side session to lose.
app.post('/mcp', requireAuth, async (req, res) => {
  const mcpServer = buildMcpServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      mcpServer.close();
    });
  } catch (err) {
    console.error('Error handling MCP request:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

app.get('/mcp', requireAuth, (req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed — this server is stateless, no SSE stream to resume.' }, id: null });
});

app.delete('/mcp', requireAuth, (req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});

// Unauthenticated on purpose — a plain liveness probe, exposes nothing about eBay state.
app.get('/health', (req, res) => res.json({ ok: true, env: config.env }));

app.listen(PORT, HOST, () => {
  console.log(`eBay MCP HTTP server listening on ${HOST}:${PORT} [env=${config.env}]`);
  console.log(`  MCP endpoint: POST http://${HOST}:${PORT}/mcp  (Authorization: Bearer <token>)`);
  console.log(`  Health check: GET  http://${HOST}:${PORT}/health`);
  console.log('  Put this behind HTTPS before exposing it beyond localhost.');
});
