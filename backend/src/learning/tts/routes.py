from __future__ import annotations

import time
from typing import Any, Mapping, Optional

from flask import Blueprint, Response, jsonify, request

from src.learning.tts import service as tts_service


def create_learning_tts_blueprint(observability: Optional[Any] = None) -> Blueprint:
    bp = Blueprint("learning_tts", __name__)

    @bp.route("/api/learning/tts", methods=["POST"])
    def synthesize_learning_tts():
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, Mapping):
            payload = {}
        text = str(payload.get("text") or "").strip()
        if not text:
            return jsonify({"error": "empty_text"}), 400
        if len(text) > 600:
            return jsonify({"error": "text_too_long"}), 400

        requested_voice = payload.get("voice")
        voice, resolved_lang = tts_service.resolve_voice(
            requested_voice if isinstance(requested_voice, str) else None
        )
        requested_lang = payload.get("lang")
        lang = requested_lang.strip() if isinstance(requested_lang, str) and requested_lang.strip() else resolved_lang
        started = time.perf_counter()
        try:
            provider = tts_service.get_provider()
            audio, cache_status = tts_service.synthesize_cached(text, voice, lang)
        except tts_service.TtsProviderUnavailable:
            _record_ttfa(observability, None, "error")
            return jsonify({"error": "tts_unavailable"}), 503

        _record_ttfa(observability, (time.perf_counter() - started) * 1000.0, "success")
        response = Response(audio, mimetype="audio/mpeg")
        response.headers["Cache-Control"] = "public, max-age=86400"
        response.headers["X-TTS-Cache"] = cache_status
        response.headers["X-TTS-Provider"] = provider.id
        return response

    return bp


def _record_ttfa(observability: Optional[Any], latency_ms: Optional[float], outcome: str) -> None:
    if observability is None:
        return
    try:
        observability.record_voice_ttfa(latency_ms=latency_ms, outcome=outcome)
    except Exception:  # pragma: no cover - metrics must never break TTS
        pass
