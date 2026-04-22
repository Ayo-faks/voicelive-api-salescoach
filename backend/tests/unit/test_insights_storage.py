"""Unit tests for Phase 4 Insights Agent storage CRUD (SQLite)."""

from pathlib import Path

from src.services.storage import StorageService


def _bootstrap_therapist_with_child(tmp_path: Path) -> tuple[StorageService, str, str]:
    service = StorageService(str(tmp_path / "insights.db"))
    service.get_or_create_user("therapist-1", "t@example.com", "Therapist", "aad")
    child = service.create_child(
        name="Kid A",
        created_by_user_id="therapist-1",
        relationship="therapist",
    )
    return service, "therapist-1", child["id"]


class TestInsightsConversationStorage:
    def test_create_and_fetch_conversation(self, tmp_path: Path) -> None:
        service, user_id, child_id = _bootstrap_therapist_with_child(tmp_path)

        conversation = service.create_insight_conversation(
            user_id=user_id,
            scope_type="child",
            scope_child_id=child_id,
            prompt_version="insights-v1",
            title="How has Kid A progressed?",
        )

        assert conversation["id"].startswith("insight-conv-")
        assert conversation["scope_type"] == "child"
        assert conversation["scope_child_id"] == child_id
        assert conversation["prompt_version"] == "insights-v1"

        fetched = service.get_insight_conversation(conversation["id"], user_id=user_id)
        assert fetched is not None
        assert fetched["id"] == conversation["id"]

        # Ownership check: different user cannot fetch.
        service.get_or_create_user("other", "o@example.com", "Other", "aad")
        assert service.get_insight_conversation(conversation["id"], user_id="other") is None

    def test_list_conversations_orders_by_updated_at_desc(self, tmp_path: Path) -> None:
        service, user_id, child_id = _bootstrap_therapist_with_child(tmp_path)

        first = service.create_insight_conversation(
            user_id=user_id,
            scope_type="child",
            scope_child_id=child_id,
            prompt_version="insights-v1",
            title="First",
        )
        second = service.create_insight_conversation(
            user_id=user_id,
            scope_type="caseload",
            prompt_version="insights-v1",
            title="Second",
        )

        # Touch the first one to move it to the top.
        service.append_insight_message(
            first["id"],
            role="user",
            content_text="hi",
        )

        listed = service.list_insight_conversations_for_user(user_id)
        ids = [row["id"] for row in listed]
        assert ids[0] == first["id"]
        assert second["id"] in ids

    def test_append_messages_roundtrip_json_and_updates_parent(
        self, tmp_path: Path
    ) -> None:
        service, user_id, child_id = _bootstrap_therapist_with_child(tmp_path)
        conversation = service.create_insight_conversation(
            user_id=user_id,
            scope_type="child",
            scope_child_id=child_id,
            prompt_version="insights-v1",
        )
        original_updated_at = conversation["updated_at"]

        service.append_insight_message(
            conversation["id"],
            role="user",
            content_text="Show me a chart",
        )
        service.append_insight_message(
            conversation["id"],
            role="assistant",
            content_text="Here it is",
            citations=[{"kind": "child", "child_id": child_id, "label": "Kid A"}],
            visualizations=[
                {
                    "kind": "line",
                    "title": "Scores",
                    "x_label": "Session",
                    "y_label": "Score",
                    "series": [
                        {"name": "overall", "points": [{"x": "s1", "y": 0.4}]}
                    ],
                }
            ],
            tool_trace=[
                {
                    "name": "get_child_overview",
                    "arguments": {"child_id": child_id},
                    "duration_ms": 3,
                    "result_summary": "ok",
                }
            ],
            latency_ms=42,
            tool_calls_count=1,
            prompt_version="insights-v1",
        )

        messages = service.list_insight_messages(conversation["id"])
        assert [m["role"] for m in messages] == ["user", "assistant"]
        assistant = messages[1]
        assert assistant["citations"] == [
            {"kind": "child", "child_id": child_id, "label": "Kid A"}
        ]
        assert assistant["visualizations"][0]["kind"] == "line"
        assert assistant["tool_trace"][0]["name"] == "get_child_overview"
        assert assistant["latency_ms"] == 42
        assert assistant["tool_calls_count"] == 1

        refreshed = service.get_insight_conversation(conversation["id"], user_id=user_id)
        assert refreshed is not None
        assert refreshed["updated_at"] >= original_updated_at

    def test_delete_child_data_cascades_to_insights(self, tmp_path: Path) -> None:
        service, user_id, child_id = _bootstrap_therapist_with_child(tmp_path)
        conv = service.create_insight_conversation(
            user_id=user_id,
            scope_type="child",
            scope_child_id=child_id,
            prompt_version="insights-v1",
        )
        service.append_insight_message(
            conv["id"], role="user", content_text="hello"
        )

        # delete_child_data has an inconsistent return (None on success in the
        # happy path today, False when no such child); the effect is what we
        # assert on here.
        service.delete_child_data(child_id)
        assert service.get_insight_conversation(conv["id"], user_id=user_id) is None
        assert service.list_insight_messages(conv["id"]) == []
