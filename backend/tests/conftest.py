"""Shared pytest configuration.

The production default for ``DATABASE_BACKEND`` is ``postgres`` (see
``src/config.py``) because every deployed environment provisions Postgres via
Bicep. Local unit tests, however, must not require a Postgres DSN, so we pin
the backend to the in-process SQLite path before any application module is
imported. Tests that exercise the Postgres adapter explicitly set
``DATABASE_BACKEND=postgres`` with a live ``DATABASE_URL``.
"""

import os

os.environ.setdefault("DATABASE_BACKEND", "sqlite")
