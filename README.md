# eBay OAuth 2.0 Integration

Node.js/Express implementation of eBay's OAuth 2.0 flows:

- **Client Credentials grant** — application-level token, no user involved. Used for public read APIs (Browse, Taxonomy, Catalog, Marketing insights, etc).
- **Authorization Code grant (3-legged)** — full user consent flow with a redirect callback, for APIs that act on behalf of a seller (Inventory, Fulfillment, Account, Marketing on the Sell side).
- **Refresh token handling** — access tokens (both kinds) are cached to disk with their expiry and auto-refreshed a minute before they'd actually expire.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your values
npm start
```

Required env vars (see `.env.example` for the full list):

| Var | Notes |
|---|---|
| `EBAY_ENV` | `sandbox` or `production`. Picks the right base URLs automatically. |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | From developer.ebay.com → Application Keys. |
| `EBAY_RU_NAME` | Only needed for the 3-legged flow — see below. |
| `EBAY_SCOPES` | Space-separated, used for the app token. |
| `EBAY_USER_SCOPES` | Space-separated, used for the user consent + refresh flow. |

## The RuName gotcha (this is usually where people get stuck)

eBay's `redirect_uri` parameter for the 3-legged flow is **not a literal URL**. It's a "RuName" — a name you register in the Developer Portal (Application Keys → User Tokens → "Get a Token from eBay via Your Application") that eBay maps server-side to your actual HTTPS callback URL.

Steps:
1. In the Developer Portal, set your **Auth Accepted URL** to your real callback, e.g. `https://your-domain.com/auth/ebay/callback` (must be HTTPS in production; sandbox allows more flexibility, but still not bare `localhost` without a tunnel in some cases — use ngrok/similar if testing locally against sandbox).
2. eBay gives you a RuName string like `Your_Company-YourApp-SBX-abc123-45678901`. Put that literal string in `EBAY_RU_NAME` — not your callback URL.
3. Your app's `redirect_uri` param in both the authorize request and the token exchange must be that RuName, always. This code does that for you (`ebayAuthClient.js`).

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | Liveness check. |
| `GET /auth/ebay/login` | Redirects the user to eBay's consent screen. |
| `GET /auth/ebay/callback` | eBay redirects here (via your RuName) with `?code=`. Exchanges it for tokens and stores them. |
| `GET /auth/ebay/status` | Shows whether a user token is on file and its expiry. |
| `POST /auth/ebay/refresh` | Force a refresh using the stored refresh token. |
| `GET /api/demo/search?q=` | Proves the **application** token works — public Browse API search. |
| `GET /api/demo/privileges` | Proves the **user** token works — Sell Account API, requires `/auth/ebay/login` completed first. |

## Using it as an MCP server (agent-friendly interface)

`src/mcpServer.mjs` exposes this whole integration as MCP tools, so any MCP-compatible agent (Claude Code, Claude Desktop, etc.) can call eBay APIs directly without knowing anything about OAuth mechanics:

| Tool | Purpose |
|---|---|
| `ebay_auth_status` | Check whether a seller has completed login, and which environment is active. Call this first. |
| `ebay_login_url` | Get a consent URL. The agent hands this to a human — eBay requires interactive login, an agent can't complete it alone. |
| `ebay_refresh_user_token` | Force a token refresh (rarely needed — happens automatically). |
| `ebay_search_items` | Convenience wrapper over Browse API search — no login required. |
| `ebay_api_request` | Generic authenticated call to **any** eBay REST path (Sell Inventory, Fulfillment, Account, Taxonomy, etc). Auth is handled internally based on `useUserToken`. |

Run it:

```bash
npm run mcp
```

Add it to an MCP client config (e.g. Claude Desktop's `claude_desktop_config.json`, or a Claude Code `.mcp.json`):

```json
{
  "mcpServers": {
    "ebay-oauth": {
      "command": "node",
      "args": ["/absolute/path/to/this/repo/src/mcpServer.mjs"],
      "env": { "EBAY_ENV": "sandbox" }
    }
  }
}
```

Two things to know:
- The MCP server and the HTTP server (`npm start`) share state through the same token file (`TOKEN_STORE_PATH`) — run both from the same repo checkout. The HTTP server must be **running** at the moment a human completes the consent screen, because eBay's redirect lands on its `/auth/ebay/callback` route. The MCP server only needs to be running to make tool calls (including generating the login URL).
- `ebay_api_request` with `useUserToken:true` requires `ebay_login_url` to have been completed first — it'll throw a clear "no refresh token on file" error otherwise, which an agent can surface and act on (e.g. by calling `ebay_login_url` and asking a human to approve).

## Token storage

Tokens are cached in a local JSON file (`TOKEN_STORE_PATH`, default `.data/tokens.json`), gitignored, mode `0600`. This is intentionally simple for dev/testing. For production with multiple instances, swap `src/tokenStore.js` for a shared store (Redis, a DB table) — it's a 4-function interface (`get`/`set`), trivial to replace.

## Security notes

- `.env` and `.data/` are gitignored — real credentials and tokens never get committed.
- The Cert ID (client secret) is only ever sent as an HTTP Basic-auth header directly to `https://api[.sandbox].ebay.com/identity/v1/oauth2/token` — never logged, never sent anywhere else.
- If credentials are ever pasted in plaintext somewhere they shouldn't be (chat, a ticket, a shared doc), rotate the Cert ID in the Developer Portal — old one keeps working until you do.
- The `/auth/ebay/login` → `/auth/ebay/callback` flow uses a `state` param persisted to the token file (15-minute TTL) to prevent CSRF and to let the MCP server and HTTP server agree on legitimacy across processes. Swap for a shared store (Redis, DB) if you run multiple server instances behind a load balancer.

## Testing without a public HTTPS endpoint

For the client-credentials flow (`/api/demo/search`), nothing external is needed beyond outbound HTTPS to eBay.

For the 3-legged flow, eBay needs to reach your callback via the RuName's registered Auth Accepted URL. For local testing:
- Use a tunnel (ngrok, cloudflared) and register that HTTPS URL as your Auth Accepted URL, or
- Deploy this app somewhere reachable and set `EBAY_RU_NAME` / `PUBLIC_BASE_URL` accordingly.
