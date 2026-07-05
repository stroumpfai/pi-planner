import time

import jwt

from mcp_server.config import settings


def mint_service_jwt(actor: str | None = None) -> str:
    """Mint a short-lived HS256 service JWT for authenticating MCP→backend calls.

    When *actor* is given it is embedded as a claim, binding the token to that
    user: the backend rejects any X-MCP-Actor header that doesn't match, so a
    captured token cannot be replayed as a different (e.g. admin) user.
    """
    now = int(time.time())
    claims: dict[str, object] = {"iss": "mcp-server", "sub": "service", "iat": now, "exp": now + 300}
    if actor is not None:
        claims["actor"] = actor
    return jwt.encode(claims, settings.mcp_signing_secret, algorithm="HS256")
