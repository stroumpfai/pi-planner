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
4. Paste your **API key** and click **Authorize**.
5. The client completes the OAuth flow and connects.

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
      "url": "https://mcp.example.com/mcp",
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

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Consent page shows "Invalid API key" | Wrong key, or key was deleted/expired |
| "Reader accounts cannot authorize" | Your account has the reader role — ask an admin to upgrade it |
| Connection refused / server unreachable | Check that the MCP server container is running: `docker compose ps` |
| Claude Code shows auth error | Verify the `Authorization` header value starts with `Bearer ` (with a space) |
| Tools missing after connecting | Check that your API key's role matches the operation (admin keys can do everything; editor keys cannot manage users) |
