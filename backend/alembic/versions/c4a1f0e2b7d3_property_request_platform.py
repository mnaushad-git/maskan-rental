"""property request platform: PropertyRequest domain, matching, mediator responses, scoring config

Revision ID: c4a1f0e2b7d3
Revises: b2e0d5f1a933
Create Date: 2026-08-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c4a1f0e2b7d3'
down_revision: Union[str, None] = 'b2e0d5f1a933'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "property_requests",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("locale", sa.String(5), nullable=False, server_default="en"),
        sa.Column("transaction_type", sa.String(20), nullable=True),
        sa.Column("property_category", sa.String(50), nullable=True),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("preferred_districts", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("excluded_districts", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("min_price", sa.Float, nullable=True),
        sa.Column("max_price", sa.Float, nullable=True),
        sa.Column("bedrooms_min", sa.Integer, nullable=True),
        sa.Column("bedrooms_max", sa.Integer, nullable=True),
        sa.Column("bathrooms_min", sa.Integer, nullable=True),
        sa.Column("bathrooms_max", sa.Integer, nullable=True),
        sa.Column("min_area_sq_m", sa.Integer, nullable=True),
        sa.Column("max_area_sq_m", sa.Integer, nullable=True),
        sa.Column("furnishing", sa.String(50), nullable=True),
        sa.Column("required_amenities", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("preferred_amenities", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("property_age_preference", sa.String(50), nullable=True),
        sa.Column("availability_date", sa.Date, nullable=True),
        sa.Column("move_in_date", sa.Date, nullable=True),
        sa.Column("rental_payment_frequency", sa.String(30), nullable=True),
        sa.Column("mediator_preference", sa.String(20), nullable=False, server_default="either"),
        sa.Column("verified_only", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("max_commute_minutes", sa.Integer, nullable=True),
        sa.Column("commute_destination_name", sa.String(150), nullable=True),
        sa.Column("commute_destination_lat", sa.Float, nullable=True),
        sa.Column("commute_destination_lng", sa.Float, nullable=True),
        sa.Column("school_preference", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("hospital_preference", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("lifestyle_preferences", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("family_size", sa.Integer, nullable=True),
        sa.Column("household_type", sa.String(30), nullable=True),
        sa.Column("accessibility_requirements", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("pet_preference", sa.String(30), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("must_have_fields", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("nice_to_have_fields", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("flexible_fields", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("priority_weighting", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("ai_extracted_criteria", postgresql.JSONB, nullable=True),
        sa.Column("ai_confidence", sa.Float, nullable=True),
        sa.Column("ai_trace_id", sa.String(64), nullable=True),
        sa.Column("clarification_status", sa.String(20), nullable=False, server_default="none"),
        sa.Column("clarification_rounds", sa.Integer, nullable=False, server_default="0"),
        sa.Column("matching_enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("mediator_responses_enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("alert_frequency", sa.String(20), nullable=False, server_default="instant"),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("expiry_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_matched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_customer_activity_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("filter_schema_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("canonical_filters", postgresql.JSONB, nullable=True),
        sa.Column("revision_number", sa.Integer, nullable=False, server_default="1"),
    )
    op.create_index("ix_property_requests_user_id", "property_requests", ["user_id"])
    op.create_index("ix_property_requests_status", "property_requests", ["status"])
    op.create_index("ix_property_requests_city", "property_requests", ["city"])
    op.create_index("ix_property_requests_transaction_type", "property_requests", ["transaction_type"])
    op.create_index("ix_property_requests_expiry_date", "property_requests", ["expiry_date"])
    op.create_index("ix_property_requests_matching_enabled", "property_requests", ["matching_enabled"])
    op.create_index("ix_property_requests_created_at", "property_requests", ["created_at"])

    op.create_table(
        "property_request_revisions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("request_id", sa.Integer, sa.ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision_number", sa.Integer, nullable=False),
        sa.Column("snapshot", postgresql.JSONB, nullable=False),
        sa.Column("changed_fields", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("change_reason", sa.String(50), nullable=False),
        sa.Column("created_by_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_property_request_revisions_request_id", "property_request_revisions", ["request_id"])
    op.create_index("ix_property_request_revisions_created_at", "property_request_revisions", ["created_at"])
    op.create_unique_constraint("uq_property_request_revision", "property_request_revisions", ["request_id", "revision_number"])

    op.create_table(
        "property_request_clarifications",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("request_id", sa.Integer, sa.ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("round_number", sa.Integer, nullable=False),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("question_locale", sa.String(5), nullable=False, server_default="en"),
        sa.Column("field_hint", sa.String(50), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("answer", sa.Text, nullable=True),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_property_request_clarifications_request_id", "property_request_clarifications", ["request_id"])
    op.create_index("ix_property_request_clarifications_status", "property_request_clarifications", ["status"])

    op.create_table(
        "property_request_activities",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("request_id", sa.Integer, sa.ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_type", sa.String(20), nullable=False),
        sa.Column("actor_id", sa.Integer, nullable=True),
        sa.Column("activity_type", sa.String(50), nullable=False),
        sa.Column("payload", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_property_request_activities_request_id", "property_request_activities", ["request_id"])
    op.create_index("ix_property_request_activities_created_at", "property_request_activities", ["created_at"])

    op.create_table(
        "property_request_matches",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("request_id", sa.Integer, sa.ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("property_id", sa.Integer, sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False),
        sa.Column("match_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("hard_pass", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("must_have_failures", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("flexible_coverage", sa.Float, nullable=False, server_default="0"),
        sa.Column("preference_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("price_fit_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("area_fit_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("commute_fit_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("listing_quality_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("confidence", sa.Float, nullable=False, server_default="0"),
        sa.Column("match_reasons", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("trade_offs", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("rejection_reasons", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("match_version", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="new"),
        sa.Column("event_id", sa.String(64), nullable=True),
        sa.Column("trace_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("request_id", "property_id", name="uq_property_request_match"),
    )
    op.create_index("ix_property_request_matches_request_id", "property_request_matches", ["request_id"])
    op.create_index("ix_property_request_matches_property_id", "property_request_matches", ["property_id"])
    op.create_index("ix_property_request_matches_score", "property_request_matches", ["match_score"])
    op.create_index("ix_property_request_matches_status", "property_request_matches", ["status"])
    op.create_index("ix_property_request_matches_created_at", "property_request_matches", ["created_at"])

    op.create_table(
        "property_request_mediator_responses",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("request_id", sa.Integer, sa.ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mediator_id", sa.Integer, sa.ForeignKey("mediators.id", ondelete="CASCADE"), nullable=False),
        sa.Column("response_type", sa.String(30), nullable=False),
        sa.Column("message", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_property_request_mediator_responses_request_id", "property_request_mediator_responses", ["request_id"])
    op.create_index("ix_property_request_mediator_responses_mediator_id", "property_request_mediator_responses", ["mediator_id"])
    op.create_index("ix_property_request_mediator_responses_status", "property_request_mediator_responses", ["status"])

    op.create_table(
        "property_request_mediator_response_properties",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("response_id", sa.Integer, sa.ForeignKey("property_request_mediator_responses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_id", sa.Integer, sa.ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("property_id", sa.Integer, sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("request_id", "property_id", name="uq_property_request_submitted_property"),
    )
    op.create_index("ix_prr_mediator_response_properties_response_id", "property_request_mediator_response_properties", ["response_id"])
    op.create_index("ix_prr_mediator_response_properties_request_id", "property_request_mediator_response_properties", ["request_id"])
    op.create_index("ix_prr_mediator_response_properties_property_id", "property_request_mediator_response_properties", ["property_id"])

    op.create_table(
        "property_request_scoring_configs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("version", sa.Integer, nullable=False, unique=True),
        sa.Column("weights", postgresql.JSONB, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_by_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_property_request_scoring_configs_is_active", "property_request_scoring_configs", ["is_active"])

    # Seed version 1 as the active config so get_active_weights() has a row
    # to read from day one (matches app.core.property_request.scoring.DEFAULT_WEIGHTS).
    op.execute(
        """
        INSERT INTO property_request_scoring_configs (version, weights, is_active, created_at)
        VALUES (
            1,
            '{"hard_fit": 0.30, "location_commute": 0.20, "budget_fit": 0.15, "property_specs": 0.15, "lifestyle_area": 0.10, "listing_quality": 0.05, "user_behavior": 0.05}'::jsonb,
            true,
            now()
        )
        """
    )


def downgrade() -> None:
    op.drop_table("property_request_mediator_response_properties")
    op.drop_table("property_request_mediator_responses")
    op.drop_table("property_request_matches")
    op.drop_table("property_request_activities")
    op.drop_table("property_request_clarifications")
    op.drop_table("property_request_revisions")
    op.drop_table("property_requests")
    op.drop_table("property_request_scoring_configs")
