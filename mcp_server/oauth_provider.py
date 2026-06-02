"""OAuth 2.1 authorization server for PI Planner MCP.

Exposes a minimal consent page where users paste an existing PI Planner
API key. Issued access tokens carry the same claims (key_id, role) as
direct-Bearer tokens so call_backend() works transparently for both paths.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path

from fastmcp.server.auth.auth import AccessToken, ClientRegistrationOptions, OAuthProvider
from mcp.server.auth.handlers.metadata import ProtectedResourceMetadataHandler
from mcp.server.auth.provider import (
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    TokenError,
    construct_redirect_uri,
)
from mcp.server.auth.routes import cors_middleware
from mcp.server.auth.settings import RevocationOptions
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken, ProtectedResourceMetadata
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from mcp_server.auth import verify_api_key

log = logging.getLogger(__name__)

_AUTH_CODE_TTL = 300  # 5 minutes — auth codes and pending consent sessions


# ---------------------------------------------------------------------------
# Token store
# ---------------------------------------------------------------------------


class TokenStore:
    """Async-safe JSON file store for OAuth access tokens.

    Expired tokens are purged on load and on every get_token() call.
    The asyncio.Lock guards concurrent writes (multiple connections
    completing their OAuth dance simultaneously).
    """

    def __init__(self, path: str) -> None:
        self._path = Path(path)
        self._tokens: dict[str, dict] = {}
        self._lock = asyncio.Lock()
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text())
            now = time.time()
            self._tokens = {k: v for k, v in data.items() if v.get("expires_at", 0) > now}
        except Exception:
            self._tokens = {}

    def _write(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(self._tokens, indent=2))

    async def save_token(self, token: AccessToken) -> None:
        async with self._lock:
            self._tokens[token.token] = {
                "token": token.token,
                "client_id": token.client_id,
                "scopes": token.scopes,
                "claims": token.claims,
                "expires_at": token.expires_at,
            }
            self._write()

    def get_token(self, token: str) -> AccessToken | None:
        entry = self._tokens.get(token)
        if not entry:
            return None
        if (entry.get("expires_at") or 0) <= time.time():
            del self._tokens[token]
            return None
        return AccessToken(
            token=entry["token"],
            client_id=entry["client_id"],
            scopes=entry["scopes"],
            claims=entry.get("claims", {}),
            expires_at=entry["expires_at"],
        )

    async def delete_token(self, token: str) -> None:
        async with self._lock:
            if token in self._tokens:
                del self._tokens[token]
                self._write()


# ---------------------------------------------------------------------------
# Pending authorization session (before user submits the consent form)
# ---------------------------------------------------------------------------


@dataclass
class _PendingAuth:
    client: OAuthClientInformationFull
    params: AuthorizationParams
    expires_at: float


# ---------------------------------------------------------------------------
# OAuth provider
# ---------------------------------------------------------------------------


class PiPlannerOAuthProvider(OAuthProvider):
    """OAuth 2.1 authorization server backed by PI Planner API keys.

    Flow:
    1. Claude.ai discovers /.well-known/oauth-authorization-server
    2. Claude.ai registers as a client (Dynamic Client Registration)
    3. Claude.ai sends the user to GET /authorize?...
    4. SDK validates params, calls provider.authorize() which redirects to
       /authorize/consent?nonce=...
    5. User pastes their PI Planner API key and clicks Authorize
    6. POST /authorize/consent validates the key, issues an auth code,
       redirects back to Claude.ai's redirect_uri
    7. Claude.ai exchanges the auth code at /token for an access token
    8. Subsequent MCP calls present the access token as Bearer
    """

    def __init__(
        self,
        base_url: str,
        token_storage_path: str,
        token_ttl: int = 3600,
    ) -> None:
        super().__init__(
            base_url=base_url,
            client_registration_options=ClientRegistrationOptions(enabled=True),
            revocation_options=RevocationOptions(enabled=True),
        )
        self._clients: dict[str, OAuthClientInformationFull] = {}
        self._auth_codes: dict[str, AuthorizationCode] = {}
        # Parallel dict: code → (key_id, username, role) so exchange_authorization_code
        # can embed the API-key claims in the issued token without a second backend call.
        self._code_claims: dict[str, tuple[str, str, str]] = {}
        self._pending: dict[str, _PendingAuth] = {}
        self._store = TokenStore(token_storage_path)
        self._token_ttl = token_ttl
        self._base_url_str = str(base_url).rstrip("/")

    # ── OAuthAuthorizationServerProvider protocol ───────────────────────────

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        return self._clients.get(client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if client_info.client_id is None:
            raise ValueError("client_id is required for registration")
        self._clients[client_info.client_id] = client_info
        log.info(
            "oauth_dcr_registered client_id=%.8s name=%s",
            client_info.client_id,
            client_info.client_name or "(unnamed)",
        )

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """Store auth params under a short-lived nonce and redirect to consent page."""
        nonce = secrets.token_urlsafe(20)
        self._pending[nonce] = _PendingAuth(
            client=client,
            params=params,
            expires_at=time.time() + _AUTH_CODE_TTL,
        )
        log.info(
            "oauth_authorize_started client_id=%.8s redirect_uri=%s",
            client.client_id or "?",
            params.redirect_uri,
        )
        return f"{self._base_url_str}/authorize/consent?nonce={nonce}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        code_obj = self._auth_codes.get(authorization_code)
        if not code_obj:
            return None
        if code_obj.client_id != client.client_id:
            return None
        if code_obj.expires_at < time.time():
            self._auth_codes.pop(authorization_code, None)
            self._code_claims.pop(authorization_code, None)
            return None
        return code_obj

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        if authorization_code.code not in self._auth_codes:
            raise TokenError("invalid_grant", "Authorization code not found or already used.")

        del self._auth_codes[authorization_code.code]
        key_id, username, role = self._code_claims.pop(authorization_code.code, ("", "", ""))

        token_value = secrets.token_urlsafe(32)
        access_token = AccessToken(
            token=token_value,
            client_id=username,
            scopes=[role],
            claims={"key_id": key_id, "role": role},
            expires_at=int(time.time()) + self._token_ttl,
        )
        await self._store.save_token(access_token)
        log.info("OAuth access token issued for user=%s role=%s", username, role)

        return OAuthToken(
            access_token=token_value,
            token_type="Bearer",
            expires_in=self._token_ttl,
            scope=role,
        )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        return None

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        raise TokenError("unsupported_grant_type", "Refresh tokens are not supported.")

    async def load_access_token(self, token: str) -> AccessToken | None:  # type: ignore[override]
        result = self._store.get_token(token)
        if result is None:
            log.debug("oauth_token_lookup token=%.8s... result=miss", token)
        else:
            log.debug("oauth_token_lookup token=%.8s... user=%s result=hit", token, result.client_id)
        return result

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        if isinstance(token, AccessToken):
            log.info("oauth_token_revoked user=%s token=%.8s...", token.client_id, token.token)
            await self._store.delete_token(token.token)

    # ── Custom consent routes ────────────────────────────────────────────────

    def get_routes(self, mcp_path: str | None = None) -> list[Route]:
        routes = super().get_routes(mcp_path)
        routes.append(Route("/authorize/consent", self._consent_handler, methods=["GET", "POST"]))

        # FastMCP registers /.well-known/oauth-protected-resource/mcp (RFC 8414
        # path-aware), but clients like Claude.ai check the root-path variant
        # /.well-known/oauth-protected-resource.  Add an alias that serves the
        # same metadata so Claude.ai learns the actual MCP endpoint URL (/mcp).
        if self._resource_url:
            from urllib.parse import urlparse as _urlparse
            resource_path = _urlparse(str(self._resource_url)).path
            if resource_path and resource_path not in ("/", ""):
                meta = ProtectedResourceMetadata(
                    resource=self._resource_url,
                    authorization_servers=[self.issuer_url],
                )
                handler = ProtectedResourceMetadataHandler(meta)
                routes.append(Route(
                    "/.well-known/oauth-protected-resource",
                    endpoint=cors_middleware(handler.handle, ["GET", "OPTIONS"]),
                    methods=["GET", "OPTIONS"],
                ))

        return routes

    async def _consent_handler(self, request: Request) -> Response:
        if request.method == "GET":
            return await self._consent_get(request)
        return await self._consent_post(request)

    async def _consent_get(self, request: Request) -> Response:
        nonce = request.query_params.get("nonce", "")
        pending = self._pending.get(nonce)
        if not pending or pending.expires_at < time.time():
            log.warning("oauth_consent_get nonce=%.8s... result=expired_or_invalid", nonce or "?")
            return HTMLResponse(
                "<h1>Authorization request expired or invalid.</h1>"
                "<p>Please return to the application and try again.</p>",
                status_code=400,
            )
        client_name = (getattr(pending.client, "client_name", None) or pending.client.client_id or "An application")
        error = request.query_params.get("error", "")
        log.info(
            "oauth_consent_page_served client=%s nonce=%.8s... error=%s",
            client_name,
            nonce,
            error or "none",
        )
        return HTMLResponse(_render_consent_form(nonce, str(client_name), error))

    async def _consent_post(self, request: Request) -> Response:
        form = await request.form()
        nonce = str(form.get("nonce", ""))
        api_key = str(form.get("api_key", "")).strip()

        pending = self._pending.get(nonce)
        if not pending or pending.expires_at < time.time():
            log.warning("oauth_consent_post nonce=%.8s... result=expired_or_invalid", nonce or "?")
            return HTMLResponse(
                "<h1>Authorization request expired.</h1>"
                "<p>Please return to the application and try again.</p>",
                status_code=400,
            )

        client_id_short = (pending.client.client_id or "?")[:8]

        if not api_key:
            log.warning("oauth_consent_post nonce=%.8s... client=%.8s result=missing_key", nonce, client_id_short)
            return RedirectResponse(
                url=f"/authorize/consent?nonce={nonce}&error=missing_key",
                status_code=303,
            )

        result = await verify_api_key(api_key)
        if result is None:
            log.warning("oauth_consent_post nonce=%.8s... client=%.8s result=invalid_api_key", nonce, client_id_short)
            return RedirectResponse(
                url=f"/authorize/consent?nonce={nonce}&error=invalid_key",
                status_code=303,
            )

        key_id, username, role = result
        if role == "reader":
            log.warning(
                "oauth_consent_post nonce=%.8s... client=%.8s user=%s result=reader_rejected",
                nonce, client_id_short, username,
            )
            return RedirectResponse(
                url=f"/authorize/consent?nonce={nonce}&error=reader_not_allowed",
                status_code=303,
            )

        # Issue authorization code
        code = secrets.token_urlsafe(32)
        params = pending.params
        auth_code = AuthorizationCode(
            code=code,
            client_id=pending.client.client_id or "",
            redirect_uri=params.redirect_uri,
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            scopes=params.scopes or [role],
            expires_at=time.time() + _AUTH_CODE_TTL,
            code_challenge=params.code_challenge,
        )
        self._auth_codes[code] = auth_code
        self._code_claims[code] = (key_id, username, role)
        del self._pending[nonce]

        log.info(
            "oauth_auth_code_issued nonce=%.8s... client=%.8s user=%s role=%s key_id=%.8s code=%.8s...",
            nonce, client_id_short, username, role, key_id, code,
        )
        redirect_url = construct_redirect_uri(
            str(params.redirect_uri), code=code, state=params.state
        )
        return RedirectResponse(
            url=redirect_url,
            status_code=302,
            headers={"Cache-Control": "no-store"},
        )


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------

_ERROR_MESSAGES: dict[str, str] = {
    "invalid_key": "Invalid API key. Please check your key and try again.",
    "missing_key": "Please enter your API key.",
    "reader_not_allowed": "Reader accounts cannot authorize MCP access. Use an admin or editor API key.",
}


def _render_consent_form(nonce: str, client_name: str, error: str = "") -> str:
    error_html = ""
    if error:
        msg = html.escape(_ERROR_MESSAGES.get(error, "An error occurred. Please try again."))
        error_html = f'<p class="error">{msg}</p>'

    safe_nonce = html.escape(nonce)
    safe_client = html.escape(client_name)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PI Planner — Authorize Access</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 420px; margin: 80px auto; padding: 0 1.25rem;
      color: #111; background: #fff;
    }}
    h1 {{ font-size: 1.25rem; margin: 0 0 .25rem; }}
    .subtitle {{ color: #555; margin: 0 0 1.5rem; font-size: .95rem; }}
    label {{ display: block; font-weight: 600; font-size: .875rem; margin-bottom: .3rem; }}
    input[type=password] {{
      display: block; width: 100%; padding: .55rem .75rem;
      border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem;
      outline: none;
    }}
    input[type=password]:focus {{ border-color: #0070f3; box-shadow: 0 0 0 3px rgba(0,112,243,.15); }}
    button {{
      display: block; width: 100%; margin-top: 1.25rem; padding: .65rem;
      background: #0070f3; color: #fff; border: none; border-radius: 6px;
      font-size: 1rem; font-weight: 600; cursor: pointer;
    }}
    button:hover {{ background: #005fd1; }}
    .error {{
      color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca;
      border-radius: 6px; padding: .6rem .75rem; font-size: .875rem;
      margin-bottom: 1rem;
    }}
    .hint {{ color: #6b7280; font-size: .8rem; margin-top: .4rem; }}
  </style>
</head>
<body>
  <h1>PI Planner</h1>
  <p class="subtitle"><strong>{safe_client}</strong> is requesting access to PI Planner.</p>
  {error_html}
  <form method="post" action="/authorize/consent">
    <input type="hidden" name="nonce" value="{safe_nonce}">
    <label for="api_key">API Key</label>
    <input
      type="password"
      id="api_key"
      name="api_key"
      required
      autocomplete="off"
      placeholder="Paste your PI Planner API key"
    >
    <p class="hint">Generate an API key from the PI Planner settings (API Keys tab).</p>
    <button type="submit">Authorize</button>
  </form>
</body>
</html>"""
