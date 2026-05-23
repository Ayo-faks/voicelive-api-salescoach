import importlib.util
from pathlib import Path

from src.learning.mastery import BetaBKT, MasteryUpdateInput
from src.learning.models import MasteryEvent, OfflineQueuedEvent, Provenance, StudentResponse
from src.learning.repository import LEARNING_RLS_PROTECTED_TABLES, InMemoryLearningRepository
from src.learning.xapi import RalphXAPISink, mastery_event_to_xapi
from src.services import storage_postgres
from src.services.storage_postgres import PostgresStorageService


REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATION_PATH = REPO_ROOT / "backend" / "alembic" / "versions" / "20260523_000024_learning_foundations.py"
TRACE_PATH = REPO_ROOT / "scripts" / "trace_evidence_phase_1.py"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def provenance(source="phase_1_test"):
    return [Provenance(source=source, confidence=1.0, evidence_count=1)]


def response_fixture(tenant_id="tenant-1"):
    return StudentResponse(
        tenant_id=tenant_id,
        student_id="student-1",
        item_id="item-1",
        skill_id="ratio",
        response_text="2:3",
        correct=True,
        lang="en-NG",
        provenance=provenance(),
    )


def test_phase_1_migration_declares_every_learning_table_with_forced_rls():
    migration = load_module(MIGRATION_PATH, "phase_1_migration")
    source = MIGRATION_PATH.read_text(encoding="utf-8")

    assert tuple(migration.LEARNING_RLS_TABLES) == LEARNING_RLS_PROTECTED_TABLES
    assert "ENABLE ROW LEVEL SECURITY" in source
    assert "FORCE ROW LEVEL SECURITY" in source
    assert "app.tenant_id" in source
    assert "app.class_id" in source
    for table_name in LEARNING_RLS_PROTECTED_TABLES:
        assert f"CREATE TABLE IF NOT EXISTS {table_name}" in source


def test_storage_postgres_sets_learning_scope_gucs(monkeypatch):
    fake_connection = FakeConnection()

    def fake_connect(database_url, row_factory=None):
        fake_connection.database_url = database_url
        fake_connection.row_factory = row_factory
        return fake_connection

    monkeypatch.setattr(storage_postgres.psycopg, "connect", fake_connect)
    storage = PostgresStorageService("postgresql://example/db")
    storage.set_request_actor(
        user_id="teacher-1",
        role="teacher",
        email="teacher@example.com",
        tenant_id="tenant-1",
        class_id="class-1",
    )

    storage._connect()

    _, params = fake_connection.executions[0]
    assert params == (
        "teacher-1",
        "teacher",
        "teacher@example.com",
        "teacher-1",
        "teacher",
        "tenant-1",
        "class-1",
        "off",
    )
    storage.clear_request_actor()


def test_in_memory_repository_proves_cross_tenant_query_is_empty():
    repository = InMemoryLearningRepository()
    repository.save_student_response(response_fixture("tenant-a"), idempotency_key="idem-a")
    repository.save_student_response(response_fixture("tenant-b"), idempotency_key="idem-b")

    assert len(repository.list_student_responses_for_tenant("tenant-a")) == 1
    assert repository.list_student_responses_for_tenant("tenant-c") == []


def test_ralph_sink_and_repository_accept_phase_1_persisted_event_shape():
    response = response_fixture()
    mastery = BetaBKT().update(
        MasteryUpdateInput(
            tenant_id=response.tenant_id,
            student_id=response.student_id,
            skill_id=response.skill_id,
            correct=response.correct,
            lang=response.lang,
            provenance=response.provenance,
        )
    )
    event = MasteryEvent(
        tenant_id=response.tenant_id,
        student_id=response.student_id,
        skill_id=response.skill_id,
        response_id=response.response_id,
        estimate=mastery.estimate,
        lang=response.lang,
        provenance=mastery.provenance,
    )
    sink = RalphXAPISink(offline=True)
    statement = sink.emit(mastery_event_to_xapi(event))
    repository = InMemoryLearningRepository()

    repository.save_mastery_event(event, statement)
    repository.emit_xapi_statement(response.tenant_id, response.student_id, statement, sink.sink_status)
    repository.queue_offline_event(
        OfflineQueuedEvent(
            tenant_id=response.tenant_id,
            actor_id=response.student_id,
            idempotency_key="queue-1",
            event_type="mastery_event.sync",
            payload={"event_id": event.event_id},
        )
    )

    assert sink.sink_status == "ralph_queued"
    assert repository.mastery_events[0]["xapi_statement"]["id"] == event.event_id
    assert repository.xapi_statements[0]["sink_status"] == "ralph_queued"
    assert repository.offline_queue[0]["status"] == "queued"


def test_phase_1_trace_runs_offline_without_cloud_calls():
    trace_module = load_module(TRACE_PATH, "phase_1_trace")

    trace = trace_module.run_trace()

    assert trace["phase"] == 1
    assert trace["offline"] is True
    assert trace["cross_tenant_probe"]["cross_tenant_rows"] == 0
    assert trace["ralph_sink"]["sink_status"] == "ralph_queued"


class FakeConnection:
    def __init__(self):
        self.executions = []

    def execute(self, sql, params=None):
        self.executions.append((sql, params))
        return self