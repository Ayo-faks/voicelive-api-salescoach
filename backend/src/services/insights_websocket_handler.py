"""WebSocket handler for therapist Insights voice turns."""

from __future__ import annotations

import base64
from contextlib import closing
from html import escape
import json
import logging
import queue
import threading
import time
from typing import Any, Dict, Mapping, Optional
from uuid import uuid4

import azure.cognitiveservices.speech as speechsdk  # pyright: ignore[reportMissingTypeStubs]
import requests
from simple_websocket.errors import ConnectionClosed

from src.config import config
from src.services.azure_openai_auth import (
    COGNITIVE_SERVICES_SCOPE,
    DefaultAzureCredential,
    get_bearer_token_provider,
)

logger = logging.getLogger(__name__)

INPUT_SAMPLE_RATE = 24_000
SAMPLE_WIDTH_BYTES = 2
MAX_INPUT_SECONDS = 60
MAX_INPUT_BYTES = INPUT_SAMPLE_RATE * SAMPLE_WIDTH_BYTES * MAX_INPUT_SECONDS
STT_FLUSH_SILENCE_SECONDS = 2.0
STT_FINALIZATION_WAIT_SECONDS = STT_FLUSH_SILENCE_SECONDS + 0.5
TTS_OUTPUT_FORMAT = "raw-24khz-16bit-mono-pcm"
# Stream smaller PCM chunks so playback can start earlier, but keep chunks on
# 16-bit sample boundaries to avoid decoder misalignment noise.
TTS_CHUNK_SIZE = 2048


class InsightsVoiceHandler:
    def __init__(
        self,
        ws: Any,
        *,
        insights_service: Any,
        storage: Any,
        user: Mapping[str, Any],
        scope: Mapping[str, Any],
        conversation_id: Optional[str],
    ) -> None:
        self.ws = ws
        self.insights_service = insights_service
        self.storage = storage
        self.user = dict(user)
        self.scope = dict(scope)
        self.conversation_id = conversation_id
        self.region = str(config.get("azure_speech_region", "swedencentral") or "swedencentral")
        self.language = str(config.get("azure_speech_language", "en-GB") or "en-GB")
        self.speech_key = str(config.get("azure_speech_key") or "").strip()
        self.voice_name = str(config.get("azure_voice_name") or "en-GB-RubiGanges:DragonHDOmniLatestNeural")
        credential = DefaultAzureCredential()
        self._token_provider = get_bearer_token_provider(credential, COGNITIVE_SERVICES_SCOPE)
        self._pending_events: queue.SimpleQueue[Dict[str, Any]] = queue.SimpleQueue()
        self._deferred_frames: queue.SimpleQueue[Any] = queue.SimpleQueue()
        self._turn_state_lock = threading.Lock()
        self._recognition_finished = threading.Event()
        self._turn_final_received = threading.Event()
        self._recognizer: Any | None = None
        self._push_stream: Any | None = None
        self._turn_active = False
        self._session_stop_requested = False
        self._latest_partial = ""
        self._final_fragments: list[str] = []
        self._canceled_error: Optional[tuple[str, str]] = None
        self._recognizer_session_id: Optional[str] = None
        self._turn_sequence = 0
        self._active_turn_sequence = 0
        self._active_turn_id: Optional[str] = None
        self._flush_silence = b"\x00" * int(
            INPUT_SAMPLE_RATE * SAMPLE_WIDTH_BYTES * STT_FLUSH_SILENCE_SECONDS
        )

    def _log_stt_diagnostic(self, stage: str, **details: Any) -> None:
        payload: Dict[str, Any] = {
            "stage": stage,
            "recognizer_session_id": self._recognizer_session_id,
            "recognizer_object_id": None if self._recognizer is None else hex(id(self._recognizer)),
            "push_stream_object_id": None if self._push_stream is None else hex(id(self._push_stream)),
            "active_turn_sequence": self._active_turn_sequence,
            "active_turn_id": self._active_turn_id,
        }
        payload.update(details)
        logger.info(
            "[insights-voice-stt] %s",
            json.dumps(payload, default=str, sort_keys=True, separators=(",", ":")),
        )

    def _log_turn_timing(
        self,
        *,
        turn_id: str,
        turn_started_at: float,
        stage: str,
        **details: Any,
    ) -> None:
        payload: Dict[str, Any] = {
            "stage": stage,
            "turn_id": turn_id,
            "delta_ms": round((time.perf_counter() - turn_started_at) * 1000, 1),
        }
        payload.update(details)
        logger.info(
            "[insights-voice-timing] %s",
            json.dumps(payload, default=str, sort_keys=True, separators=(",", ":")),
        )

    def run(self) -> None:
        self._start_recognition_session()
        try:
            while True:
                self._send_state("listening")
                turn_input = self._transcribe_audio_stream()
                if turn_input is None:
                    return

                turn_id, turn_started_at, transcript = turn_input
                if transcript is None:
                    continue
                if not transcript:
                    self._send_error("empty_audio", "No audio was provided.")
                    continue

                try:
                    self._send_state("thinking")
                    self._log_turn_timing(
                        turn_id=turn_id,
                        turn_started_at=turn_started_at,
                        stage="transcript_available",
                        transcript_chars=len(transcript),
                    )
                    self._send_event({"type": "turn.final_transcript", "text": transcript})

                    self._log_turn_timing(
                        turn_id=turn_id,
                        turn_started_at=turn_started_at,
                        stage="ask_start",
                    )
                    answer_payload = self.insights_service.ask(
                        user_id=str(self.user.get("id") or ""),
                        scope=self.scope,
                        message=transcript,
                        conversation_id=self.conversation_id,
                        request_id=turn_id,
                    )
                    self._log_turn_timing(
                        turn_id=turn_id,
                        turn_started_at=turn_started_at,
                        stage="ask_end",
                        insights_latency_ms=answer_payload.get("latency_ms"),
                    )
                    conversation = answer_payload.get("conversation") or {}
                    assistant_message = answer_payload.get("assistant_message") or {}
                    resolved_conversation_id = str(conversation.get("id") or self.conversation_id or "")
                    answer_text = str(assistant_message.get("content_text") or "")
                    completed_event: Dict[str, Any] = {
                        "type": "turn.completed",
                        "conversation_id": resolved_conversation_id,
                        "answer_text": answer_text,
                    }
                    citations = assistant_message.get("citations")
                    visualizations = assistant_message.get("visualizations")
                    if citations is not None:
                        completed_event["citations"] = citations
                    if visualizations is not None:
                        completed_event["visualizations"] = visualizations

                    if answer_text:
                        self._send_state("speaking")
                        self._stream_tts_audio(
                            answer_text,
                            turn_id=turn_id,
                            turn_started_at=turn_started_at,
                        )
                    self._send_event(completed_event)
                    self._log_turn_timing(
                        turn_id=turn_id,
                        turn_started_at=turn_started_at,
                        stage="turn_completed_send",
                        answer_chars=len(answer_text),
                    )
                except ConnectionClosed:
                    return
                except Exception as exc:  # pragma: no cover - defensive transport guard
                    logger.exception("Insights voice websocket turn failed")
                    self._send_error("turn_failed", str(exc) or "Voice turn failed")
        finally:
            self._stop_recognition_session()

    def _parse_frame(self, frame: Any) -> Optional[Dict[str, Any]]:
        if isinstance(frame, bytes):
            try:
                frame = frame.decode("utf-8")
            except UnicodeDecodeError:
                return None
        if not isinstance(frame, str):
            return None
        try:
            parsed = json.loads(frame)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    def _send_event(self, payload: Mapping[str, Any]) -> None:
        self.ws.send(json.dumps(dict(payload), separators=(",", ":")) + "\n")

    def _send_state(self, agent_state: str) -> None:
        self._send_event({"type": "state", "agent_state": agent_state})

    def _send_error(self, code: str, message: str) -> None:
        self._send_event({"type": "turn.error", "code": code, "message": message})

    def _auth_headers(self) -> Dict[str, str]:
        if self.speech_key:
            return {"Ocp-Apim-Subscription-Key": self.speech_key}
        token = self._token_provider()
        return {"Authorization": f"Bearer {token}"}

    def _create_speech_config(self) -> Any:
        if self.speech_key:
            return speechsdk.SpeechConfig(
                subscription=self.speech_key,
                region=self.region,
                speech_recognition_language=self.language,
            )
        return speechsdk.SpeechConfig(
            auth_token=self._token_provider(),
            region=self.region,
            speech_recognition_language=self.language,
        )

    def _create_speech_recognizer(self) -> tuple[Any, Any]:
        speech_config = self._create_speech_config()
        audio_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=INPUT_SAMPLE_RATE,
            bits_per_sample=SAMPLE_WIDTH_BYTES * 8,
            channels=1,
            wave_stream_format=speechsdk.audio.AudioStreamWaveFormat.PCM,
        )
        push_stream = speechsdk.audio.PushAudioInputStream(stream_format=audio_format)
        audio_config = speechsdk.audio.AudioConfig(stream=push_stream)
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config,
            audio_config=audio_config,
            language=self.language,
        )
        return recognizer, push_stream

    def _start_recognition_session(self) -> None:
        recognizer, push_stream = self._create_speech_recognizer()
        self._recognizer = recognizer
        self._push_stream = push_stream
        self._recognizer_session_id = str(uuid4())
        self._session_stop_requested = False
        self._recognition_finished.clear()
        self._log_stt_diagnostic("recognizer_session_started")

        def on_recognizing(event: Any) -> None:
            result = getattr(event, "result", None)
            if getattr(result, "reason", None) != speechsdk.ResultReason.RecognizingSpeech:
                return
            text = str(getattr(result, "text", "") or "").strip()
            if not text:
                return
            with self._turn_state_lock:
                if not self._turn_active or text == self._latest_partial:
                    return
                is_first_partial = not self._latest_partial
                self._latest_partial = text
            if is_first_partial:
                self._log_stt_diagnostic("recognizing_first_partial", transcript_chars=len(text))
            self._pending_events.put({"type": "turn.partial_transcript", "text": text})

        def on_recognized(event: Any) -> None:
            result = getattr(event, "result", None)
            if getattr(result, "reason", None) != speechsdk.ResultReason.RecognizedSpeech:
                return
            text = str(getattr(result, "text", "") or "").strip()
            if not text:
                return
            with self._turn_state_lock:
                if not self._turn_active:
                    return
                self._latest_partial = text
                self._final_fragments.append(text)
                final_fragment_count = len(self._final_fragments)
            self._log_stt_diagnostic(
                "recognized_final",
                transcript_chars=len(text),
                final_fragment_count=final_fragment_count,
            )
            self._turn_final_received.set()

        def on_canceled(event: Any) -> None:
            details = getattr(event, "cancellation_details", None)
            if details is None:
                details = getattr(getattr(event, "result", None), "cancellation_details", None)
            reason = getattr(details, "reason", None)
            message = str(getattr(details, "error_details", "") or "").strip()
            if self._session_stop_requested and not message:
                self._log_stt_diagnostic("recognizer_canceled_after_stop_request")
                self._recognition_finished.set()
                return
            if reason == getattr(speechsdk.CancellationReason, "EndOfStream", None):
                self._log_stt_diagnostic("recognizer_end_of_stream")
                self._recognition_finished.set()
                return
            with self._turn_state_lock:
                if not self._turn_active:
                    return
                self._canceled_error = (
                    "transcription_failed",
                    message or "Speech recognition was canceled.",
                )
            self._log_stt_diagnostic(
                "recognizer_canceled",
                reason=str(reason),
                message=message or "Speech recognition was canceled.",
            )
            self._turn_final_received.set()

        recognizer.recognizing.connect(on_recognizing)
        recognizer.recognized.connect(on_recognized)
        recognizer.canceled.connect(on_canceled)
        recognizer.session_stopped.connect(
            lambda _event: (
                self._log_stt_diagnostic("recognizer_session_stopped"),
                self._recognition_finished.set(),
            )
        )
        recognizer.start_continuous_recognition_async().get()

    def _stop_recognition_session(self) -> None:
        recognizer = self._recognizer
        push_stream = self._push_stream
        if recognizer is None or push_stream is None:
            return

        self._session_stop_requested = True
        with self._turn_state_lock:
            self._turn_active = False
        self._log_stt_diagnostic("recognizer_session_stop_requested")

        try:
            push_stream.close()
        except Exception:
            logger.debug("Failed to close speech push stream", exc_info=True)
        try:
            recognizer.stop_continuous_recognition_async().get()
        except Exception:
            logger.debug("Failed to stop speech recognition cleanly", exc_info=True)
        finished = self._recognition_finished.wait(timeout=1)
        self._log_stt_diagnostic("recognizer_session_stop_wait_complete", finished=finished)

    def _drain_pending_events(self) -> None:
        while True:
            try:
                payload = self._pending_events.get_nowait()
            except queue.Empty:
                return
            self._send_event(payload)

    def _receive_frame(self, *, timeout: float) -> Any:
        try:
            return self._deferred_frames.get_nowait()
        except queue.Empty:
            return self.ws.receive(timeout=timeout)

    def _reset_turn_recognition_state(self) -> None:
        with self._turn_state_lock:
            self._turn_active = True
            self._latest_partial = ""
            self._final_fragments = []
            self._canceled_error = None
        self._active_turn_id = None
        self._turn_final_received.clear()

    def _transcribe_audio_stream(self) -> Optional[tuple[str, float, Optional[str]]]:
        if self._push_stream is None:
            raise RuntimeError("Speech recognition session has not been started")

        self._reset_turn_recognition_state()
        self._turn_sequence += 1
        self._active_turn_sequence = self._turn_sequence
        self._log_stt_diagnostic("turn_capture_started")
        total_bytes = 0
        audio_received = False
        turn_id: Optional[str] = None
        turn_started_at: Optional[float] = None

        try:
            while True:
                self._drain_pending_events()
                try:
                    frame = self._receive_frame(timeout=0.1)
                except ConnectionClosed:
                    return None
                if frame is None:
                    continue

                payload = self._parse_frame(frame)
                if payload is None:
                    continue

                frame_type = str(payload.get("type") or "")
                if frame_type == "user_audio_chunk":
                    chunk_b64 = payload.get("data") or payload.get("data_b64") or payload.get("audio")
                    if not isinstance(chunk_b64, str) or not chunk_b64:
                        continue
                    try:
                        chunk = base64.b64decode(chunk_b64)
                    except Exception:
                        self._send_error("invalid_audio", "Audio chunk could not be decoded.")
                        return self._finish_turn_result(turn_id, turn_started_at, transcript=None)
                    total_bytes += len(chunk)
                    if total_bytes > MAX_INPUT_BYTES:
                        self._send_error("input_too_long", "Voice input exceeded the 60 second limit.")
                        return self._finish_turn_result(turn_id, turn_started_at, transcript=None)
                    if turn_id is None or turn_started_at is None:
                        turn_id = str(uuid4())
                        turn_started_at = time.perf_counter()
                        self._active_turn_id = turn_id
                        started_event: Dict[str, Any] = {"type": "turn.started", "turn_id": turn_id}
                        if self.conversation_id:
                            started_event["conversation_id"] = self.conversation_id
                        self._send_event(started_event)
                        self._log_stt_diagnostic("turn_audio_started", turn_id=turn_id)
                    self._push_stream.write(chunk)
                    audio_received = True
                    continue

                if frame_type == "user_stop":
                    if turn_id is None or turn_started_at is None:
                        turn_id = str(uuid4())
                        turn_started_at = time.perf_counter()
                    client_sent_at_unix_ms = payload.get("client_sent_at_unix_ms")
                    client_to_backend_ms: Optional[float] = None
                    if isinstance(client_sent_at_unix_ms, (int, float)):
                        client_to_backend_ms = round(
                            max(0.0, (time.time() * 1000) - float(client_sent_at_unix_ms)),
                            1,
                        )
                    self._log_turn_timing(
                        turn_id=turn_id,
                        turn_started_at=turn_started_at,
                        stage="user_stop_received",
                        client_to_backend_ms=client_to_backend_ms,
                    )
                    if audio_received:
                        self._push_stream.write(self._flush_silence)
                        self._log_stt_diagnostic(
                            "flush_silence_written",
                            turn_id=turn_id,
                            total_audio_bytes=total_bytes,
                            flush_silence_bytes=len(self._flush_silence),
                        )
                        wait_started_at = time.perf_counter()
                        final_received = self._turn_final_received.wait(timeout=STT_FINALIZATION_WAIT_SECONDS)
                        self._log_stt_diagnostic(
                            "flush_wait_completed",
                            turn_id=turn_id,
                            total_audio_bytes=total_bytes,
                            final_received=final_received,
                            wait_ms=round((time.perf_counter() - wait_started_at) * 1000, 1),
                            final_fragment_count=len(self._final_fragments),
                            latest_partial_chars=len(self._latest_partial),
                        )
                    break
        finally:
            self._drain_pending_events()

        return self._finish_turn_result(turn_id, turn_started_at, transcript="" if not audio_received else None)

    def _finish_turn_result(
        self,
        turn_id: Optional[str],
        turn_started_at: Optional[float],
        *,
        transcript: Optional[str],
    ) -> tuple[str, float, Optional[str]]:
        resolved_turn_id = turn_id or str(uuid4())
        resolved_turn_started_at = turn_started_at or time.perf_counter()
        with self._turn_state_lock:
            canceled_error = self._canceled_error
            final_fragments = list(self._final_fragments)
            latest_partial = self._latest_partial
            self._turn_active = False
        if canceled_error is not None:
            self._send_error(canceled_error[0], canceled_error[1])
            return resolved_turn_id, resolved_turn_started_at, None
        if transcript == "":
            return resolved_turn_id, resolved_turn_started_at, ""
        resolved_transcript = " ".join(fragment for fragment in final_fragments if fragment).strip()
        self._log_stt_diagnostic(
            "turn_transcript_resolved",
            turn_id=resolved_turn_id,
            transcript_chars=len(resolved_transcript or latest_partial.strip()),
            final_fragment_count=len(final_fragments),
            latest_partial_chars=len(latest_partial),
            used_partial_fallback=not bool(resolved_transcript) and bool(latest_partial.strip()),
        )
        return resolved_turn_id, resolved_turn_started_at, resolved_transcript or latest_partial.strip()

    def _stream_tts_audio(
        self,
        answer_text: str,
        *,
        turn_id: Optional[str] = None,
        turn_started_at: Optional[float] = None,
    ) -> None:
        ssml = self._build_ssml(answer_text)
        endpoint = f"https://{self.region}.tts.speech.microsoft.com/cognitiveservices/v1"
        headers = {
            **self._auth_headers(),
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": TTS_OUTPUT_FORMAT,
        }
        if turn_id is not None and turn_started_at is not None:
            self._log_turn_timing(
                turn_id=turn_id,
                turn_started_at=turn_started_at,
                stage="tts_post_start",
            )
        with closing(
            requests.post(
                endpoint,
                headers=headers,
                data=ssml.encode("utf-8"),
                stream=True,
                timeout=(10, 120),
            )
        ) as response:
            response.raise_for_status()
            pending_byte = b""
            first_chunk_logged = False
            for chunk in response.iter_content(chunk_size=TTS_CHUNK_SIZE):
                if not chunk:
                    continue
                if pending_byte:
                    chunk = pending_byte + chunk
                    pending_byte = b""
                if len(chunk) % 2 == 1:
                    pending_byte = chunk[-1:]
                    chunk = chunk[:-1]
                if not chunk:
                    continue
                if not first_chunk_logged:
                    first_chunk_logged = True
                    if turn_id is not None and turn_started_at is not None:
                        self._log_turn_timing(
                            turn_id=turn_id,
                            turn_started_at=turn_started_at,
                            stage="first_tts_chunk_yielded",
                            chunk_bytes=len(chunk),
                        )
                self._send_event(
                    {
                        "type": "turn.audio_chunk",
                        "data_b64": base64.b64encode(chunk).decode("ascii"),
                        "format": TTS_OUTPUT_FORMAT,
                    }
                )
                try:
                    frame = self.ws.receive(timeout=0)
                except ConnectionClosed:
                    return
                if frame is None:
                    continue
                payload = self._parse_frame(frame)
                if payload is None:
                    continue
                if str(payload.get("type") or "") != "turn.interrupt":
                    self._deferred_frames.put(frame)
                    continue
                response.close()
                self._send_event({"type": "turn.interrupted"})
                return
            if pending_byte:
                logger.warning("Discarding trailing odd PCM byte from TTS stream")

    def _build_ssml(self, answer_text: str) -> str:
        return (
            "<speak version='1.0' xml:lang='"
            f"{escape(self.language)}'"
            "><voice name='"
            f"{escape(self.voice_name)}'"
            ">"
            f"{escape(answer_text)}"
            "</voice></speak>"
        )