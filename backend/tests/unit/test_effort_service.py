"""Unit tests for effort service functions (services/effort.py)."""
from unittest.mock import MagicMock

import pytest

from app.services.effort import feature_efforts, swimline_efforts


@pytest.mark.asyncio
async def test_swimline_efforts_empty_list_returns_empty_dict():
    db = MagicMock()
    result = await swimline_efforts(db, [])
    assert result == {}


@pytest.mark.asyncio
async def test_feature_efforts_empty_list_returns_empty_dict():
    db = MagicMock()
    result = await feature_efforts(db, [])
    assert result == {}
