import os

from .base import TtsProvider, TtsProviderError, TtsProviderUnavailable


class AzureSpeechProvider(TtsProvider):
    id = "azure"

    def synthesize(self, text: str, voice: str, lang: str) -> bytes:
        del lang
        speech_key = os.environ.get("AZURE_SPEECH_KEY")
        if not speech_key:
            raise TtsProviderUnavailable("azure speech credentials missing")
        speech_region = os.environ.get("AZURE_SPEECH_REGION") or "westeurope"
        try:
            import azure.cognitiveservices.speech as speechsdk  # pyright: ignore[reportMissingTypeStubs]
        except ImportError as exc:
            raise TtsProviderUnavailable("azure speech provider not installed") from exc

        speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
        speech_config.speech_synthesis_voice_name = voice
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3
        )
        synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)
        result = synthesizer.speak_text_async(text).get()
        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return bytes(result.audio_data)
        raise TtsProviderError(f"azure speech synthesis failed: {result.reason}")
