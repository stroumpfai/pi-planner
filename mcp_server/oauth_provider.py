"""OAuth 2.1 authorization server for PI Planner MCP.

Exposes a minimal consent page where users paste an existing PI Planner
API key. Issued access tokens carry the same claims (key_id, role) as
direct-Bearer tokens so call_backend() works transparently for both paths.
"""

from __future__ import annotations

import asyncio
import hashlib
import html
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path

from fastmcp.server.auth.auth import AccessToken, ClientRegistrationOptions, OAuthProvider
from fastmcp.server.auth.cimd import CIMDFetchError, CIMDFetcher, CIMDValidationError
from mcp.server.auth.handlers.metadata import MetadataHandler, ProtectedResourceMetadataHandler
from mcp.server.auth.routes import build_metadata
from mcp.server.auth.provider import (
    AuthorizationCode,
    AuthorizationParams,
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
from starlette.types import ASGIApp, Receive, Scope, Send

from mcp_server.auth import (
    BackendAuthUnavailable,
    clear_auth_failures,
    client_ip,
    is_rate_limited,
    record_auth_failure,
    verify_api_key,
)

log = logging.getLogger(__name__)

_AUTH_CODE_TTL = 300  # 5 minutes — auth codes and pending consent sessions

# The scopes this server supports (mirrors ClientRegistrationOptions.valid_scopes).
_VALID_SCOPES = ["admin", "editor"]
_DEFAULT_CLIENT_SCOPE = " ".join(_VALID_SCOPES)


# ---------------------------------------------------------------------------
# ASGI middleware: inject scope hint into 401/403 WWW-Authenticate headers
# (Finding 6 — MCP spec §4: SHOULD include scope in WWW-Authenticate)
# ---------------------------------------------------------------------------

class ScopeHintMiddleware:
    """Adds scope="<scopes>" to WWW-Authenticate headers on 401 and 403 responses.

    Placed as the outermost Starlette middleware so it intercepts every error
    response, including those emitted by RequireAuthMiddleware (which wraps
    individual route handlers and is therefore inside this layer).
    """

    def __init__(self, app: ASGIApp, scopes: list[str]) -> None:
        self._app = app
        self._scope_value = " ".join(scopes)

    def _inject_scope(
        self, headers: list[tuple[bytes, bytes]]
    ) -> list[tuple[bytes, bytes]]:
        new_headers: list[tuple[bytes, bytes]] = []
        found = False
        for name, value in headers:
            if name.lower() == b"www-authenticate":
                decoded = value.decode("utf-8", errors="replace")
                if "scope=" not in decoded:
                    decoded = f'{decoded}, scope="{self._scope_value}"'
                new_headers.append((name, decoded.encode("utf-8")))
                found = True
            else:
                new_headers.append((name, value))
        if not found:
            new_headers.append(
                (b"www-authenticate", f'Bearer scope="{self._scope_value}"'.encode())
            )
        return new_headers

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        async def patched_send(message: dict) -> None:
            if (
                message["type"] == "http.response.start"
                and message.get("status") in (401, 403)
                and self._scope_value
            ):
                message = {
                    **message,
                    "headers": self._inject_scope(list(message.get("headers", []))),
                }
            await send(message)

        await self._app(scope, receive, patched_send)


# ---------------------------------------------------------------------------
# Token store
# ---------------------------------------------------------------------------


def _token_key(token: str) -> str:
    """Storage key for a token/code: SHA-256 so raw secrets never rest on disk."""
    return hashlib.sha256(token.encode()).hexdigest()


class TokenStore:
    """Async-safe JSON file store for OAuth tokens, auth codes, and client registrations.

    Tokens and auth codes are keyed by their SHA-256 hash and the raw secret is
    never persisted — a leaked store file cannot be replayed. Lookups hash the
    presented token; the returned objects carry the caller-supplied raw value.

    File layout (version 2):
      {
        "v": 2,
        "access_tokens":  { "<sha256>": { client_id, scopes, claims, expires_at } },
        "refresh_tokens": { "<sha256>": { client_id, scopes, claims, expires_at } },
        "auth_codes":     { "<sha256>": { ...AuthorizationCode fields sans code..., "_claims": [...] } },
        "clients":        { "<client_id>": { ...OAuthClientInformationFull fields... } }
      }

    Older formats (flat access-token map, or v1 sections keyed by raw token) are
    detected on load and migrated transparently — no data loss on upgrade.

    Expired tokens and auth codes are pruned on load and on every get_*() call.
    The asyncio.Lock guards concurrent writes.
    File permissions are set to 0o600 on every write.
    """

    def __init__(self, path: str) -> None:
        self._path = Path(path)
        self._tokens: dict[str, dict] = {}
        self._refresh_tokens: dict[str, dict] = {}
        self._auth_codes: dict[str, dict] = {}
        self._clients: dict[str, dict] = {}
        self._lock = asyncio.Lock()
        self._load()

    @staticmethod
    def _migrate_v1_section(section: dict[str, dict], secret_field: str) -> dict[str, dict]:
        """Re-key a raw-token-keyed (v1) section by hash and strip the raw secret."""
        migrated: dict[str, dict] = {}
        for raw_key, entry in section.items():
            migrated[_token_key(raw_key)] = {k: v for k, v in entry.items() if k != secret_field}
        return migrated

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text())
            now = time.time()
            # Old flat format: top-level keys are token strings, not section names.
            if "access_tokens" not in data:
                tokens = data
                refresh_tokens: dict[str, dict] = {}
                auth_codes: dict[str, dict] = {}
                self._clients = {}
                needs_migration = True
            else:
                tokens = data.get("access_tokens", {})
                refresh_tokens = data.get("refresh_tokens", {})
                auth_codes = data.get("auth_codes", {})
                self._clients = data.get("clients", {})
                needs_migration = data.get("v") != 2
            if needs_migration:
                tokens = self._migrate_v1_section(tokens, "token")
                refresh_tokens = self._migrate_v1_section(refresh_tokens, "token")
                auth_codes = self._migrate_v1_section(auth_codes, "code")
            self._tokens = {k: v for k, v in tokens.items() if v.get("expires_at", 0) > now}
            self._refresh_tokens = {
                k: v
                for k, v in refresh_tokens.items()
                if v.get("expires_at") is None or v["expires_at"] > now
            }
            self._auth_codes = {
                k: v for k, v in auth_codes.items() if v.get("expires_at", 0) > now
            }
            if needs_migration:
                # Persist the hashed form immediately so raw secrets don't linger.
                self._write()
        except Exception:
            self._tokens = {}
            self._refresh_tokens = {}
            self._auth_codes = {}
            self._clients = {}

    def _write(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            {
                "v": 2,
                "access_tokens": self._tokens,
                "refresh_tokens": self._refresh_tokens,
                "auth_codes": self._auth_codes,
                "clients": self._clients,
            },
            indent=2,
        )
        # Write atomically: a crash mid-write must not corrupt the token file, or
        # the next _load() would discard every token and log out all OAuth clients.
        # Write to a temp file in the same directory (so os.replace is atomic),
        # fsync, chmod 0o600, then rename over the target.
        tmp = self._path.with_name(f"{self._path.name}.{os.getpid()}.tmp")
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            try:
                os.write(fd, payload.encode("utf-8"))
                os.fsync(fd)
            finally:
                os.close(fd)
            os.replace(tmp, self._path)
        finally:
            if tmp.exists():
                tmp.unlink()

    # -- Access token methods --

    async def save_token(self, token: AccessToken) -> None:
        async with self._lock:
            self._tokens[_token_key(token.token)] = {
                "client_id": token.client_id,
                "scopes": token.scopes,
                "claims": token.claims,
                "expires_at": token.expires_at,
            }
            self._write()

    def get_token(self, token: str) -> AccessToken | None:
        key = _token_key(token)
        entry = self._tokens.get(key)
        if not entry:
            return None
        if (entry.get("expires_at") or 0) <= time.time():
            del self._tokens[key]
            return None
        return AccessToken(
            token=token,
            client_id=entry["client_id"],
            scopes=entry["scopes"],
            claims=entry.get("claims", {}),
            expires_at=entry["expires_at"],
        )

    async def delete_token(self, token: str) -> None:
        async with self._lock:
            key = _token_key(token)
            if key in self._tokens:
                del self._tokens[key]
                self._write()

    # -- Refresh token methods --

    async def save_refresh_token(self, token: RefreshToken, claims: dict) -> None:
        async with self._lock:
            self._refresh_tokens[_token_key(token.token)] = {
                "client_id": token.client_id,
                "scopes": token.scopes,
                "expires_at": token.expires_at,
                "claims": claims,
            }
            self._write()

    def get_refresh_token(self, token: str) -> RefreshToken | None:
        key = _token_key(token)
        entry = self._refresh_tokens.get(key)
        if not entry:
            return None
        expires_at = entry.get("expires_at")
        if expires_at is not None and expires_at <= time.time():
            del self._refresh_tokens[key]
            return None
        return RefreshToken(
            token=token,
            client_id=entry["client_id"],
            scopes=entry["scopes"],
            expires_at=entry.get("expires_at"),
        )

    def get_refresh_token_claims(self, token: str) -> dict:
        entry = self._refresh_tokens.get(_token_key(token))
        return entry.get("claims", {}) if entry else {}

    async def delete_refresh_token(self, token: str) -> None:
        async with self._lock:
            key = _token_key(token)
            if key in self._refresh_tokens:
                del self._refresh_tokens[key]
                self._write()

    # -- Authorization code methods --

    async def save_auth_code(
        self, code: str, auth_code: AuthorizationCode, claims: tuple[str, str, str]
    ) -> None:
        entry = auth_code.model_dump(mode="json")
        entry.pop("code", None)  # never persist the raw code
        async with self._lock:
            self._auth_codes[_token_key(code)] = {**entry, "_claims": list(claims)}
            self._write()

    def get_auth_code(
        self, code: str
    ) -> tuple[AuthorizationCode, tuple[str, str, str]] | None:
        key = _token_key(code)
        entry = self._auth_codes.get(key)
        if not entry:
            return None
        if entry.get("expires_at", 0) <= time.time():
            del self._auth_codes[key]
            return None
        raw_claims = entry.get("_claims", ["", "", ""])
        claims: tuple[str, str, str] = (
            str(raw_claims[0]) if len(raw_claims) > 0 else "",
            str(raw_claims[1]) if len(raw_claims) > 1 else "",
            str(raw_claims[2]) if len(raw_claims) > 2 else "",
        )
        code_data = {k: v for k, v in entry.items() if k != "_claims"}
        code_data["code"] = code
        try:
            auth_code = AuthorizationCode.model_validate(code_data)
        except Exception:
            del self._auth_codes[key]
            return None
        return auth_code, claims

    async def delete_auth_code(self, code: str) -> None:
        async with self._lock:
            key = _token_key(code)
            if key in self._auth_codes:
                del self._auth_codes[key]
                self._write()

    # -- Client registration methods --

    async def save_client(self, client: OAuthClientInformationFull) -> None:
        async with self._lock:
            self._clients[client.client_id] = client.model_dump(mode="json")
            self._write()

    def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        entry = self._clients.get(client_id)
        if not entry:
            return None
        try:
            return OAuthClientInformationFull.model_validate(entry)
        except Exception:
            return None


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
    2. Claude.ai registers as a client (Dynamic Client Registration or CIMD)
    3. Claude.ai sends the user to GET /authorize?...
    4. SDK validates params, calls provider.authorize() which redirects to
       /authorize/consent?nonce=...
    5. User pastes their PI Planner API key and clicks Authorize
    6. POST /authorize/consent validates the key, issues an auth code,
       redirects back to Claude.ai's redirect_uri
    7. Claude.ai exchanges the auth code at /token for an access token + refresh token
    8. Subsequent MCP calls present the access token as Bearer
    9. When the access token expires, Claude.ai silently exchanges the refresh token
       for a new access token + rotated refresh token (no user interaction needed)

    Scope model (mirrors APIKeyAuthProvider):
      admin  → scopes=["admin", "editor"]
      editor → scopes=["editor"]

    Token identity model: AccessToken.client_id is the calling OAuth client
    (matches RefreshToken.client_id and the SDK's expectations for both); the
    PI Planner user this token acts as travels as claims["username"] — read it
    via auth.actor_username(), the single trusted source for X-MCP-Actor.
    """

    def __init__(
        self,
        base_url: str,
        token_storage_path: str,
        token_ttl: int = 3600,
        refresh_token_ttl: int = 2592000,
    ) -> None:
        super().__init__(
            base_url=base_url,
            client_registration_options=ClientRegistrationOptions(
                enabled=True,
                valid_scopes=_VALID_SCOPES,
            ),
            revocation_options=RevocationOptions(enabled=True),
            # required_scopes drives RequireAuthMiddleware — callers need at least "editor".
            required_scopes=["editor"],
        )
        self._pending: dict[str, _PendingAuth] = {}
        self._store = TokenStore(token_storage_path)
        self._token_ttl = token_ttl
        self._refresh_token_ttl = refresh_token_ttl
        self._base_url_str = str(base_url).rstrip("/")
        self._cimd_fetcher = CIMDFetcher()

    # ── OAuthAuthorizationServerProvider protocol ───────────────────────────

    @staticmethod
    def _ensure_scope(
        client: OAuthClientInformationFull,
    ) -> OAuthClientInformationFull:
        """Guarantee the client is registered with the full supported scope set.

        Clients that DCR-register without a `scope`, or arrive via CIMD (whose
        document carries no scope), end up with scope=None. Because this server
        advertises `scopes_supported` and a `WWW-Authenticate: scope="admin editor"`
        hint, spec-compliant clients (Claude.ai, ChatGPT) then request `scope=editor`
        at /authorize — which the SDK's validate_scope() rejects with invalid_scope
        unless the registered scope covers it, silently killing the consent flow
        (the user never sees the API-key page). Granting the supported scopes here
        is safe: real authorization is enforced by the API key pasted on the consent
        page — readers are rejected and the user's role drives the issued token.
        """
        if not client.scope:
            client.scope = _DEFAULT_CLIENT_SCOPE
        return client

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        # Check persistent store first (covers DCR-registered clients).
        stored = self._store.get_client(client_id)
        if stored is not None:
            return self._ensure_scope(stored)

        # For URL-formatted client IDs, auto-fetch the CIMD document (Finding 4).
        # redirect_uris is intentionally left as None — we validate per-request
        # in authorize() via CIMDFetcher.validate_redirect_uri (supports wildcards).
        if self._cimd_fetcher.is_cimd_client_id(client_id):
            try:
                cimd_doc = await self._cimd_fetcher.fetch(client_id)
                log.info(
                    "oauth_cimd_resolved client_id=%.40s name=%s",
                    client_id,
                    cimd_doc.client_name or "(unnamed)",
                )
                return self._ensure_scope(
                    OAuthClientInformationFull(
                        client_id=client_id,
                        client_name=cimd_doc.client_name,
                        redirect_uris=None,
                        grant_types=cimd_doc.grant_types,
                        response_types=cimd_doc.response_types,
                        token_endpoint_auth_method=cimd_doc.token_endpoint_auth_method,
                        client_uri=cimd_doc.client_uri,
                        logo_uri=cimd_doc.logo_uri,
                    )
                )
            except (CIMDFetchError, CIMDValidationError) as exc:
                log.warning("oauth_cimd_fetch_failed client_id=%.40s error=%s", client_id, exc)
                return None

        return None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if client_info.client_id is None:
            raise ValueError("client_id is required for registration")

        # For URL-formatted client IDs submitted via DCR, validate redirect_uris
        # against the CIMD document before storing (Finding 4).
        if self._cimd_fetcher.is_cimd_client_id(client_info.client_id):
            try:
                cimd_doc = await self._cimd_fetcher.fetch(client_info.client_id)
            except (CIMDFetchError, CIMDValidationError) as exc:
                raise ValueError(
                    f"CIMD document validation failed for {client_info.client_id!r}: {exc}"
                ) from exc

            for redirect_uri in client_info.redirect_uris or []:
                if not self._cimd_fetcher.validate_redirect_uri(cimd_doc, str(redirect_uri)):
                    raise ValueError(
                        f"Redirect URI {redirect_uri!r} is not permitted by the CIMD document"
                    )

        self._ensure_scope(client_info)
        await self._store.save_client(client_info)
        log.info(
            "oauth_dcr_registered client_id=%.8s name=%s scope=%s",
            client_info.client_id,
            client_info.client_name or "(unnamed)",
            client_info.scope,
        )

    async def _validate_redirect_uri(
        self, client: OAuthClientInformationFull, redirect_uri_str: str
    ) -> None:
        """Raise ValueError if redirect_uri is not permitted for this client (Finding 8)."""
        client_id = client.client_id or ""
        if self._cimd_fetcher.is_cimd_client_id(client_id):
            try:
                cimd_doc = await self._cimd_fetcher.fetch(client_id)
            except (CIMDFetchError, CIMDValidationError) as exc:
                raise ValueError(f"CIMD validation failed: {exc}") from exc
            if not self._cimd_fetcher.validate_redirect_uri(cimd_doc, redirect_uri_str):
                log.warning(
                    "oauth_authorize_redirect_uri_mismatch client=%.8s uri=%s",
                    client_id, redirect_uri_str,
                )
                raise ValueError(
                    f"redirect_uri {redirect_uri_str!r} not permitted by CIMD document"
                )
        elif client.redirect_uris:
            registered = {str(u).rstrip("/") for u in client.redirect_uris}
            if redirect_uri_str.rstrip("/") not in registered:
                log.warning(
                    "oauth_authorize_redirect_uri_mismatch client=%.8s uri=%s",
                    client_id, redirect_uri_str,
                )
                raise ValueError(
                    f"redirect_uri {redirect_uri_str!r} not registered for this client"
                )

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """Validate redirect_uri, store auth params, and redirect to consent page."""
        if params.redirect_uri:
            await self._validate_redirect_uri(client, str(params.redirect_uri))

        # Drop any consent sessions that expired without being completed so the
        # in-memory dict doesn't grow unbounded on a long-running server.
        now = time.time()
        expired = [n for n, p in self._pending.items() if p.expires_at < now]
        for n in expired:
            del self._pending[n]

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
        result = self._store.get_auth_code(authorization_code)
        if not result:
            return None
        auth_code, _ = result
        if auth_code.client_id != client.client_id:
            return None
        return auth_code

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        result = self._store.get_auth_code(authorization_code.code)
        if not result:
            raise TokenError("invalid_grant", "Authorization code not found or already used.")

        _, (key_id, username, role) = result
        await self._store.delete_auth_code(authorization_code.code)

        claims = {"key_id": key_id, "username": username, "role": role}
        # Admin tokens carry both scopes so required_scopes=["editor"] passes for admins.
        scopes = ["admin", "editor"] if role == "admin" else ["editor"]

        # client_id identifies the calling OAuth client (mirrors RefreshToken
        # and APIKeyAuthProvider's key_id convention) — the acting PI Planner
        # user travels as claims["username"], the only trusted source for
        # X-MCP-Actor (see auth.actor_username()).
        token_value = secrets.token_urlsafe(32)
        access_token = AccessToken(
            token=token_value,
            client_id=client.client_id or "",
            scopes=scopes,
            claims=claims,
            expires_at=int(time.time()) + self._token_ttl,
        )
        await self._store.save_token(access_token)

        # Refresh tokens are scoped to the OAuth client too — the SDK matches
        # refresh_token.client_id against the authenticated OAuth client_id on
        # every refresh exchange. Username/key_id/role travel as claims.
        refresh_value = secrets.token_urlsafe(32)
        refresh_token = RefreshToken(
            token=refresh_value,
            client_id=client.client_id or "",
            scopes=scopes,
            expires_at=int(time.time()) + self._refresh_token_ttl,
        )
        await self._store.save_refresh_token(
            refresh_token, claims={"key_id": key_id, "username": username, "role": role}
        )

        log.info(
            "oauth_token_issued user=%s role=%s access_ttl=%ds refresh_ttl=%ds",
            username, role, self._token_ttl, self._refresh_token_ttl,
        )

        return OAuthToken(
            access_token=token_value,
            refresh_token=refresh_value,
            token_type="Bearer",
            expires_in=self._token_ttl,
            scope=" ".join(scopes),
        )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        return self._store.get_refresh_token(refresh_token)

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        """Rotate the refresh token: invalidate the old one, issue a new pair.

        The SDK has already verified the refresh token exists, is unexpired,
        belongs to `client`, and that `scopes` is a subset of its granted
        scopes before calling us.
        """
        claims = self._store.get_refresh_token_claims(refresh_token.token)
        if not claims or "key_id" not in claims or "username" not in claims or "role" not in claims:
            raise TokenError("invalid_grant", "Refresh token claims not found.")

        key_id = claims["key_id"]
        username = claims["username"]
        role = claims["role"]

        # Single-use rotation — invalidate the presented refresh token.
        await self._store.delete_refresh_token(refresh_token.token)

        # Same convention as exchange_authorization_code: client_id is the
        # OAuth client, the acting user travels as claims["username"].
        token_value = secrets.token_urlsafe(32)
        access_token = AccessToken(
            token=token_value,
            client_id=client.client_id or "",
            scopes=scopes,
            claims={"key_id": key_id, "username": username, "role": role},
            expires_at=int(time.time()) + self._token_ttl,
        )
        await self._store.save_token(access_token)

        # New refresh token keeps the *original* granted scope ceiling so the
        # client can request a broader scope again on a later refresh, even if
        # this exchange asked for a narrower one.
        new_refresh_value = secrets.token_urlsafe(32)
        new_refresh_token = RefreshToken(
            token=new_refresh_value,
            client_id=client.client_id or "",
            scopes=refresh_token.scopes,
            expires_at=int(time.time()) + self._refresh_token_ttl,
        )
        await self._store.save_refresh_token(new_refresh_token, claims=claims)

        log.info(
            "oauth_token_refreshed user=%s role=%s access_ttl=%ds refresh_ttl=%ds",
            username, role, self._token_ttl, self._refresh_token_ttl,
        )

        return OAuthToken(
            access_token=token_value,
            refresh_token=new_refresh_value,
            token_type="Bearer",
            expires_in=self._token_ttl,
            scope=" ".join(scopes),
        )

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
        else:
            log.info("oauth_refresh_revoked user=%s token=%.8s...", token.client_id, token.token)
            await self._store.delete_refresh_token(token.token)

    # ── Custom consent routes ────────────────────────────────────────────────

    def get_routes(self, mcp_path: str | None = None) -> list[Route]:
        routes = super().get_routes(mcp_path)

        # RFC 8414 §2: rebuild metadata to advertise grant types, scopes, and CIMD support.
        _metadata = build_metadata(
            self.base_url,
            self.service_documentation_url,
            self.client_registration_options or ClientRegistrationOptions(enabled=True),
            self.revocation_options or RevocationOptions(enabled=True),
        )
        # build_metadata() already sets grant_types_supported to
        # ["authorization_code", "refresh_token"], which is accurate now that
        # exchange_refresh_token() rotates and issues real refresh tokens.
        # Advertise CIMD support so clients know they can use URL-format client IDs
        # instead of Dynamic Client Registration (Finding 4).
        _metadata.client_id_metadata_document_supported = True
        # scopes_supported is already set by build_metadata via
        # ClientRegistrationOptions.valid_scopes=["admin", "editor"] (Finding 5).

        _corrected = cors_middleware(MetadataHandler(_metadata).handle, ["GET", "OPTIONS"])
        routes = [
            Route(
                "/.well-known/oauth-authorization-server",
                endpoint=_corrected,
                methods=["GET", "OPTIONS"],
            )
            if isinstance(r, Route) and r.path == "/.well-known/oauth-authorization-server"
            else r
            for r in routes
        ]

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
        redirect_uri = str(pending.params.redirect_uri) if pending.params.redirect_uri else "(none provided)"
        error = request.query_params.get("error", "")
        log.info(
            "oauth_consent_page_served client=%s nonce=%.8s... error=%s",
            client_name,
            nonce,
            error or "none",
        )
        return HTMLResponse(_render_consent_form(nonce, str(client_name), redirect_uri, error))

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
        ip = client_ip(request)

        if not api_key:
            log.warning("oauth_consent_post nonce=%.8s... client=%.8s result=missing_key", nonce, client_id_short)
            return RedirectResponse(
                url=f"/authorize/consent?nonce={nonce}&error=missing_key",
                status_code=303,
            )

        # Reuse the same sliding-window limiter as the Bearer-token path (auth.py)
        # so this form can't be used as an unthrottled API-key brute-force oracle.
        if is_rate_limited(ip):
            log.warning("oauth_consent_post nonce=%.8s... client=%.8s ip=%s result=rate_limited", nonce, client_id_short, ip)
            return RedirectResponse(
                url=f"/authorize/consent?nonce={nonce}&error=rate_limited",
                status_code=303,
            )

        try:
            result = await verify_api_key(api_key)
        except BackendAuthUnavailable:
            # Transient backend problem — don't record a failure or blame the user.
            log.warning("oauth_consent_post nonce=%.8s... client=%.8s result=backend_unavailable", nonce, client_id_short)
            return RedirectResponse(
                url=f"/authorize/consent?nonce={nonce}&error=backend_unavailable",
                status_code=303,
            )
        if result is None:
            record_auth_failure(ip)
            log.warning("oauth_consent_post nonce=%.8s... client=%.8s result=invalid_api_key", nonce, client_id_short)
            return RedirectResponse(
                url=f"/authorize/consent?nonce={nonce}&error=invalid_key",
                status_code=303,
            )

        key_id, username, role = result
        clear_auth_failures(ip)
        if role == "reader":
            log.warning(
                "oauth_consent_post nonce=%.8s... client=%.8s user=%s result=reader_rejected",
                nonce, client_id_short, username,
            )
            del self._pending[nonce]
            params = pending.params
            # Per OAuth 2.1: send error to the client via redirect_uri, not an HTML page.
            # This lets MCP clients surface a meaningful error instead of timing out (Finding 12).
            if params.redirect_uri:
                redirect_url = construct_redirect_uri(
                    str(params.redirect_uri),
                    error="access_denied",
                    error_description="Reader accounts cannot authorize MCP access. Use an admin or editor API key.",
                    state=params.state,
                )
                return RedirectResponse(
                    url=redirect_url,
                    status_code=302,
                    headers={"Cache-Control": "no-store"},
                )
            # No redirect_uri available — fall back to informational HTML.
            return HTMLResponse(
                "<h1>Access denied</h1>"
                "<p>Reader accounts cannot authorize MCP access. Use an admin or editor API key.</p>",
                status_code=403,
            )

        # Issue authorization code and persist it across potential restarts (Finding 9).
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
        await self._store.save_auth_code(code, auth_code, (key_id, username, role))
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
    "rate_limited": "Too many failed attempts. Please wait a minute and try again.",
    "backend_unavailable": "PI Planner is temporarily unreachable. Please try again shortly.",
}


def _render_consent_form(nonce: str, client_name: str, redirect_uri: str, error: str = "") -> str:
    error_html = ""
    if error:
        msg = html.escape(_ERROR_MESSAGES.get(error, "An error occurred. Please try again."))
        error_html = f'<p class="error">{msg}</p>'

    safe_nonce = html.escape(nonce)
    safe_client = html.escape(client_name)
    safe_redirect = html.escape(redirect_uri)

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
    .destination {{ color: #555; font-size: .85rem; margin: 0 0 1.25rem; word-break: break-all; }}
    .destination code {{
      background: #f3f4f6; padding: .1rem .35rem; border-radius: 4px; font-size: .8rem;
    }}
  </style>
</head>
<body>
  <h1>PI Planner</h1>
  <p class="subtitle"><strong>{safe_client}</strong> is requesting access to PI Planner.</p>
  <p class="destination">After you authorize, you'll be redirected to:<br><code>{safe_redirect}</code></p>
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
