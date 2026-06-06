"""
Contract tests: verify all expected tools are registered with correct schemas.
Tests each sub-server independently (no auth required) and the mounted server structure.
"""
import pytest

from mcp_server.tools.read import read_mcp
from mcp_server.tools.projects import projects_mcp
from mcp_server.tools.swimlines import swimlines_mcp
from mcp_server.tools.features import features_mcp
from mcp_server.tools.groups import groups_mcp
from mcp_server.tools.workflows import workflows_mcp
from mcp_server.server import mcp


# ---------------------------------------------------------------------------
# Expected tool names per sub-server (the bare function names, not prefixed)
# ---------------------------------------------------------------------------

EXPECTED_READ_TOOLS = {
    "list_projects",
    "get_project",
    "list_pis",
    "get_pi",
    "list_sprints",
    "list_swimlines",
    "list_features",
    "get_feature",
    "list_pbis",
    "list_groups",
    "get_edit_lock_status",
}

EXPECTED_PROJECTS_TOOLS = {
    "create_project",
    "update_project",
    "export_project",
    "create_pi",
    "update_pi",
    "update_sprint",
}

EXPECTED_SWIMLINES_TOOLS = {
    "create_swimline",
    "update_swimline",
    "delete_swimline",
    "reorder_swimlines",
}

EXPECTED_FEATURES_TOOLS = {
    "create_feature",
    "update_feature",
    "move_feature",
    "delete_feature",
    "create_pbi",
    "update_pbi",
    "place_pbi_in_sprint",
    "remove_pbi_from_sprint",
}

EXPECTED_GROUPS_TOOLS = {
    "create_group",
    "update_group",
    "delete_group",
}

EXPECTED_WORKFLOWS_TOOLS = {
    "bulk_create_features",
    "bulk_create_pbis",
    "plan_pi_backlog",
    "set_sprint_capacities",
    "propose_pbi_sprint_plan",
    "apply_pbi_sprint_plan",
    "summarize_project",
}


async def _tool_names(server) -> set[str]:
    """Extract registered tool names from a FastMCP server."""
    return {t.name for t in await server.list_tools()}


async def _get_tool_schema(server, tool_name: str) -> dict:
    tools = await server.list_tools()
    for t in tools:
        if t.name == tool_name:
            return t.parameters
    raise AssertionError(f"Tool '{tool_name}' not found")


@pytest.mark.asyncio
async def test_read_tools_all_registered():
    names = await _tool_names(read_mcp)
    missing = EXPECTED_READ_TOOLS - names
    assert not missing, f"Missing read tools: {missing}"


@pytest.mark.asyncio
async def test_projects_tools_all_registered():
    names = await _tool_names(projects_mcp)
    missing = EXPECTED_PROJECTS_TOOLS - names
    assert not missing, f"Missing projects tools: {missing}"


@pytest.mark.asyncio
async def test_swimlines_tools_all_registered():
    names = await _tool_names(swimlines_mcp)
    missing = EXPECTED_SWIMLINES_TOOLS - names
    assert not missing, f"Missing swimline tools: {missing}"


@pytest.mark.asyncio
async def test_features_tools_all_registered():
    names = await _tool_names(features_mcp)
    missing = EXPECTED_FEATURES_TOOLS - names
    assert not missing, f"Missing feature tools: {missing}"


@pytest.mark.asyncio
async def test_groups_tools_all_registered():
    names = await _tool_names(groups_mcp)
    missing = EXPECTED_GROUPS_TOOLS - names
    assert not missing, f"Missing group tools: {missing}"


@pytest.mark.asyncio
async def test_workflows_tools_all_registered():
    names = await _tool_names(workflows_mcp)
    missing = EXPECTED_WORKFLOWS_TOOLS - names
    assert not missing, f"Missing workflow tools: {missing}"


@pytest.mark.asyncio
async def test_total_tool_count():
    all_names = set()
    for server in (read_mcp, projects_mcp, swimlines_mcp, features_mcp, groups_mcp, workflows_mcp):
        all_names |= await _tool_names(server)
    assert len(all_names) >= 35, f"Expected at least 35 tools, found {len(all_names)}: {all_names}"


@pytest.mark.asyncio
async def test_main_server_mounts_all_groups():
    """Verify the main server exposes tools from all 6 sub-servers (prefixed)."""
    all_tools = await _tool_names(mcp)
    prefixes = {name.split("_")[0] for name in all_tools if "_" in name}
    for expected_prefix in ("read", "projects", "swimlines", "features", "groups", "workflows"):
        assert expected_prefix in prefixes, (
            f"Mount prefix '{expected_prefix}' not found in main server tools. "
            f"Found prefixes: {prefixes}"
        )


# ---------------------------------------------------------------------------
# Schema constraint tests — verify Annotated Field constraints are present
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_feature_title_max_length():
    schema = await _get_tool_schema(features_mcp, "create_feature")
    props = schema.get("properties", {})
    assert "title" in props
    assert props["title"].get("maxLength") == 255


@pytest.mark.asyncio
async def test_create_feature_user_id_bounds():
    schema = await _get_tool_schema(features_mcp, "create_feature")
    props = schema.get("properties", {})
    user_id_schema = props.get("user_id", {})
    schema_str = str(user_id_schema)
    assert "999999" in schema_str, f"user_id le=999999 constraint missing: {user_id_schema}"


@pytest.mark.asyncio
async def test_place_pbi_sprint_index_bounds():
    schema = await _get_tool_schema(features_mcp, "place_pbi_in_sprint")
    props = schema.get("properties", {})
    sprint_schema = props.get("sprint_index", {})
    schema_str = str(sprint_schema)
    assert "4" in schema_str, f"sprint_index le=4 missing: {sprint_schema}"
    assert "0" in schema_str, f"sprint_index ge=0 missing: {sprint_schema}"


@pytest.mark.asyncio
async def test_create_swimline_name_max_length():
    schema = await _get_tool_schema(swimlines_mcp, "create_swimline")
    props = schema.get("properties", {})
    assert props["name"].get("maxLength") == 100


@pytest.mark.asyncio
async def test_create_group_sprint_index_bounds():
    schema = await _get_tool_schema(groups_mcp, "create_group")
    props = schema.get("properties", {})
    sprint_schema = props.get("sprint_index", {})
    schema_str = str(sprint_schema)
    assert "4" in schema_str, f"sprint_index le=4 missing: {sprint_schema}"


@pytest.mark.asyncio
async def test_set_sprint_capacities_length_constraint():
    schema = await _get_tool_schema(workflows_mcp, "set_sprint_capacities")
    props = schema.get("properties", {})
    cap_schema = props.get("capacities", {})
    schema_str = str(cap_schema)
    assert "5" in schema_str, f"capacities min/maxItems=5 missing: {cap_schema}"


# ---------------------------------------------------------------------------
# projects_mcp schema constraints
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_project_name_max_length():
    schema = await _get_tool_schema(projects_mcp, "create_project")
    props = schema.get("properties", {})
    assert props["name"].get("maxLength") == 255


@pytest.mark.asyncio
async def test_update_project_effort_unit_max_length():
    schema = await _get_tool_schema(projects_mcp, "update_project")
    props = schema.get("properties", {})
    effort_unit = props.get("effort_unit", {})
    # Optional str|None is wrapped in anyOf — find the string variant
    any_of = effort_unit.get("anyOf", [])
    max_lengths = [s.get("maxLength") for s in any_of if "maxLength" in s]
    assert 20 in max_lengths, f"effort_unit maxLength=20 not found: {effort_unit}"


@pytest.mark.asyncio
async def test_create_pi_name_max_length():
    schema = await _get_tool_schema(projects_mcp, "create_pi")
    props = schema.get("properties", {})
    assert props["name"].get("maxLength") == 100


@pytest.mark.asyncio
async def test_update_sprint_capacity_gt_zero():
    schema = await _get_tool_schema(projects_mcp, "update_sprint")
    props = schema.get("properties", {})
    cap_schema = props.get("capacity", {})
    schema_str = str(cap_schema)
    # Pydantic emits gt=0 as exclusiveMinimum: 0
    assert "0" in schema_str, f"capacity gt=0 constraint missing: {cap_schema}"
