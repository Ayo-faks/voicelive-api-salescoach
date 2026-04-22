"""WebSocket handler for therapist Insights voice turns."""

from __future__ import annotations

import base64
from contextlib import closing
from html import escape
import json
import logging
import queue
import threading
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
MAX_RECOGNITION_STOP_WAIT_SECONDS = 5
TTS_OUTPUT_FORMAT = "raw-24khz-16bit-mono-pcm"
TTS_CHUNK_SIZE = 8192


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

    def run(self) -> None:
        turn_id = str(uuid4())
        started_event: Dict[str, Any] = {"type": "turn.started", "turn_id": turn_id}
        if self.conversation_id:
            started_event["conversation_id"] = self.conversation_id
        self._send_event(started_event)

        try:
            transcript = self._transcribe_audio_stream()
            if transcript is None:
                return
            if not transcript:
                self._send_error("empty_audio", "No audio was provided.")
                return

            self._send_event({"type": "turn.final_transcript", "text": transcript})

            answer_payload = self.insights_service.ask(
                user_id=str(self.user.get("id") or ""),
                scope=self.scope,
                message=transcript,
                conversation_id=self.conversation_id,
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
                self._stream_tts_audio(answer_text)
            self._send_event(completed_event)
        except Exception as exc:  # pragma: no cover - defensive transport guard
            logger.exception("Insights voice websocket turn failed")
            self._send_error("turn_failed", str(exc) or "Voice turn failed")

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

    def _transcribe_audio_stream(self) -> Optional[str]:
        recognizer, push_stream = self._create_speech_recognizer()
        pending_events: queue.SimpleQueue[Dict[str, Any]] = queue.SimpleQueue()
        recognition_finished = threading.Event()
        final_fragments: list[str] = []
        latest_partial = ""
        audio_received = False
        total_bytes = 0
        canceled_error: Optional[tuple[str, str]] = None

        def drain_pending_events() -> None:
            while True:
                try:
                    payload = pending_events.get_nowait()
                except queue.Empty:
                    return
                self._send_event(payload)

        def on_recognizing(event: Any) -> None:
            nonlocal latest_partial
            result = getattr(event, "result", None)
            if getattr(result, "reason", None) != speechsdk.ResultReason.RecognizingSpeech:
                return
            text = str(getattr(result, "text", "") or "").strip()
            if not text or text == latest_partial:
                return
            latest_partial = text
            pending_events.put({"type": "turn.partial_transcript", "text": text})

        def on_recognized(event: Any) -> None:
            nonlocal latest_partial
            result = getattr(event, "result", None)
            if getattr(result, "reason", None) != speechsdk.ResultReason.RecognizedSpeech:
                return
            text = str(getattr(result, "text", "") or "").strip()
            if not text:
                return
            latest_partial = text
            final_fragments.append(text)

        def on_canceled(event: Any) -> None:
            nonlocal canceled_error
            details = getattr(event, "cancellation_details", None)
            if details is None:
                details = getattr(getattr(event, "result", None), "cancellation_details", None)
            message = str(getattr(details, "error_details", "") or "").strip()
            canceled_error = (
                "transcription_failed",
                message or "Speech recognition was canceled.",
            )
            recognition_finished.set()

        recognizer.recognizing.connect(on_recognizing)
        recognizer.recognized.connect(on_recognized)
        recognizer.canceled.connect(on_canceled)
        recognizer.session_stopped.connect(lambda _event: recognition_finished.set())
        recognizer.start_continuous_recognition_async().get()

        try:
            while True:
                drain_pending_events()
                try:
                    frame = self.ws.receive(timeout=0.1)
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
                        return None
                    total_bytes += len(chunk)
                    if total_bytes > MAX_INPUT_BYTES:
                        self._send_error("input_too_long", "Voice input exceeded the 60 second limit.")
                        return None
                    push_stream.write(chunk)
                    audio_received = True
                    continue

                if frame_type == "user_stop":
                    break
        finally:
            try:
                push_stream.close()
            except Exception:
                logger.debug("Failed to close speech push stream", exc_info=True)
            try:
                recognizer.stop_continuous_recognition_async().get()
            except Exception:
                logger.debug("Failed to stop speech recognition cleanly", exc_info=True)

        recognition_finished.wait(timeout=MAX_RECOGNITION_STOP_WAIT_SECONDS)
        drain_pending_events()
        if canceled_error is not None:
            self._send_error(canceled_error[0], canceled_error[1])
            return None
        if not audio_received:
            return ""
        transcript = " ".join(fragment for fragment in final_fragments if fragment).strip()
        return transcript or latest_partial.strip()

    def _stream_tts_audio(self, answer_text: str) -> None:
        ssml = self._build_ssml(answer_text)
        endpoint = f"https://{self.region}.tts.speech.microsoft.com/cognitiveservices/v1"
        headers = {
            **self._auth_headers(),
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": TTS_OUTPUT_FORMAT,
        }
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
            for chunk in response.iter_content(chunk_size=TTS_CHUNK_SIZE):
                if not chunk:
                    continue
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
                    continue
                response.close()
                self._send_event({"type": "turn.interrupted"})
                return

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