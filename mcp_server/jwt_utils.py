import time

import jwt

from mcp_server.config import settings


def mint_service_jwt() -> str:
    """Mint a short-lived HS256 service JWT for authenticating MCP→backend calls."""
    now = int(time.time())
    return jwt.encode(
        {"iss": "mcp-server", "sub": "service", "iat": now, "exp": now + 300},
        settings.mcp_signing_secret,
        algorithm="HS256",
    )
