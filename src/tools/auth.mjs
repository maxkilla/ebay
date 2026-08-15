import { z } from 'zod';
import { toolResult, safeCall } from './util.mjs';

export function registerAuthTools(server, { ebayAuth, config }) {
  server.registerTool(
    'ebay_auth_status',
    {
      title: 'eBay auth status',
      description:
        'Check eBay OAuth status: which environment (sandbox/production) is configured, and whether a seller has completed the 3-legged login. Call this first, before any selling or order tool, to know if login is needed.',
      inputSchema: {},
    },
    async () => toolResult({ env: config.env, apiBaseUrl: config.apiBaseUrl, user: ebayAuth.getUserTokenStatus() }),
  );

  server.registerTool(
    'ebay_login_url',
    {
      title: 'Get eBay seller login URL',
      description:
        "Generate a URL for a human to open in a browser to authorize this app against their eBay seller account (3-legged OAuth). Required before any selling or order tool will work. The app's HTTP callback server (`npm start`, i.e. src/server.js) must already be running to complete the exchange once the human approves. After they approve, call ebay_auth_status to confirm.",
      inputSchema: {},
    },
    async () => {
      const { url } = ebayAuth.beginUserAuthorization();
      return toolResult({
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
      description: 'Force-refresh the stored eBay seller access token using the saved refresh token. Usually unnecessary — every other tool refreshes automatically when the user token has expired.',
      inputSchema: {},
    },
    () => safeCall(async () => {
      const record = await ebayAuth.refreshUserToken();
      return { refreshed: true, expires_in: record.expires_in };
    }),
  );
}
