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

`src/mcpServer.mjs` exposes this whole integration as MCP tools, so any MCP-compatible agent (Claude Code, Claude Desktop, etc.) can call eBay APIs directly without knowing anything about OAuth mechanics. Tools are organized by workflow in `src/tools/`.

**If you're an agent working in this repo, read `.claude/skills/ebay-oauth-api/SKILL.md`** — it's the operational playbook for driving these tools correctly (what order to call them in, what to do when login is needed, what to do when selling fails because business policies aren't set up, etc). This section of the README is the reference table; the skill is the how-to.

**Auth** (`src/tools/auth.mjs`)
| Tool | Purpose |
|---|---|
| `ebay_auth_status` | Check whether a seller has completed login, and which environment is active. Call this first. |
| `ebay_login_url` | Get a consent URL. The agent hands this to a human — eBay requires interactive login, an agent can't complete it alone. |
| `ebay_refresh_user_token` | Force a token refresh (rarely needed — happens automatically). |

**Price checking** (`src/tools/pricing.mjs`) — no login required, uses the application token
| Tool | Purpose |
|---|---|
| `ebay_price_check` | The fast path: search a query and get back min/max/avg/median asking price plus sample listings. Use this for "what's X worth on eBay". |
| `ebay_search_items` | Raw Browse API search when you need more than price stats. |
| `ebay_get_item` | Full detail (specifics, seller, images) for one item by ID. |

**Selling** (`src/tools/selling.mjs`) — requires `ebay_login_url` completed first. Mirrors eBay's real listing pipeline: policies/location exist once → inventory item (the product) → offer (price + policies, draft) → publish (goes live).
| Tool | Purpose |
|---|---|
| `ebay_get_business_policies` | Fetch fulfillment/payment/return policy IDs — required inputs for `ebay_create_offer`. |
| `ebay_get_inventory_locations` | Fetch merchant location keys — also required for `ebay_create_offer`. |
| `ebay_upsert_inventory_item` | Create/update a SKU's product data (title, images, condition, quantity). |
| `ebay_get_inventory_item` / `ebay_list_inventory_items` | Inspect existing SKUs. |
| `ebay_create_offer` | Create a draft listing (price + category + policies) tied to a SKU. Not live yet. |
| `ebay_list_offers` | Check offer status / find an offerId. |
| `ebay_publish_offer` | Go live — returns a listingId. |
| `ebay_end_listing` | Withdraw a published offer. |

**Orders** (`src/tools/orders.mjs`) — requires login, for handling sales after they happen
| Tool | Purpose |
|---|---|
| `ebay_get_orders` / `ebay_get_order` | List/inspect orders. |
| `ebay_ship_order` | Mark a line item shipped with a tracking number, fulfilling the order. |

**Escape hatch** (`src/tools/generic.mjs`)
| Tool | Purpose |
|---|---|
| `ebay_api_request` | Authenticated call to any eBay REST path not covered above (Taxonomy, Marketing, etc). |

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

### Running it remotely — accessing it from anywhere

The stdio server above only works for a client running on the same machine (it's spawned as a local subprocess). To call these tools from other devices — your laptop, a phone client, a second server — deploy `src/mcpHttpServer.mjs` instead. Same 19 tools, same underlying code, reachable over HTTP with a required bearer token.

```bash
# Generate a strong random token — do this once per deployment, don't reuse the same one everywhere
openssl rand -hex 32
```

Set in `.env` on the server:

```
MCP_AUTH_TOKEN=<the token you generated>
MCP_HTTP_PORT=3100
MCP_HTTP_HOST=0.0.0.0
MCP_ALLOWED_HOSTS=mcp.yourdomain.com   # your real domain once you have one; blank is fine while testing
```

```bash
npm run mcp:http
```

The server **refuses to start** without `MCP_AUTH_TOKEN` set to at least 20 characters — there's no unauthenticated fallback, because anyone who reaches this endpoint can list/sell/ship on your eBay account through it. Every request to `POST /mcp` must carry `Authorization: Bearer <token>`; `GET /health` is the only open route, and it exposes nothing beyond a liveness check.

**Put this behind HTTPS before exposing it beyond localhost.** The bearer token travels as a plain header — over plain HTTP it's readable by anyone on the network path. Terminate TLS in front of it with a reverse proxy (Caddy or nginx with Let's Encrypt are the easiest) or your host's built-in HTTPS (Fly.io, Render, a platform load balancer, etc. all do this for you). Don't run `mcp:http` directly on the public internet over plain `http://`.

Client-side config points at the URL instead of a local command:

```json
{
  "mcpServers": {
    "ebay-oauth": {
      "url": "https://mcp.yourdomain.com/mcp",
      "headers": { "Authorization": "Bearer <the same token>" }
    }
  }
}
```

The exact config shape depends on your MCP client — some (like Claude Code's `.mcp.json`) support a `url` + `headers` remote server entry directly; others need a local stdio-to-HTTP bridge. Check your client's docs for "remote MCP server" or "HTTP MCP server" support.

It's stateless (`sessionIdGenerator: undefined`) — each call is independent, nothing about a session is kept server-side between requests — so it scales horizontally and there's no session affinity to worry about behind a load balancer.

## Token storage

Tokens are cached in a local JSON file (`TOKEN_STORE_PATH`, default `.data/tokens.json`), gitignored, mode `0600`. This is intentionally simple for dev/testing. For production with multiple instances, swap `src/tokenStore.js` for a shared store (Redis, a DB table) — it's a 4-function interface (`get`/`set`), trivial to replace.

## Security notes

- `.env` and `.data/` are gitignored — real credentials and tokens never get committed.
- The Cert ID (client secret) is only ever sent as an HTTP Basic-auth header directly to `https://api[.sandbox].ebay.com/identity/v1/oauth2/token` — never logged, never sent anywhere else.
- If credentials are ever pasted in plaintext somewhere they shouldn't be (chat, a ticket, a shared doc), rotate the Cert ID in the Developer Portal — old one keeps working until you do.
- The `/auth/ebay/login` → `/auth/ebay/callback` flow uses a `state` param persisted to the token file (15-minute TTL) to prevent CSRF and to let the MCP server and HTTP server agree on legitimacy across processes. Swap for a shared store (Redis, DB) if you run multiple server instances behind a load balancer.
- `mcpHttpServer.mjs` compares the bearer token with `crypto.timingSafeEqual` and refuses to start without one — treat that token like a password to your eBay account (it can drive every tool, including publishing listings and shipping orders). Rotate it by changing `MCP_AUTH_TOKEN` and restarting; there's no revocation list since there's only ever one valid token at a time.

## Testing without a public HTTPS endpoint

For the client-credentials flow (`/api/demo/search`), nothing external is needed beyond outbound HTTPS to eBay.

For the 3-legged flow, eBay needs to reach your callback via the RuName's registered Auth Accepted URL. For local testing:
- Use a tunnel (ngrok, cloudflared) and register that HTTPS URL as your Auth Accepted URL, or
- Deploy this app somewhere reachable and set `EBAY_RU_NAME` / `PUBLIC_BASE_URL` accordingly.
