"""Deterministic checklist/progress/Next Best Action/readiness engine
(Prompt 3). See docs/implementation/mymakan-transaction-workspace.md
("Checklist methodology" / "Progress methodology"). Pure-function unit
tests — mirrors test_viewing_checklist.py's convention of building
transient (unpersisted) ORM instances directly, no DB session needed since
`transaction_progress.py` never queries anything itself.
"""
from datetime import datetime, timezone
from decimal import Decimal

from app.models.property_transaction import PropertyTransaction, TransactionDocument
from app.models.user import User
from app.services import transaction_progress as tp


def _txn(transaction_type="rent", confirmed=False, full_name="Sara", phone="0500000000") -> PropertyTransaction:
    txn = PropertyTransaction(
        reference="MYM-00001",
        property_id=1,
        transaction_type=transaction_type,
        customer_user_id=1,
        negotiation_id=1,
        agreed_amount=Decimal("1000"),
        status="initiated",
        progress_percentage=0,
        customer_info_confirmed_at=datetime.now(timezone.utc) if confirmed else None,
    )
    txn.customer = User(email="customer@example.com", full_name=full_name, phone=phone)
    return txn


def _doc(id, *, required=True, status="not_uploaded", label="Document") -> TransactionDocument:
    doc = TransactionDocument(document_type="doc", label=label, required=required, status=status)
    doc.id = id
    return doc


# Two required docs (mirrors the real rent/sale templates' 2-required shape)
# plus one optional, unless a test says otherwise.
def _two_required_docs(status_a="not_uploaded", status_b="not_uploaded"):
    return [
        _doc(1, required=True, status=status_a, label="National ID"),
        _doc(2, required=True, status=status_b, label="Proof of Income"),
        _doc(3, required=False, status="not_uploaded", label="Supporting Document"),
    ]


# ── Checklist state combinations ─────────────────────────────────────────

def test_checklist_no_docs_no_info_all_pending_except_offer():
    txn = _txn(full_name=None, phone=None)
    docs = _two_required_docs()
    steps = {s.key: s for s in tp.compute_checklist(txn, docs)}

    assert steps["offer_agreed"].status == tp.STEP_DONE
    assert steps["customer_info"].status == tp.STEP_PENDING
    assert steps["customer_info"].detail == "0/2"
    assert steps["documents_submitted"].status == tp.STEP_PENDING
    assert steps["documents_submitted"].detail == "0/2"
    assert steps["mediator_review"].status == tp.STEP_PENDING
    assert steps["mediator_review"].detail == "0/2"
    assert steps["terms_reconfirmed"].status == tp.STEP_PENDING
    assert steps["ready_for_next_step"].status == tp.STEP_PENDING


def test_checklist_partial_customer_info_is_in_progress():
    txn = _txn(full_name="Sara", phone=None)
    docs = _two_required_docs()
    steps = {s.key: s for s in tp.compute_checklist(txn, docs)}

    assert steps["customer_info"].status == tp.STEP_IN_PROGRESS
    assert steps["customer_info"].detail == "1/2"


def test_checklist_partial_documents_in_progress():
    txn = _txn()
    docs = _two_required_docs(status_a="uploaded", status_b="not_uploaded")
    steps = {s.key: s for s in tp.compute_checklist(txn, docs)}

    assert steps["documents_submitted"].status == tp.STEP_IN_PROGRESS
    assert steps["documents_submitted"].detail == "1/2"
    # Mediator review has something to look at (1 submitted) but nothing
    # accepted yet.
    assert steps["mediator_review"].status == tp.STEP_IN_PROGRESS
    assert steps["mediator_review"].detail == "0/2"


def test_checklist_all_docs_submitted_pending_review():
    txn = _txn()
    docs = _two_required_docs(status_a="uploaded", status_b="uploaded")
    steps = {s.key: s for s in tp.compute_checklist(txn, docs)}

    assert steps["documents_submitted"].status == tp.STEP_DONE
    assert steps["documents_submitted"].detail is None
    assert steps["mediator_review"].status == tp.STEP_IN_PROGRESS
    assert steps["mediator_review"].detail == "0/2"


def test_checklist_accepted_docs_but_unconfirmed_info():
    txn = _txn(confirmed=False)
    docs = _two_required_docs(status_a="accepted", status_b="accepted")
    steps = {s.key: s for s in tp.compute_checklist(txn, docs)}

    assert steps["documents_submitted"].status == tp.STEP_DONE
    assert steps["mediator_review"].status == tp.STEP_DONE
    assert steps["terms_reconfirmed"].status == tp.STEP_PENDING
    assert steps["ready_for_next_step"].status == tp.STEP_PENDING


def test_checklist_fully_ready():
    txn = _txn(confirmed=True)
    docs = _two_required_docs(status_a="accepted", status_b="accepted")
    steps = {s.key: s for s in tp.compute_checklist(txn, docs)}

    assert steps["customer_info"].status == tp.STEP_DONE
    assert steps["documents_submitted"].status == tp.STEP_DONE
    assert steps["mediator_review"].status == tp.STEP_DONE
    assert steps["terms_reconfirmed"].status == tp.STEP_DONE
    assert steps["ready_for_next_step"].status == tp.STEP_DONE
    assert steps["ready_for_next_step"].label == "Ready for Rental Contract Process"


def test_checklist_needs_update_document_keeps_mediator_review_incomplete():
    txn = _txn()
    docs = _two_required_docs(status_a="needs_update", status_b="accepted")
    steps = {s.key: s for s in tp.compute_checklist(txn, docs)}

    assert steps["documents_submitted"].status == tp.STEP_DONE  # both were submitted at least once
    assert steps["mediator_review"].status == tp.STEP_IN_PROGRESS
    assert steps["mediator_review"].detail == "1/2"


def test_terms_reconfirmed_step_uses_exact_information_confirmation_label():
    txn = _txn()
    steps = {s.key: s for s in tp.compute_checklist(txn, _two_required_docs())}
    assert steps["terms_reconfirmed"].label == "Information Confirmation"


# ── progress_percentage ──────────────────────────────────────────────────

def test_progress_percentage_only_offer_agreed():
    txn = _txn(full_name=None, phone=None)
    docs = _two_required_docs()
    assert tp.compute_progress_percentage(txn, docs) == 10


def test_progress_percentage_customer_info_done():
    txn = _txn()
    docs = _two_required_docs()
    assert tp.compute_progress_percentage(txn, docs) == 25  # 10 + 15


def test_progress_percentage_half_documents_submitted():
    txn = _txn()
    docs = _two_required_docs(status_a="uploaded", status_b="not_uploaded")
    # 10 (offer) + 15 (info) + 25*0.5 (docs) + 25*0 (review) = 37.5 -> 38
    assert tp.compute_progress_percentage(txn, docs) == 38


def test_progress_percentage_all_docs_submitted_none_accepted():
    txn = _txn()
    docs = _two_required_docs(status_a="uploaded", status_b="uploaded")
    # 10 + 15 + 25 + 0 = 50
    assert tp.compute_progress_percentage(txn, docs) == 50


def test_progress_percentage_all_accepted_unconfirmed():
    txn = _txn(confirmed=False)
    docs = _two_required_docs(status_a="accepted", status_b="accepted")
    # 10 + 15 + 25 + 25 + 0 (terms) + 0 (ready bonus, not fully ready) = 75
    assert tp.compute_progress_percentage(txn, docs) == 75


def test_progress_percentage_fully_ready_is_100():
    txn = _txn(confirmed=True)
    docs = _two_required_docs(status_a="accepted", status_b="accepted")
    assert tp.compute_progress_percentage(txn, docs) == 100


# ── Next Best Action priority ────────────────────────────────────────────

def test_nba_incomplete_profile_outranks_everything():
    txn = _txn(full_name=None, phone=None, confirmed=True)
    docs = _two_required_docs(status_a="accepted", status_b="accepted")
    action = tp.compute_next_best_action(txn, docs)
    assert action.key == "complete_profile_information"


def test_nba_upload_missing_document_outranks_review_update_request():
    txn = _txn()
    # doc 1 missing, doc 2 needs_update — upload_missing must win per the
    # brief's own documented ordering ("upload missing document" >
    # "review mediator's update request").
    docs = _two_required_docs(status_a="not_uploaded", status_b="needs_update")
    action = tp.compute_next_best_action(txn, docs)
    assert action.key == "upload_missing_document"
    assert "National ID" in action.message


def test_nba_missing_document_tie_break_picks_lowest_id():
    txn = _txn()
    docs = _two_required_docs(status_a="not_uploaded", status_b="not_uploaded")
    action = tp.compute_next_best_action(txn, docs)
    assert action.key == "upload_missing_document"
    assert "National ID" in action.message  # id=1, lower than id=2's "Proof of Income"


def test_nba_review_update_request_when_no_missing_docs():
    txn = _txn()
    docs = _two_required_docs(status_a="accepted", status_b="needs_update")
    action = tp.compute_next_best_action(txn, docs)
    assert action.key == "review_update_request"
    assert "Proof of Income" in action.message


def test_nba_needs_update_tie_break_picks_lowest_id():
    txn = _txn()
    docs = _two_required_docs(status_a="needs_update", status_b="needs_update")
    action = tp.compute_next_best_action(txn, docs)
    assert action.key == "review_update_request"
    assert "National ID" in action.message


def test_nba_await_mediator_review_when_submitted_but_not_reviewed():
    txn = _txn()
    docs = _two_required_docs(status_a="uploaded", status_b="uploaded")
    action = tp.compute_next_best_action(txn, docs)
    assert action.key == "await_mediator_review"


def test_nba_confirm_information_after_review_complete():
    txn = _txn(confirmed=False)
    docs = _two_required_docs(status_a="accepted", status_b="accepted")
    action = tp.compute_next_best_action(txn, docs)
    assert action.key == "confirm_information"


def test_nba_ready_when_everything_done():
    txn = _txn(confirmed=True, transaction_type="rent")
    docs = _two_required_docs(status_a="accepted", status_b="accepted")
    action = tp.compute_next_best_action(txn, docs)
    assert action.key == "ready"
    assert "Ready for Rental Contract Process" in action.message


# ── Readiness label transitions ──────────────────────────────────────────

def test_readiness_not_ready_when_documents_incomplete():
    txn = _txn()
    docs = _two_required_docs()
    assert tp.compute_readiness_label(txn, docs) == tp.READINESS_NOT_READY


def test_readiness_not_ready_while_review_incomplete():
    txn = _txn()
    docs = _two_required_docs(status_a="uploaded", status_b="uploaded")
    assert tp.compute_readiness_label(txn, docs) == tp.READINESS_NOT_READY


def test_readiness_almost_ready_once_review_done_but_unconfirmed():
    txn = _txn(confirmed=False)
    docs = _two_required_docs(status_a="accepted", status_b="accepted")
    assert tp.compute_readiness_label(txn, docs) == tp.READINESS_ALMOST_READY


def test_readiness_ready_rent_wording():
    txn = _txn(confirmed=True, transaction_type="rent")
    docs = _two_required_docs(status_a="accepted", status_b="accepted")
    assert tp.compute_readiness_label(txn, docs) == "Ready for Rental Contract Process"


def test_readiness_ready_sale_wording():
    txn = _txn(confirmed=True, transaction_type="sale")
    docs = _two_required_docs(status_a="accepted", status_b="accepted")
    assert tp.compute_readiness_label(txn, docs) == "Ready for Sale Process"


# ── Rent vs buy final wording (checklist step label) ─────────────────────

def test_checklist_final_step_label_rent_vs_sale():
    rent_steps = {s.key: s for s in tp.compute_checklist(_txn(transaction_type="rent"), _two_required_docs())}
    sale_steps = {s.key: s for s in tp.compute_checklist(_txn(transaction_type="sale"), _two_required_docs())}
    assert rent_steps["ready_for_next_step"].label == "Ready for Rental Contract Process"
    assert sale_steps["ready_for_next_step"].label == "Ready for Sale Process"


# ── Top-level orchestrator (real DB-backed transaction + documents) ──────

def test_compute_transaction_progress_reads_real_relationship(db_session):
    import uuid

    from app.models.property_negotiation import PropertyNegotiation
    from app.models.property import Property
    from app.services import property_transaction as transaction_service

    customer = User(email=f"c-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x", full_name="Sara", phone="0500000000")
    db_session.add(customer)
    db_session.flush()

    prop = Property(title="P", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
    db_session.add(prop)
    db_session.flush()

    negotiation = PropertyNegotiation(
        property_id=prop.id,
        customer_user_id=customer.id,
        transaction_type="rent",
        status="accepted",
        current_offer_amount=Decimal("3500"),
        original_listing_amount=Decimal("4000"),
    )
    db_session.add(negotiation)
    db_session.flush()

    transaction = transaction_service.create_transaction_for_negotiation(db_session, negotiation)
    db_session.commit()
    db_session.refresh(transaction)

    result = tp.compute_transaction_progress(transaction)
    assert result.progress_percentage == 25  # offer(10) + customer info done(15), nothing else
    assert result.readiness_label == tp.READINESS_NOT_READY
    assert result.next_best_action.key == "upload_missing_document"
    keys = [s.key for s in result.checklist]
    assert keys == [
        "offer_agreed",
        "customer_info",
        "documents_submitted",
        "mediator_review",
        "terms_reconfirmed",
        "ready_for_next_step",
    ]
