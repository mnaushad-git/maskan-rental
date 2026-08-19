"""Smart Questions: 4-7 questions from the right bank (rent vs. buy), and a
question is skipped only when the listing already records the answer on a
real field.
"""
from app.models.property import Property
from app.services.smart_questions import generate_smart_questions


def test_rent_question_count_in_range():
    prop = Property(title="T", area="A", city="C", listing_type="rent", status="Published")
    questions = generate_smart_questions(prop)
    assert 4 <= len(questions) <= 7


def test_rent_skips_furnishing_question_when_known():
    prop = Property(title="T", area="A", city="C", listing_type="rent", status="Published", furnished="Furnished")
    questions = generate_smart_questions(prop)
    assert not any("furnishings are included" in q.lower() or "furnishings included" in q.lower() for q in questions)


def test_rent_skips_deposit_question_when_insurance_amount_set():
    prop = Property(title="T", area="A", city="C", listing_type="rent", status="Published", insurance_amount=2000.0)
    questions = generate_smart_questions(prop)
    assert not any("security deposit" in q.lower() for q in questions)


def test_buy_question_count_in_range():
    prop = Property(title="T", area="A", city="C", listing_type="sale", status="Published")
    questions = generate_smart_questions(prop)
    assert 4 <= len(questions) <= 7


def test_buy_skips_age_question_when_known():
    prop = Property(title="T", area="A", city="C", listing_type="sale", status="Published", property_age_years=5)
    questions = generate_smart_questions(prop)
    assert not any("exact age" in q.lower() for q in questions)


def test_buy_skips_deed_area_question_when_known():
    prop = Property(title="T", area="A", city="C", listing_type="sale", status="Published", deed_area=300)
    questions = generate_smart_questions(prop)
    assert not any("deed area" in q.lower() for q in questions)
