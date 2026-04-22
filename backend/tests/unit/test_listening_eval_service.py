"""Tests for the listening-eval service + RL Stage 0 reward service."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path

import pytest

from src.services.listening_eval_service import (
    MIN_THERAPISTS_FOR_REWARD,
    MIN_VOTES_FOR_REWARD,
    ListeningEvalItem,
    ListeningEvalService,
    build_dpo_preference_pairs,
)
from src.services.reward_service import RewardService


@pytest.fixture
def service(tmp_path: Path) -> ListeningEvalService:
    db_path = tmp_path / "listening.sqlite3"

    @contextmanager
    def _connect():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    return ListeningEvalService(_connect)


def _make_item(**overrides) -> ListeningEvalItem:
    base = dict(
        id="",
        target_token="think",
        target_sound="th",
        reference_text="think",
        variant_a_ssml="<speak>A</speak>",
        variant_b_ssml="<speak>B</speak>",
        variant_a_label="ipa-only",
        variant_b_label="ipa+lexicon",
        voice_name="en-GB-SoniaNeural",
    )
    base.update(overrides)
    return ListeningEvalItem(**base)


def test_create_and_list_item(service: ListeningEvalService) -> None:
    created = service.create_item(_make_item())
    assert created.id
    items = service.list_active_items()
    assert len(items) == 1
    assert items[0].target_token == "think"


def test_record_vote_validates_inputs(service: ListeningEvalService) -> None:
    item = service.create_item(_make_item())
    with pytest.raises(ValueError):
        service.record_vote(
            item_id=item.id,
            therapist_user_id="t1",
            preferred_variant="c",
            confidence=3,
        )
    with pytest.raises(ValueError):
        service.record_vote(
            item_id=item.id,
            therapist_user_id="t1",
            preferred_variant="a",
            confidence=0,
        )


def test_retire_item_flips_flag(service: ListeningEvalService) -> None:
    item = service.create_item(_make_item())
    assert service.retire_item(item.id)
    assert not service.list_active_items()
    # Retiring twice is a no-op.
    assert not service.retire_item(item.id)


def test_refresh_rewards_gated_until_thresholds(
    service: ListeningEvalService,
) -> None:
    item = service.create_item(_make_item())
    # Add a few votes but not enough to cross the gate.
    for i in range(5):
        service.record_vote(
            item_id=item.id,
            therapist_user_id=f"therapist-{i % 2}",
            preferred_variant="b",
            confidence=5,
        )
    rewards = service.refresh_rewards()
    assert rewards == []
    assert service.list_rewards() == []


def test_refresh_rewards_emits_once_gates_clear(
    service: ListeningEvalService,
) -> None:
    item = service.create_item(_make_item())
    therapists = [f"t-{i}" for i in range(MIN_THERAPISTS_FOR_REWARD)]
    total_votes_needed = MIN_VOTES_FOR_REWARD
    for i in range(total_votes_needed):
        service.record_vote(
            item_id=item.id,
            therapist_user_id=therapists[i % len(therapists)],
            preferred_variant="b",
            confidence=5,
        )
    rewards = service.refresh_rewards()
    assert len(rewards) == 1
    reward = rewards[0]
    assert reward.target_token == "think"
    # All votes chose B with max confidence → reward saturates at -1.0.
    assert reward.reward == pytest.approx(-1.0)
    assert reward.vote_count == total_votes_needed
    assert reward.therapist_count == MIN_THERAPISTS_FOR_REWARD
    assert reward.variant_label == "ipa+lexicon"


def test_reward_service_respects_gate(service: ListeningEvalService) -> None:
    rs = RewardService(service)
    snap = rs.snapshot()
    assert snap.gated is True
    assert snap.gate_reason
    assert rs.get_reward("think") is None


def test_dpo_preference_pairs_drop_ties_and_low_confidence(
    service: ListeningEvalService,
) -> None:
    item = service.create_item(_make_item())
    service.record_vote(
        item_id=item.id,
        therapist_user_id="t1",
        preferred_variant="a",
        confidence=5,
    )
    service.record_vote(
        item_id=item.id,
        therapist_user_id="t2",
        preferred_variant="tie",
        confidence=5,
    )
    service.record_vote(
        item_id=item.id,
        therapist_user_id="t3",
        preferred_variant="b",
        confidence=2,
    )
    pairs = build_dpo_preference_pairs(service, min_confidence=3)
    assert len(pairs) == 1
    assert pairs[0]["chosen_label"] == "ipa-only"
    assert pairs[0]["rejected_label"] == "ipa+lexicon"


def test_csv_export_header_and_a_row(service: ListeningEvalService) -> None:
    item = service.create_item(_make_item())
    service.record_vote(
        item_id=item.id,
        therapist_user_id="t1",
        preferred_variant="a",
        confidence=4,
    )
    csv_text = service.export_votes_csv()
    header, body, *_ = csv_text.splitlines()
    assert header.startswith("vote_id,item_id,target_token")
    assert "think" in body
    assert ",a," in body or ",a\n" in body
