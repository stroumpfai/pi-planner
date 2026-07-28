"""Work-item deep links: project base URL + path template + item id.

Mirrors `frontend/src/utils/workItemUrl.ts` — keep the two in sync.

Both inputs are already validated by `app.schemas.project` (the base is an
http(s) URL with a netloc, the template a relative path containing `{id}` with
no scheme and no whitespace), so the result cannot introduce a new scheme or
host.
"""


def build_work_item_url(
    base_url: str | None,
    template: str | None,
    item_id: int | None,
) -> str | None:
    """Build a work-item deep link, or None when any part is missing.

    The link is effectively off until the project is configured, and items
    without a user id have no link.
    """
    if not base_url or not template or item_id is None:
        return None
    if "{id}" not in template:
        return None
    base = base_url.rstrip("/")
    path = template.replace("{id}", str(item_id)).lstrip("/")
    return f"{base}/{path}"
