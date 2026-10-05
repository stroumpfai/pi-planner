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

## Allowed redirect hosts (`OAUTH_ALLOWED_REDIRECT_HOSTS`)

*For operators.* Since commit `94b261d` (after mcp-server 1.8.0), the MCP server only sends OAuth
authorization codes to hosts it trusts. A web-based client whose host isn't on the list can't
connect until you add it.

### What it means

At the end of the OAuth flow, the server sends the browser back to the client's
**redirect URI** with an authorization code, which the client exchanges for a token. Whoever
receives that code gets the user's access.

Any client can register itself with the server, choose any name, and give any redirect URI.
Without a restriction, an attacker could register a client called "Claude" whose redirect
URI is their own server, then send a user the authorize link. If the user pasted their API key
on the consent page, the code, and with it editor or admin access, would go to the attacker.
`OAUTH_ALLOWED_REDIRECT_HOSTS` limits where codes can go to clients you actually use.

### The rule

A redirect URI is **allowed** when it is:

| Kind | Example | Why it's safe |
|---|---|---|
| `https` to a listed host, or a subdomain of one | `https://claude.ai/api/mcp/auth_callback` | You chose to trust that host |
| `http` or `https` to loopback, any port | `http://127.0.0.1:6274/oauth/callback` | A local client (MCP inspector, desktop tools). The code never leaves the user's machine |
| An app scheme | `cursor://…`, `vscode://…` | Opens an app on the user's own machine |

Everything else is **refused**, including plain `http` to any remote host.

The setting lives in `mcp_server/.env`: a comma-separated list of host names, with no scheme,
port or path. Each entry also matches its subdomains, so `example.com` covers
`app.example.com`; it does not match look-alikes such as `example.com.evil.net`.

```bash
# Default
OAUTH_ALLOWED_REDIRECT_HOSTS=claude.ai,claude.com,chatgpt.com,openai.com
# Turn the check off (not recommended: re-opens the phishing route above)
OAUTH_ALLOWED_REDIRECT_HOSTS=*
```

### The effects

| Who | What happens |
|---|---|
| **Claude** (web, Desktop, mobile) **and ChatGPT** | Nothing. Claude's hosted apps redirect to `https://claude.ai/api/mcp/auth_callback`; Anthropic says this may move to `claude.com`, which is also listed. ChatGPT uses `https://chatgpt.com/connector_platform_oauth_redirect` or `https://chatgpt.com/connector/oauth/{id}`, depending on the server. All are on the default list |
| **Claude Code**, and other clients using an API key as a Bearer token | Nothing; they don't use OAuth |
| **Local and desktop clients** redirecting to loopback or an app scheme | Nothing |
| **A new web client on another host** | Registration is refused with HTTP 400 `invalid_redirect_uri`. The user never sees the consent page; the client shows its own "couldn't connect" message, which may or may not include the reason |
| **A web client on another host that connected before the upgrade** | Its current connection **keeps working**, because the check runs only when authorizing, not on each request. It breaks at its next authorization: when the grant reaches `OAUTH_GRANT_MAX_AGE` (90 days), when its API key is revoked or cycled, or when the user reconnects. The browser is then sent back to the client with `error=unauthorized_client` and no code, and the consent page never appears |

The delayed break in the last row is the one to watch for: a client can fail weeks after the
upgrade, with nothing else having changed.

### How to spot it

**1. In the logs.** Both refusals are logged at `WARNING`, which the default `LOG_LEVEL` shows.
The line includes the redirect URI, so it tells you which host to add:

```bash
docker compose logs mcp-server | grep -E "oauth_dcr_rejected reason=redirect_host|oauth_authorize_redirect_uri_not_allowed"
```

```text
oauth_dcr_rejected reason=redirect_host uri=https://app.example.net/oauth/callback
oauth_authorize_redirect_uri_not_allowed client=zzz999yy uri=https://app.example.net/oauth/callback
```

**2. Before it bites: audit the clients already registered.** This lists every stored client
that the current setting would refuse. Run it after upgrading, and again after you change the
setting:

```bash
docker compose exec -T mcp-server python - <<'EOF'
import json
from mcp_server.config import settings
from mcp_server.oauth_provider import _redirect_uri_allowed

clients = json.load(open(settings.oauth_token_storage)).get("clients", {})
for client_id, c in clients.items():
    blocked = [u for u in c.get("redirect_uris") or [] if not _redirect_uri_allowed(u)]
    if blocked:
        print(f"{c.get('client_name') or '(unnamed)'}  id={client_id[:12]}  blocked={blocked}")
print(f"checked {len(clients)} registered clients")
EOF
```

Any line other than the final count is a client that will fail at its next authorization.
Clients that identify themselves by a URL instead of registering aren't stored, so they don't
appear here; they show up only in the logs.

**3. From user reports.** "The MCP connection worked yesterday, and now reconnecting does
nothing or shows an error, and I never get the API key page." This is the pattern for a
pre-upgrade client reaching its next authorization.

### Fixing it

1. Check the host is genuinely the client you mean to use, not a look-alike. An unknown host
   that shows up only in rejections may be a phishing attempt the allowlist just stopped.
2. Add it to the list in `mcp_server/.env`, keeping the defaults:
   ```bash
   OAUTH_ALLOWED_REDIRECT_HOSTS=claude.ai,claude.com,chatgpt.com,openai.com,app.example.net
   ```
3. Recreate the container so it reads the new value. `docker compose restart` is not enough,
   because the setting comes from the compose `env_file`:
   ```bash
   docker compose up -d mcp-server
   ```
4. Run the audit snippet again (it should print only the count), and ask the user to
   reconnect. No re-registration is needed; the client's existing registration starts working
   again.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No authorization popup appears | OAuth not enabled — check `OAUTH_BASE_URL` in `mcp_server/.env` and restart |
| No popup when reconnecting a client that worked before | The client cached a registration the server no longer has (e.g. after the OAuth token store was reset). In the client, **remove and re-add** the server so it re-registers. Operators: ensure `OAUTH_TOKEN_STORAGE` points at a persistent volume (the compose file uses `/data/oauth_tokens.json`). |
| Connecting fails with `invalid_redirect_uri`, or a client that worked before now comes back with `error=unauthorized_client` and never shows the consent page | The client's redirect host isn't in `OAUTH_ALLOWED_REDIRECT_HOSTS`. See [Allowed redirect hosts](#allowed-redirect-hosts-oauth_allowed_redirect_hosts) |
| Connecting fails with HTTP 429 from `/register` | More than 10 client registrations from one address within an hour — wait, or check for a client stuck re-registering in a loop |
| Consent page shows "Invalid API key" | Wrong key, or key was deleted/expired |
| Consent page shows "Too many failed attempts" | Rate-limited after repeated invalid key submissions from your IP — wait about a minute and try again |
| "Reader accounts cannot authorize" | Your account has the reader role — ask an admin to upgrade it |
| Connection refused / server unreachable | Check that the MCP server container is running: `docker compose ps` |
| Claude Code shows auth error | Verify the `Authorization` header value starts with `Bearer ` (with a space) |
| Tools missing after connecting | Check that your API key's role matches the operation (admin keys can do everything; editor keys cannot manage users) |
