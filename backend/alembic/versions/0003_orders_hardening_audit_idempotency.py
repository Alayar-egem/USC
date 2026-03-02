"""orders hardening: audit, idempotency, state checks, fulfillment columns

Revision ID: 0003_orders_hardening_audit
Revises: 0002_auth_refresh_session
Create Date: 2026-02-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_orders_hardening_audit"
down_revision = "0002_auth_refresh_session"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_event",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("accounts_user.id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "actor_company_id", sa.BigInteger(), sa.ForeignKey("companies_company.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("domain", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("resource_type", sa.String(length=64), nullable=False),
        sa.Column("resource_id", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("request_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("outcome", sa.String(length=32), nullable=False, server_default="success"),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
    )
    op.create_index("ix_audit_event_occurred_at", "audit_event", ["occurred_at"])
    op.create_index("ix_audit_event_domain_action", "audit_event", ["domain", "action"])
    op.create_index("ix_audit_event_actor_user_id", "audit_event", ["actor_user_id"])

    op.create_table(
        "idempotency_record",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("scope", sa.String(length=128), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("body_hash", sa.String(length=64), nullable=False),
        sa.Column("response_status", sa.BigInteger(), nullable=True),
        sa.Column("response_body_json", sa.Text(), nullable=True),
        sa.Column("resource_type", sa.String(length=64), nullable=False),
        sa.Column("resource_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("scope", "idempotency_key", name="uq_idempotency_scope_key"),
    )
    op.create_index("ix_idempotency_expires_at", "idempotency_record", ["expires_at"])

    op.add_column(
        "orders_orderitem",
        sa.Column("fulfilled_qty", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "orders_orderitem",
        sa.Column("undelivered_qty", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.create_check_constraint(
        "ck_orders_item_fulfillment_bounds",
        "orders_orderitem",
        "fulfilled_qty >= 0 AND undelivered_qty >= 0 AND fulfilled_qty + undelivered_qty <= qty",
    )

    # Normalize statuses before introducing strict CHECK constraints.
    op.execute(
        """
        UPDATE orders_order
        SET status = CASE
            WHEN UPPER(status) = 'CREATED' THEN 'PENDING'
            WHEN UPPER(status) IN ('PENDING','CONFIRMED','DELIVERING','PARTIALLY_DELIVERED','DELIVERED','CANCELLED','FAILED')
                THEN UPPER(status)
            ELSE 'PENDING'
        END
        """
    )
    op.execute(
        """
        UPDATE delivery_deliveryassignment
        SET status = CASE
            WHEN UPPER(status) IN ('ASSIGNED','PICKED_UP','ON_THE_WAY','PARTIALLY_DELIVERED','DELIVERED','FAILED','CANCELLED')
                THEN UPPER(status)
            ELSE 'ASSIGNED'
        END
        """
    )

    op.create_check_constraint(
        "ck_orders_order_status",
        "orders_order",
        "status IN ('PENDING','CONFIRMED','DELIVERING','PARTIALLY_DELIVERED','DELIVERED','CANCELLED','FAILED')",
    )
    op.create_check_constraint(
        "ck_delivery_assignment_status",
        "delivery_deliveryassignment",
        "status IN ('ASSIGNED','PICKED_UP','ON_THE_WAY','PARTIALLY_DELIVERED','DELIVERED','FAILED','CANCELLED')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_delivery_assignment_status", "delivery_deliveryassignment", type_="check")
    op.drop_constraint("ck_orders_order_status", "orders_order", type_="check")

    op.drop_constraint("ck_orders_item_fulfillment_bounds", "orders_orderitem", type_="check")
    op.drop_column("orders_orderitem", "undelivered_qty")
    op.drop_column("orders_orderitem", "fulfilled_qty")

    op.drop_index("ix_idempotency_expires_at", table_name="idempotency_record")
    op.drop_table("idempotency_record")

    op.drop_index("ix_audit_event_actor_user_id", table_name="audit_event")
    op.drop_index("ix_audit_event_domain_action", table_name="audit_event")
    op.drop_index("ix_audit_event_occurred_at", table_name="audit_event")
    op.drop_table("audit_event")
