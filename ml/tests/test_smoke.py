"""Smoke test: the package and its CLI modules import cleanly."""
def test_imports():
    import lightgbm, numpy, pandas, sklearn  # noqa: F401
