"""Placeholder test to verify pytest infrastructure works."""


def test_infrastructure():
    """Test that the test infrastructure is set up correctly."""
    assert 1 + 1 == 2


def test_project_root(project_root):
    """Test that project_root fixture returns valid path."""
    assert project_root.exists()
    assert (project_root / "CLAUDE.md").exists()
