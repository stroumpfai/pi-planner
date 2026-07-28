"""Self-contained HTML rendering of a snapshot diff.

Twin of ``pi_dashboard.render_dashboard_html``: takes the diff dict produced by
``snapshot_diff.diff_project_states`` and renders a single, dependency-free page
(inline CSS/JS, no external calls) that can be handed to an MCP client as a
resource string *or* opened directly in a browser. As with the PI dashboard, an
optional inert auto-refresh script re-fetches the page when actually served over
HTTP.

Rendering is kept strictly downstream of the diff dict so the JSON and HTML views
never drift.
"""

from __future__ import annotations

import html
from typing import Any

from app.services.snapshot_diff import ENTITY_ORDER, _fmt_ref, _num

# Human headings per entity type (diff keys are plural/lowercase).
_ENTITY_HEADING: dict[str, str] = {
    "features": "Features",
    "pbis": "PBIs",
    "pis": "PIs",
    "swimlines": "Swimlanes",
    "sprints": "Sprints",
    "groups": "Groups",
    "events": "Events",
}


def _esc(text: Any) -> str:
    return html.escape("" if text is None else str(text), quote=True)


def _entity_title(entity_type: str, item: dict[str, Any]) -> str:
    if entity_type in ("features", "pbis"):
        uid = item.get("id")
        prefix = f"[{uid}] " if uid is not None else ""
        return f"{prefix}{item.get('title') or '(untitled)'}"
    return item.get("name") or "(unnamed)"


def _render_field_deltas(fields: dict[str, dict], lookups: dict[str, dict]) -> str:
    rows = []
    for field, d in fields.items():
        rows.append(
            f'<div class="delta"><span class="fname">{_esc(field)}</span>'
            f'<span class="from">{_esc(_fmt_ref(field, d["from"], lookups))}</span>'
            f'<span class="arrow">→</span>'
            f'<span class="to">{_esc(_fmt_ref(field, d["to"], lookups))}</span></div>'
        )
    return "".join(rows)


def _render_entity_section(entity_type: str, changes: dict, lookups: dict[str, dict]) -> str:
    added, removed, changed = changes["added"], changes["removed"], changes["changed"]
    if not (added or removed or changed):
        return ""

    items_html = []
    for item in added:
        items_html.append(
            f'<li class="row added"><span class="tag">+ added</span>'
            f'<span class="name">{_esc(_entity_title(entity_type, item))}</span></li>'
        )
    for item in removed:
        items_html.append(
            f'<li class="row removed"><span class="tag">− removed</span>'
            f'<span class="name">{_esc(_entity_title(entity_type, item))}</span></li>'
        )
    for item in changed:
        items_html.append(
            f'<li class="row changed"><span class="tag">~ changed</span>'
            f'<span class="name">{_esc(_entity_title(entity_type, item))}</span>'
            f'<div class="deltas">{_render_field_deltas(item["fields"], lookups)}</div></li>'
        )

    heading = _ENTITY_HEADING.get(entity_type, entity_type.capitalize())
    count = f"{len(added)}+ · {len(removed)}− · {len(changed)}~"
    return f"""
<section>
  <h2>{_esc(heading)} <span class="count">{count}</span></h2>
  <ul class="rows">{"".join(items_html)}</ul>
</section>"""


def _render_header(diff: dict[str, Any]) -> str:
    meta = diff["baseline_snapshot"]
    scope = diff["scope"]
    scope_str = (
        "Whole project" if scope["type"] == "project"
        else f'PI: {_esc(scope.get("pi_name") or scope.get("pi_id"))}'
    )
    te = diff["summary"]["total_effort"]
    delta = te["delta"]
    sign = "+" if delta >= 0 else "−"
    if delta > 0:
        cls = "up"
    elif delta < 0:
        cls = "down"
    else:
        cls = "flat"
    effort = (
        f'<span class="effort {cls}">{_num(te["from"])} → {_num(te["to"])} '
        f'({sign}{_num(abs(delta))})</span>'
    )
    return f"""
<header>
  <div class="titlebar">
    <h1>Changes since snapshot</h1>
    <span class="badge">{scope_str}</span>
  </div>
  <div class="meta">
    <span class="snap">“{_esc(meta.get("name"))}” · {_esc(meta.get("created_at"))}
      {f'· by {_esc(meta.get("created_by"))}' if meta.get("created_by") else ""}</span>
    {effort}
  </div>
</header>"""


def _render_empty() -> str:
    return '<section class="empty"><p>No changes since this snapshot.</p></section>'


def _render_refresh_script(refresh_seconds: int) -> str:
    if refresh_seconds <= 0:
        return ""
    # Inert unless actually served over HTTP (see pi_dashboard for the rationale).
    return f"""<script>
(function () {{
  var P = location.protocol;
  if (P !== "http:" && P !== "https:") return;
  var ms = {refresh_seconds} * 1000;
  setInterval(async function () {{
    try {{
      var res = await fetch(location.href, {{ cache: "no-store" }});
      if (!res.ok) return;
      var doc = new DOMParser().parseFromString(await res.text(), "text/html");
      document.body.innerHTML = doc.body.innerHTML;
    }} catch (e) {{
      location.reload();
    }}
  }}, ms);
}})();
</script>"""


def render_diff_html(diff: dict[str, Any], refresh_seconds: int = 0) -> str:
    """Render the diff dict as a self-contained HTML page."""
    lookups = diff.get("labels", {"pi": {}, "swimline": {}})
    sections = [_render_entity_section(t, diff["changes"][t], lookups) for t in ENTITY_ORDER]
    sections = [s for s in sections if s]
    body = "\n".join(
        [_render_header(diff)]
        + (sections if sections else [_render_empty()])
    )
    return _PAGE.format(css=_CSS, body=body, script=_render_refresh_script(refresh_seconds))


_CSS = """
:root {
  --bg: #f8fafc; --card: #ffffff; --ink: #1f2937; --muted: #6b7280;
  --line: #e2e8f0; --add: #16a34a; --rem: #dc2626; --chg: #d97706;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a; --card: #1e293b; --ink: #e2e8f0; --muted: #94a3b8;
    --line: #334155; --add: #4ade80; --rem: #f87171; --chg: #fbbf24;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 1.5rem; background: var(--bg); color: var(--ink);
  font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
header { margin-bottom: 1.5rem; }
.titlebar { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
h1 { font-size: 1.4rem; margin: 0; }
h2 {
  font-size: .8rem; text-transform: uppercase; letter-spacing: .05em;
  color: var(--muted); margin: 0 0 .6rem; display: flex; gap: .5rem; align-items: baseline;
}
h2 .count { font-size: .7rem; color: var(--muted); letter-spacing: 0; }
.badge {
  font-size: .7rem; text-transform: uppercase; letter-spacing: .04em;
  padding: .15rem .5rem; border-radius: 999px; border: 1px solid var(--line);
  color: var(--muted);
}
.meta { display: flex; align-items: center; gap: 1rem; margin-top: .5rem; flex-wrap: wrap; }
.snap { color: var(--muted); }
.effort { font-weight: 600; padding: .1rem .5rem; border-radius: 6px; border: 1px solid var(--line); }
.effort.up { color: var(--add); border-color: var(--add); }
.effort.down { color: var(--rem); border-color: var(--rem); }
section {
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 1rem 1.15rem; margin-bottom: 1.25rem;
}
section.empty { color: var(--muted); }
.rows { list-style: none; margin: 0; padding: 0; }
.row {
  padding: .5rem 0; border-top: 1px solid var(--line);
  display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem;
}
.row:first-child { border-top: none; }
.tag {
  font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .03em;
  padding: .1rem .45rem; border-radius: 999px; white-space: nowrap;
}
.added .tag { color: var(--add); border: 1px solid var(--add); }
.removed .tag { color: var(--rem); border: 1px solid var(--rem); }
.changed .tag { color: var(--chg); border: 1px solid var(--chg); }
.name { font-weight: 600; }
.removed .name { text-decoration: line-through; color: var(--muted); }
.deltas { flex-basis: 100%; margin: .35rem 0 0 .5rem; display: flex; flex-direction: column; gap: .2rem; }
.delta { display: flex; align-items: baseline; gap: .4rem; font-size: .82rem; }
.delta .fname { color: var(--muted); min-width: 8rem; }
.delta .from { color: var(--rem); }
.delta .to { color: var(--add); }
.delta .arrow { color: var(--muted); }
"""

_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snapshot diff</title>
<style>{css}</style>
</head>
<body>
{body}
{script}
</body>
</html>"""
