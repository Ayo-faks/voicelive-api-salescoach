import os

from .base import TtsProvider, TtsProviderError, TtsProviderUnavailable


class AzureSpeechProvider(TtsProvider):
    id = "azure"

    def synthesize(self, text: str, voice: str, lang: str) -> bytes:
        del lang
        speech_key = os.environ.get("AZURE_SPEECH_KEY")
        if not speech_key:
            raise TtsProviderUnavailable("azure speech credentials missing")
        # Prefer an explicit custom-subdomain endpoint when set. Required when
        # the Speech account has publicNetworkAccess=Disabled and is reached
        # via a private endpoint: the regional `*.tts.speech.microsoft.com`
        # and `*.api.cognitive.microsoft.com` hosts resolve to public IPs and
        # get blocked, but `<subdomain>.cognitiveservices.azure.com` resolves
        # to the PE's private IP via the linked private DNS zone.
        speech_endpoint = (os.environ.get("AZURE_SPEECH_ENDPOINT") or "").strip()
        speech_region = os.environ.get("AZURE_SPEECH_REGION") or "westeurope"
        try:
            import azure.cognitiveservices.speech as speechsdk  # pyright: ignore[reportMissingTypeStubs]
        except ImportError as exc:
            raise TtsProviderUnavailable("azure speech provider not installed") from exc

        if speech_endpoint:
            speech_config = speechsdk.SpeechConfig(subscription=speech_key, endpoint=speech_endpoint)
        else:
            speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
        speech_config.speech_synthesis_voice_name = voice
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3
        )
        synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)
        result = synthesizer.speak_text_async(text).get()
        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return bytes(result.audio_data)
        # CancellationDetails can itself raise SPXERR_INVALID_ARG when the
        # underlying handshake never completed, so guard the read.
        detail = str(result.reason)
        try:
            cd = speechsdk.CancellationDetails(result)
            detail = f"{cd.reason} code={cd.error_code} details={cd.error_details}"
        except Exception as exc:  # noqa: BLE001
            detail = f"{result.reason} (cancellation unreadable: {type(exc).__name__}: {exc})"
        raise TtsProviderError(f"azure speech synthesis failed: {detail}")
