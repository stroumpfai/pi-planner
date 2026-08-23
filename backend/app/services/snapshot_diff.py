"""Snapshot ↔ current-state diff.

Compares two ``serialize_project``-shaped ``project`` payloads — a baseline (the
stored ``ProjectSnapshot.snapshot_data["project"]``) against the live project —
and reports what changed. Because a snapshot stores the *exact* output of
``serialize_project`` (see ``app.services.snapshot``) and every entity carries a
stable ``system_id`` that survives snapshot/restore, the diff is a structural
walk keyed on ``system_id`` — no DB access and no schema knowledge beyond the
serialized shape.

The output is designed to be read by an MCP agent at the end of a planning
session ("what did we change before I snapshot again?"): a per-entity
added/removed/changed breakdown with field-level ``from``/``to`` deltas, a
summary with counts and a headline effort delta, and a compact natural-language
narrative. ``render_diff_html`` (in ``snapshot_diff_html``) renders the same dict
as a self-contained page.

Volatile fields (``created_at`` / ``modified_at`` / ``exported_at``) are ignored
so only meaningful, planning-relevant changes surface.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# Entity types in a stable presentation order. Each maps to the tracked,
# planning-relevant fields whose changes count as a "changed" entity — volatile
# timestamps are deliberately excluded.
TRACKED_FIELDS: dict[str, list[str]] = {
    # "state" is the State's *value*, not its id: a diff reads better as
    # "New → In Progress" than as a pair of UUIDs, and it also catches a State
    # that was renamed out from under the item.
    "features": [
        "id", "title", "description", "location", "pi_id", "swimlane_id",
        "continued_from_feature_id", "effort", "state",
    ],
    "pbis": [
        "id", "parent_feature_system_id", "title", "description", "effort",
        "item_type", "location", "pi_id", "swimlane_id", "group_id", "state",
    ],
    "pis": ["name", "description", "state", "start_date", "end_date"],
    "swimlines": ["name", "order_index"],
    "sprints": ["sprint_index", "capacity", "start_date", "end_date"],
    "groups": [
        "name", "feature_system_id", "sprint_index", "order_index",
        "is_implicit", "story_system_id",
    ],
    "events": ["name", "event_date", "event_type"],
}

ENTITY_ORDER: list[str] = list(TRACKED_FIELDS.keys())


# ── flattening ───────────────────────────────────────────────────────────────


def _flatten(project: dict[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    """Flatten a serialized project into ``{entity_type: {system_id: entity}}``.

    Nested entities (swimlines/sprints/events under a PI, groups under a
    swimline) are pulled up to a flat map and annotated with parent context
    (``pi_id`` and, for groups, ``swimline_id``) so they can be scoped and
    labelled without re-walking the tree.
    """
    out: dict[str, dict[str, dict[str, Any]]] = {t: {} for t in ENTITY_ORDER}

    for f in project.get("features", []):
        out["features"][f["system_id"]] = f
    for p in project.get("pbis", []):
        out["pbis"][p["system_id"]] = p

    for pi in project.get("pis", []):
        out["pis"][pi["system_id"]] = pi
        pi_id = pi["system_id"]
        for sl in pi.get("swimlines", []):
            out["swimlines"][sl["system_id"]] = {**sl, "pi_id": pi_id}
            for g in sl.get("groups", []):
                out["groups"][g["system_id"]] = {
                    **g, "pi_id": pi_id, "swimline_id": sl["system_id"]
                }
        for s in pi.get("sprints", []):
            out["sprints"][s["system_id"]] = {**s, "pi_id": pi_id}
        for e in pi.get("events", []):
            out["events"][e["system_id"]] = {**e, "pi_id": pi_id}

    return out


def _pi_of(entity_type: str, entity: dict[str, Any] | None) -> str | None:
    """The PI a flattened entity belongs to (the PI's own id for ``pis``)."""
    if entity is None:
        return None
    if entity_type == "pis":
        return entity["system_id"]
    return entity.get("pi_id")


def _in_scope(entity_type: str, base: dict | None, cur: dict | None, pi_id: str | None) -> bool:
    """True if the entity belongs to ``pi_id`` in the baseline OR current state.

    Including both sides is what makes items pulled *into* or pushed *out of* the
    PI visible in a PI-scoped diff.
    """
    if pi_id is None:
        return True
    return _pi_of(entity_type, base) == pi_id or _pi_of(entity_type, cur) == pi_id


# ── labelling ────────────────────────────────────────────────────────────────


def _label(entity_type: str, entity: dict[str, Any]) -> dict[str, Any]:
    """A small identifying header for an entity in the diff output."""
    label: dict[str, Any] = {"system_id": entity["system_id"]}
    if entity_type in ("features", "pbis"):
        label["id"] = entity.get("id")
        label["title"] = entity.get("title")
    elif entity_type == "sprints":
        idx = entity.get("sprint_index")
        label["sprint_index"] = idx
        label["name"] = f"Sprint {idx + 1}" if isinstance(idx, int) else "Sprint"
    else:  # pis, swimlines, groups, events
        label["name"] = entity.get("name")
    if entity_type not in ("pis",):
        pi_id = entity.get("pi_id")
        if pi_id is not None:
            label["pi_id"] = pi_id
    return label


# ── diffing ──────────────────────────────────────────────────────────────────


def _diff_collection(
    entity_type: str,
    base_map: dict[str, dict],
    cur_map: dict[str, dict],
    pi_id: str | None,
) -> dict[str, list]:
    tracked = TRACKED_FIELDS[entity_type]
    base_ids, cur_ids = set(base_map), set(cur_map)
    added, removed, changed = [], [], []

    for sid in cur_ids - base_ids:
        e = cur_map[sid]
        if _in_scope(entity_type, None, e, pi_id):
            added.append(_label(entity_type, e))

    for sid in base_ids - cur_ids:
        e = base_map[sid]
        if _in_scope(entity_type, e, None, pi_id):
            removed.append(_label(entity_type, e))

    for sid in base_ids & cur_ids:
        b, c = base_map[sid], cur_map[sid]
        if not _in_scope(entity_type, b, c, pi_id):
            continue
        fields = {
            f: {"from": b.get(f), "to": c.get(f)}
            for f in tracked
            if b.get(f) != c.get(f)
        }
        if fields:
            item = _label(entity_type, c)
            item["fields"] = fields
            changed.append(item)

    return {"added": added, "removed": removed, "changed": changed}


def _total_effort(pbis_map: dict[str, dict], pi_id: str | None) -> float:
    total = 0.0
    for e in pbis_map.values():
        if pi_id is not None and e.get("pi_id") != pi_id:
            continue
        total += e.get("effort") or 0
    return total


def _num(value: float) -> str:
    """Render an effort number without a trailing .0 for whole values."""
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def diff_project_states(
    baseline_project: dict[str, Any],
    current_project: dict[str, Any],
    *,
    snapshot_meta: dict[str, Any],
    pi_id: str | None = None,
) -> dict[str, Any]:
    """Compute a structured diff of ``current`` against ``baseline``.

    ``snapshot_meta`` carries the baseline snapshot's identity
    (``system_id``/``name``/``created_at``/``created_by``). ``pi_id`` scopes the
    diff to a single PI (including items that moved in or out of it).
    """
    base = _flatten(baseline_project)
    cur = _flatten(current_project)

    changes = {t: _diff_collection(t, base[t], cur[t], pi_id) for t in ENTITY_ORDER}

    summary: dict[str, Any] = {
        t: {k: len(changes[t][k]) for k in ("added", "removed", "changed")}
        for t in ENTITY_ORDER
    }
    base_effort = _total_effort(base["pbis"], pi_id)
    cur_effort = _total_effort(cur["pbis"], pi_id)
    summary["total_effort"] = {
        "from": base_effort,
        "to": cur_effort,
        "delta": cur_effort - base_effort,
    }

    if pi_id is not None:
        pi_entity = cur["pis"].get(pi_id) or base["pis"].get(pi_id) or {}
        scope = {"type": "pi", "pi_id": pi_id, "pi_name": pi_entity.get("name")}
    else:
        scope = {"type": "project"}

    # Name lookup for the narrative: map pi_id / swimline_id → friendly names,
    # preferring current state, falling back to baseline.
    lookups = {
        "pi": {**{k: v.get("name") for k, v in base["pis"].items()},
               **{k: v.get("name") for k, v in cur["pis"].items()}},
        "swimline": {**{k: v.get("name") for k, v in base["swimlines"].items()},
                     **{k: v.get("name") for k, v in cur["swimlines"].items()}},
    }

    diff = {
        "baseline_snapshot": snapshot_meta,
        "compared_at": datetime.now(timezone.utc).isoformat(),
        "scope": scope,
        "summary": summary,
        "changes": changes,
        "labels": lookups,
    }
    diff["narrative"] = render_narrative(diff)
    return diff


# ── narrative ────────────────────────────────────────────────────────────────


_ENTITY_SINGULAR = {
    "features": "Feature", "pbis": "PBI", "pis": "PI", "swimlines": "Swimlane",
    "sprints": "Sprint", "groups": "Group", "events": "Event",
}


def _fmt_ref(field: str, value: Any, lookups: dict[str, dict]) -> str:
    """Render a field value for the narrative, resolving id references to names."""
    if value is None:
        if field in ("pi_id", "swimlane_id", "location"):
            return "backlog" if field != "swimlane_id" else "—"
        return "—"
    if field == "pi_id":
        return lookups["pi"].get(value) or "a PI"
    if field == "swimlane_id":
        return lookups["swimline"].get(value) or "a swimlane"
    if field in ("group_id", "story_system_id", "feature_system_id",
                 "parent_feature_system_id", "continued_from_feature_id"):
        return "set" if value else "—"
    if field == "description":
        return "…"
    return str(value)


def _entity_name(entity_type: str, item: dict[str, Any]) -> str:
    if entity_type in ("features", "pbis"):
        uid = item.get("id")
        prefix = f"[{uid}] " if uid is not None else ""
        title = item.get("title") or ""
        return f'{prefix}"{title}"' if title else f"{prefix}(untitled)".strip()
    return f'"{item.get("name", "")}"'


def _narrative_entity_lines(entity_type: str, changes: dict, summary: dict,
                            lookups: dict[str, dict]) -> list[str]:
    singular = _ENTITY_SINGULAR[entity_type]
    lines = [
        "",
        f'{entity_type.capitalize()}: {summary["added"]} added, '
        f'{summary["removed"]} removed, {summary["changed"]} changed.',
    ]
    for item in changes["added"]:
        lines.append(f"  + {singular} {_entity_name(entity_type, item)} added")
    for item in changes["removed"]:
        lines.append(f"  − {singular} {_entity_name(entity_type, item)} removed")
    for item in changes["changed"]:
        deltas = ", ".join(
            f'{field} {_fmt_ref(field, d["from"], lookups)} → '
            f'{_fmt_ref(field, d["to"], lookups)}'
            for field, d in item["fields"].items()
        )
        lines.append(f"  ~ {singular} {_entity_name(entity_type, item)} — {deltas}")
    return lines


def render_narrative(diff: dict[str, Any]) -> str:
    """A compact, human/LLM-readable summary of the diff dict."""
    meta = diff["baseline_snapshot"]
    lookups = diff.get("labels", {"pi": {}, "swimline": {}})
    scope = diff["scope"]
    scope_str = (
        "whole project" if scope["type"] == "project"
        else f'PI "{scope.get("pi_name") or scope.get("pi_id")}"'
    )
    lines: list[str] = [
        f'Comparison against snapshot "{meta.get("name")}" ({meta.get("created_at") or ""}).',
        f"Scope: {scope_str}.",
    ]

    te = diff["summary"]["total_effort"]
    if te["delta"] or te["from"] or te["to"]:
        sign = "+" if te["delta"] >= 0 else "−"
        lines.append(
            f'Effort: {_num(te["from"])} → {_num(te["to"])} ({sign}{_num(abs(te["delta"]))}).'
        )

    total_changes = sum(
        diff["summary"][t][k]
        for t in ENTITY_ORDER for k in ("added", "removed", "changed")
    )
    if total_changes == 0:
        lines.append("No changes since the snapshot.")
        return "\n".join(lines)

    for t in ENTITY_ORDER:
        c = diff["changes"][t]
        if c["added"] or c["removed"] or c["changed"]:
            lines += _narrative_entity_lines(t, c, diff["summary"][t], lookups)

    return "\n".join(lines)
