# Connecting an MCP Client to PI Planner

The PI Planner MCP server lets AI assistants read and modify your planning data. Two connection methods are available depending on the client.

---

## Prerequisites

1. You need a PI Planner account with **editor or admin role** — reader accounts cannot use the MCP server.
2. Generate an API key: log in → **Settings → API Keys** → create a key and copy it. Keep it safe; you only see it once.

---

## Claude.ai (and ChatGPT)

These clients connect via **OAuth**. The server handles authentication — you just paste your API key in the consent form.

1. Open **Settings → Integrations → MCP Servers** (or the equivalent in your client).
2. Add a new server and enter the MCP server URL:
   ```
   https://mcp.example.com
   ```
3. The client redirects you to a PI Planner consent page.
4. **Check the consent page before entering anything**: it shows the requesting application's name and the URL you'll be redirected back to after authorizing. Make sure both match the client you're actually trying to connect (e.g. `claude.ai`) — a mismatch is a sign the link may be malicious.
5. Paste your **API key** and click **Authorize**.
6. The client completes the OAuth flow and connects.

> **Note:** Replace `mcp.example.com` with your actual server hostname.

---

## Claude Code (CLI)

Claude Code sends the API key directly as a Bearer token — no OAuth flow needed.

Add the server to your project or global Claude Code configuration:

**Option A — project config** (`.claude/settings.json` in your project root):

```json
{
  "mcpServers": {
    "pi-planner": {
      "type": "http",
      "url": "https://mcp.example.com",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

**Option B — global config** (`~/.claude/settings.json`): same structure, available in all projects.

After saving, restart Claude Code. Run `/mcp` to confirm the `pi-planner` server is listed as connected.

---

## Verify the server is configured for OAuth

Before connecting Claude.ai, confirm OAuth is enabled on the server:

```bash
curl https://mcp.example.com/.well-known/oauth-authorization-server
```

Expected: a JSON object containing `issuer`, `authorization_endpoint`, `token_endpoint`, etc.

If you get a 404 or an empty response, OAuth is not enabled. Check:
1. `OAUTH_BASE_URL` is set in `mcp_server/.env` (not in the root docker-compose `.env`).
2. The MCP server container was restarted after the change: `docker compose restart mcp-server`
3. Logs confirm OAuth is active: `docker compose logs mcp-server | grep OAuth`

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No authorization popup appears | OAuth not enabled — check `OAUTH_BASE_URL` in `mcp_server/.env` and restart |
| No popup when reconnecting a client that worked before | The client cached a registration the server no longer has (e.g. after the OAuth token store was reset). In the client, **remove and re-add** the server so it re-registers. Operators: ensure `OAUTH_TOKEN_STORAGE` points at a persistent volume (the compose file uses `/data/oauth_tokens.json`). |
| Consent page shows "Invalid API key" | Wrong key, or key was deleted/expired |
| Consent page shows "Too many failed attempts" | Rate-limited after repeated invalid key submissions from your IP — wait about a minute and try again |
| "Reader accounts cannot authorize" | Your account has the reader role — ask an admin to upgrade it |
| Connection refused / server unreachable | Check that the MCP server container is running: `docker compose ps` |
| Claude Code shows auth error | Verify the `Authorization` header value starts with `Bearer ` (with a space) |
| Tools missing after connecting | Check that your API key's role matches the operation (admin keys can do everything; editor keys cannot manage users) |
