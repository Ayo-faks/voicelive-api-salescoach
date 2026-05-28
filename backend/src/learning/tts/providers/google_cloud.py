import os

from .base import TtsProvider, TtsProviderUnavailable


class GoogleCloudTtsProvider(TtsProvider):
    id = "google"

    def synthesize(self, text: str, voice: str, lang: str) -> bytes:
        credentials_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        project_id = os.environ.get("GOOGLE_TTS_PROJECT_ID")
        del project_id
        try:
            from google.cloud import texttospeech  # type: ignore[import-not-found]
        except ImportError as exc:
            raise TtsProviderUnavailable("google provider not installed") from exc
        if not credentials_path:
            raise TtsProviderUnavailable("google credentials missing")

        client = texttospeech.TextToSpeechClient()
        synthesis_input = texttospeech.SynthesisInput(text=text)
        voice_params = texttospeech.VoiceSelectionParams(language_code=lang, name=voice)
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3
        )
        response = client.synthesize_speech(
            input=synthesis_input,
            voice=voice_params,
            audio_config=audio_config,
        )
        return bytes(response.audio_content)
