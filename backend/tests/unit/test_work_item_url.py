"""Unit tests for build_work_item_url.

Mirrors frontend/src/utils/__tests__/workItemUrl.test.ts — keep the two in sync.
"""

from app.services.work_item_url import build_work_item_url

AZURE_DEVOPS_TEMPLATE = "_workitems/edit/{id}"
JIRA_TEMPLATE = "browse/{id}"


def test_builds_azure_devops_url() -> None:
    assert build_work_item_url(
        "https://devops-server.admin.ch/DefaultCollection/ASTRA_ISK",
        AZURE_DEVOPS_TEMPLATE,
        153852,
    ) == "https://devops-server.admin.ch/DefaultCollection/ASTRA_ISK/_workitems/edit/153852"


def test_builds_jira_url() -> None:
    assert build_work_item_url("https://jira.example.com", JIRA_TEMPLATE, 42) == (
        "https://jira.example.com/browse/42"
    )


def test_collapses_trailing_and_leading_slashes() -> None:
    assert build_work_item_url("https://x.test/", "/_workitems/edit/{id}", 7) == (
        "https://x.test/_workitems/edit/7"
    )


def test_replaces_every_id_occurrence() -> None:
    assert build_work_item_url("https://x.test", "a/{id}/b/{id}", 5) == "https://x.test/a/5/b/5"


def test_returns_none_without_base_url() -> None:
    assert build_work_item_url(None, AZURE_DEVOPS_TEMPLATE, 1) is None
    assert build_work_item_url("", AZURE_DEVOPS_TEMPLATE, 1) is None


def test_returns_none_when_template_missing_or_has_no_id() -> None:
    assert build_work_item_url("https://x.test", None, 1) is None
    assert build_work_item_url("https://x.test", "", 1) is None
    assert build_work_item_url("https://x.test", "_workitems/edit/", 1) is None


def test_returns_none_without_item_id() -> None:
    assert build_work_item_url("https://x.test", AZURE_DEVOPS_TEMPLATE, None) is None
