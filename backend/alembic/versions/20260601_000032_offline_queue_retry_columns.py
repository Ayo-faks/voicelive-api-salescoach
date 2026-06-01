"""Add retry bookkeeping columns to learning_offline_queue.

The offline queue was write-only: ``RalphXAPISink._queue_failed`` enqueued
failed xAPI emissions but nothing drained them back out. The server-side
:class:`~src.learning.offline_queue_drainer.OfflineQueueDrainer` needs durable
retry bookkeeping, so add:

* ``attempts`` — number of replay attempts already made (bounded retry).
* ``last_error`` — the most recent failure reason (operator triage / dead-letter).

Both are additive and nullable-safe (``attempts`` defaults to 0), so the
upgrade is backwards compatible with the existing INSERT path.
"""

from __future__ import annotations

from alembic import op

revision = "20260601_000032"
down_revision = "20260529_000031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE learning_offline_queue "
        "ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0"
    )
    op.execute(
        "ALTER TABLE learning_offline_queue "
        "ADD COLUMN IF NOT EXISTS last_error TEXT"
    )
    # Drainer pulls retryable rows ordered by updated_at; an index that also
    # carries attempts keeps the bounded-retry filter cheap.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_learning_offline_queue_status_attempts "
        "ON learning_offline_queue (status, attempts, updated_at)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_learning_offline_queue_status_attempts")
    op.execute("ALTER TABLE learning_offline_queue DROP COLUMN IF EXISTS last_error")
    op.execute("ALTER TABLE learning_offline_queue DROP COLUMN IF EXISTS attempts")
