---
name: ebay-oauth-api
description: Drive this repo's eBay OAuth integration and its MCP server (src/mcpServer.mjs) to check eBay prices, list items for sale, manage offers, and fulfill orders. Use this skill whenever the user wants to check what something is worth on eBay, list or sell an item on eBay, manage an eBay listing or offer, check eBay orders or ship something sold on eBay, or asks to set up / run / debug this repo's eBay OAuth or MCP server. Also trigger on mentions of "ebay_" tools (ebay_price_check, ebay_create_offer, ebay_publish_offer, etc.), RuName, eBay business policies, or eBay inventory items — even if the user doesn't say "skill" or name this file directly.
---

# eBay OAuth API — selling & price checking

This repo is a Node.js/Express app plus an MCP server (`src/mcpServer.mjs`) that wraps eBay's OAuth 2.0 flows and exposes 19 tools for two workflows: **checking prices** and **selling items** (including order fulfillment). Full architecture and env var reference lives in `README.md` at the repo root — this file is the operational playbook for actually driving it.

## One-time setup

```bash
npm install
cp .env.example .env   # fill in EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV
```

Two processes run side by side, and both need to be up for the full selling workflow:

- `npm start` — the HTTP server. Must be **running** at the moment a human completes eBay's login/consent screen, because eBay's OAuth redirect lands on its `/auth/ebay/callback` route. Not needed for price-checking (that only uses the app token).
- `npm run mcp` — the MCP server (stdio transport). This is what a local agent (e.g. Claude Desktop on the same machine) calls tools on. It shares state with the HTTP server through the same token file (`.data/tokens.json` by default), so both must be launched from the same checkout.
- `npm run mcp:http` — the same tools, reachable over HTTP with a required bearer token (`MCP_AUTH_TOKEN` in `.env`), for calling this from a different machine than the one it runs on. See the README's "Running it remotely" section before deploying this — it refuses to start without a real token, and needs HTTPS in front of it in production.

If selling or order tools will be used, one extra one-time step: register a **RuName** in the eBay Developer Portal (Application Keys → User Tokens → "Get a Token from eBay via Your Application") and set `EBAY_RU_NAME` in `.env`. eBay's `redirect_uri` for the login flow is this RuName string, not a literal URL — see the README's "RuName gotcha" section if login fails with a redirect-related error. Price-checking alone never needs this.

## Always start here: `ebay_auth_status`

Call it before doing anything else in a session. It reports the environment (sandbox/production) and whether a seller has completed login. Price-checking tools work regardless of its answer; every selling and order tool requires `authorized: true`.

If not authorized and the task needs selling/orders: call `ebay_login_url`, then **hand the returned URL to a human** — eBay requires interactive login and consent, there is no way for an agent to complete this step itself. After they confirm they've approved it, call `ebay_auth_status` again to verify before continuing.

## Workflow 1: Price checking

No login needed — these use the public application token.

1. **`ebay_price_check`** — the default choice for "what's X worth / selling for on eBay". Give it a search query; it returns min/max/avg/median asking price plus a handful of sample listings. Pass `condition: "NEW"` or `"USED"` to narrow it.
2. **`ebay_search_items`** — raw Browse API search when price stats alone aren't enough (e.g. the user wants to browse actual listings, not just a number).
3. **`ebay_get_item`** — full detail for one item (specifics, seller, images) given an `itemId` from either tool above.

Important caveat to pass along if the user is pricing something to sell: these numbers are **asking prices of active listings**, not confirmed sold prices. eBay's actual sold-price data (Marketplace Insights API) requires separate account approval most developer keys don't have. If the user needs true sold comps, say so explicitly rather than presenting asking-price stats as sold prices.

## Workflow 2: Selling

This mirrors eBay's real listing pipeline — walk through it in order, don't skip steps, since each one depends on IDs returned by the last:

1. **`ebay_get_business_policies`** and **`ebay_get_inventory_locations`** — one-time account lookups. Both must return at least one entry, or `ebay_create_offer` will fail later. If either comes back empty, tell the user: Business Policies need to be enabled and configured in Seller Hub (fulfillment/payment/return policies), and/or an inventory location needs to be created — the API can't bootstrap either of these from nothing, they're account-level setup only a human can do in Seller Hub (or via `ebay_api_request` `POST /sell/inventory/v1/location/{merchantLocationKey}` if the human gives you an address to use).
2. **`ebay_upsert_inventory_item`** — define the product itself: SKU, title, description, image URLs, condition, quantity. This alone does not list anything for sale.
3. **`ebay_create_offer`** — draft the listing: price, category, and the policy IDs + location key from step 1. Still not live. If the category ID is unknown, look it up via `ebay_api_request` against `/commerce/taxonomy/v1/category_tree/{tree_id}` (tree ID 0 is US) rather than guessing — eBay rejects offers with a wrong/missing category.
4. **`ebay_publish_offer`** — makes it live, returns a `listingId`. This is the point of no return for this pipeline; confirm price and details with the user before calling it if there's any doubt.
5. **`ebay_list_offers`** — check status or recover an `offerId` later.
6. **`ebay_end_listing`** — pull a live listing down. The offer and inventory item both survive this and can be republished later.

## Workflow 3: Order fulfillment (after something sells)

1. **`ebay_get_orders`** — pass `fulfillmentStatus: "NOT_STARTED"` to find what needs shipping.
2. **`ebay_get_order`** — get the full order, including `lineItems[].lineItemId`, needed for the next step.
3. **`ebay_ship_order`** — mark a line item shipped with a carrier code and tracking number, fulfilling the order.

## Escape hatch: `ebay_api_request`

For anything not covered above — Taxonomy lookups, Marketing APIs, editing an existing offer's fields directly, etc. Set `useUserToken: true` for anything acting on behalf of the seller (Sell APIs); leave it false for public application-token APIs (Browse, Taxonomy, Catalog).

## Troubleshooting

- **"No refresh token on file" / "No user token on file"** — not logged in yet. Run the `ebay_login_url` flow above.
- **`ebay_create_offer` fails with a policy or location error** — see step 1 of the selling workflow; the seller's account isn't set up for Business Policies yet, or has no inventory location.
- **Token requests fail with a 401/invalid_client** — `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` don't match `EBAY_ENV`. Sandbox keys only work against `EBAY_ENV=sandbox`, production keys only against `production` — check `.env`.
- **Login redirect fails / RuName errors** — `EBAY_RU_NAME` is unset, or is a callback URL instead of the actual RuName string eBay issued. See the README's RuName section.
- **Any tool returns a network/TLS error immediately** — check that the environment running `npm run mcp` actually has outbound HTTPS access to `api.ebay.com` / `api.sandbox.ebay.com`. Sandboxed or firewalled agent environments sometimes block this.

For env var details, the full tool list with input schemas, and the MCP client config snippet, see `README.md` at the repo root.
