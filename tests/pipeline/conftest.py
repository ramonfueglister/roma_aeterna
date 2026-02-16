"""Pytest configuration and shared fixtures for pipeline tests."""

import os
import sys
import tempfile
from pathlib import Path

import pytest

# Add tools directory to path so pipeline scripts can be imported
TOOLS_DIR = Path(__file__).resolve().parent.parent.parent / "tools"
sys.path.insert(0, str(TOOLS_DIR))

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


@pytest.fixture
def project_root() -> Path:
    """Return the project root directory."""
    return PROJECT_ROOT


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    """Return a temporary data directory for test outputs."""
    d = tmp_path / "data"
    d.mkdir()
    (d / "raw").mkdir()
    (d / "processed").mkdir()
    (d / "chunks").mkdir()
    (d / "meta").mkdir()
    return d


@pytest.fixture
def tools_dir() -> Path:
    """Return the tools directory."""
    return TOOLS_DIR
