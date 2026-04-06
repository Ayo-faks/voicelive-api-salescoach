"""Unit tests for therapist practice planning service."""

from src.services.planning_service import CopilotPlannerTurnResult, PracticePlanningService


class _FakeStorage:
	def __init__(self):
		self.saved_plan = None

	def get_session(self, session_id: str):
		return {
			"id": session_id,
			"child": {"id": "child-1", "name": "Ayo"},
			"exercise": {"id": "exercise-1", "name": "R Warmup"},
			"exercise_metadata": {"targetSound": "r", "difficulty": "medium"},
			"assessment": {
				"ai_assessment": {
					"overall_score": 74,
					"engagement_and_effort": {"willingness_to_retry": 7},
				},
				"pronunciation_assessment": {"accuracy_score": 68},
			},
			"timestamp": "2026-04-03T12:00:00+00:00",
		}

	def list_sessions_for_child(self, child_id: str):
		return [
			{"id": "session-2", "accuracy_score": 68, "overall_score": 74, "timestamp": "2026-04-03T12:00:00+00:00"},
			{"id": "session-1", "accuracy_score": 61, "overall_score": 70, "timestamp": "2026-03-27T12:00:00+00:00"},
		]

	def save_practice_plan(self, payload):
		stored = dict(payload)
		stored.setdefault("id", "plan-123")
		stored.setdefault("created_at", "2026-04-03T12:05:00+00:00")
		stored.setdefault("updated_at", "2026-04-03T12:05:00+00:00")
		self.saved_plan = stored
		return stored

	def get_practice_plan(self, plan_id: str):
		return self.saved_plan


class _FakeScenarioManager:
	def list_scenarios(self):
		return [
			{
				"id": "exercise-1",
				"name": "R Warmup",
				"exerciseMetadata": {"targetSound": "r", "difficulty": "medium"},
			},
			{
				"id": "exercise-2",
				"name": "Listening Minimal Pairs",
				"exerciseMetadata": {"targetSound": "r", "difficulty": "medium"},
			},
		]


class _FakePlannerRuntime:
	def __init__(self):
		self.calls = []
		self.model = "gpt-5"

	def run_turn(self, *, planner_session_id: str, therapist_prompt: str, planning_context):
		self.calls.append(
			{
				"planner_session_id": planner_session_id,
				"therapist_prompt": therapist_prompt,
				"planning_context": planning_context,
			}
		)
		listening_first = "listening" in therapist_prompt.lower()
		shorter = "short" in therapist_prompt.lower()
		return CopilotPlannerTurnResult(
			planner_session_id=planner_session_id,
			draft={
				"objective": "Increase /r/ accuracy with therapist-led practice.",
				"focus_sound": "r",
				"rationale": "Grounded in the most recent session and therapist request.",
				"estimated_duration_minutes": 12 if shorter else 15,
				"activities": [
					{
						"title": "Listening warm-up" if listening_first else "R Warmup",
						"exercise_id": "exercise-2" if listening_first else "exercise-1",
						"exercise_name": "Listening Minimal Pairs" if listening_first else "R Warmup",
						"reason": "Matches the target sound and recent session needs.",
						"target_duration_minutes": 4,
					},
					{
						"title": "Production practice",
						"exercise_id": "exercise-1",
						"exercise_name": "R Warmup",
						"reason": "Builds direct production after setup.",
						"target_duration_minutes": 5,
					},
				],
				"therapist_cues": ["Model once, then prompt a retry."],
				"success_criteria": ["Accurate /r/ in one supported activity."],
				"carryover": ["One short /r/ word list at home."],
			},
			raw_content="{}",
			tool_calls=2,
		)

	def get_readiness(self, force_refresh: bool = False):
		del force_refresh
		return {
			"ready": True,
			"model": self.model,
			"sdk_installed": True,
			"cli": {"available": True, "authenticated": True},
			"auth": {"github_token_configured": False, "azure_byok_configured": False},
			"reasons": [],
		}


def test_create_plan_builds_structured_draft():
	storage = _FakeStorage()
	runtime = _FakePlannerRuntime()
	service = PracticePlanningService(storage, _FakeScenarioManager(), planner_runtime=runtime)

	plan = service.create_plan(
		child_id="child-1",
		source_session_id="session-2",
		created_by_user_id="therapist-1",
		therapist_message="Keep this playful and focused on /r/.",
	)

	assert plan["child_id"] == "child-1"
	assert plan["draft"]["focus_sound"] == "r"
	assert plan["draft"]["activities"]
	assert plan["conversation"][0]["role"] == "user"
	assert plan["planner_session_id"].startswith("practice-planner-plan-")
	assert runtime.calls[0]["planning_context"]["source_session"]["assessment"]["accuracy_score"] == 68


def test_refine_plan_applies_shorter_and_listening_rules():
	storage = _FakeStorage()
	runtime = _FakePlannerRuntime()
	service = PracticePlanningService(storage, _FakeScenarioManager(), planner_runtime=runtime)
	service.create_plan(
		child_id="child-1",
		source_session_id="session-2",
		created_by_user_id="therapist-1",
		therapist_message="",
	)

	plan = service.refine_plan("plan-123", "Make this shorter and lead with a listening task.")

	assert plan["draft"]["estimated_duration_minutes"] <= 15
	assert "listening" in plan["draft"]["activities"][0]["exercise_name"].lower()
	assert plan["conversation"][-1]["role"] == "assistant"
	assert runtime.calls[-1]["planner_session_id"] == plan["planner_session_id"]


def test_get_readiness_delegates_to_runtime():
	storage = _FakeStorage()
	runtime = _FakePlannerRuntime()
	service = PracticePlanningService(storage, _FakeScenarioManager(), planner_runtime=runtime)

	readiness = service.get_readiness()

	assert readiness["ready"] is True
	assert readiness["model"] == "gpt-5"
