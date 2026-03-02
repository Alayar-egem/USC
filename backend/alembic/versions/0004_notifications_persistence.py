"""add persistent notifications tables

Revision ID: 0004_notifications_persistence
Revises: 0003_orders_hardening_audit
Create Date: 2026-02-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_notifications_persistence"
down_revision = "0003_orders_hardening_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_event",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("domain", sa.String(length=32), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("resource_type", sa.String(length=64), nullable=False),
        sa.Column("resource_id", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_notification_event_created_at", "notification_event", ["created_at"])

    op.create_table(
        "notification_user_state",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("notification_id", sa.BigInteger(), sa.ForeignKey("notification_event.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("accounts_user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("notification_id", "user_id", name="uq_notification_user_state_notification_user"),
    )
    op.create_index(
        "ix_notification_user_state_user_is_read_created_at",
        "notification_user_state",
        ["user_id", "is_read", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_notification_user_state_user_is_read_created_at", table_name="notification_user_state")
    op.drop_table("notification_user_state")
    op.drop_index("ix_notification_event_created_at", table_name="notification_event")
    op.drop_table("notification_event")
