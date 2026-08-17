"""Resolving State names for MCP write tools.

Agents know a State by its name, not its system_id. Unlike the web UI — where a human
types a new State in front of a list they can see — an unrecognised name from an agent
is usually a hallucination, so it is rejected with the valid values rather than
silently creating vocabulary.
"""

from mcp_server.backend import call_backend


def _normalise(value: str) -> str:
    return value.strip().lower()


def state_item_type_for_pbi(item_type: str) -> str:
    """Stories and Bugs draw from separate State Lists."""
    return "bug" if item_type == "bug" else "story"


async def resolve_state_id(project_id: str, item_type: str, state: str) -> str | None:
    """Map a State name to its system_id within one project's list for `item_type`.

    Returns None for a blank name (meaning "no State"). Raises ValueError when the
    name is not in the list, listing what is.
    """
    if _normalise(state) == "":
        return None

    # call_backend wraps list payloads as {"items": [...]} to keep tool returns dict-only.
    response = await call_backend("GET", f"/api/v1/projects/{project_id}/states/")
    states = response.get("items", [])
    candidates = [s for s in states if s["item_type"] == item_type]

    for entry in candidates:
        if _normalise(entry["value"]) == _normalise(state):
            return str(entry["system_id"])

    available = ", ".join(repr(s["value"]) for s in candidates) or "(the list is empty)"
    raise ValueError(
        f"No State named {state!r} for {item_type} items in this project. "
        f"Available: {available}. States are created by CSV import or in the web UI."
    )
