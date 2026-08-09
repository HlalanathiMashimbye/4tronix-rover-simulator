"""Shared pytest configuration for the satellite test-suite.

Two of these files drive a real browser through Playwright, which is a heavy
dependency that is not needed to run the other 200 tests. Without this, a
plain `pytest tests` on a machine that has not installed it fails at
COLLECTION - an ImportError, before a single test runs - so the whole suite
looks broken rather than "two optional files skipped". That was papered over
by passing `--ignore` flags by hand, which meant the real command differed
from the documented one and was easy to get wrong in CI.

Skipping at collection time keeps `pytest tests` correct everywhere: it runs
everything it can, and says plainly what it left out.
"""

import pytest

collect_ignore = []

try:  # pragma: no cover - trivial import probe
    import playwright.sync_api  # noqa: F401
except ImportError:
    collect_ignore = ['test_blockly_codegen.py', 'test_status_page.py']


def pytest_report_header(config):
    if collect_ignore:
        return (
            'playwright not installed: skipping browser tests '
            f'({", ".join(collect_ignore)})'
        )
    return None
