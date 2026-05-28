from abc import ABC, abstractmethod


class TtsProviderError(Exception):
    pass


class TtsProviderUnavailable(TtsProviderError):
    """Raised when provider is misconfigured (missing creds, etc.). Maps to 503."""


class TtsProvider(ABC):
    id: str

    @abstractmethod
    def synthesize(self, text: str, voice: str, lang: str) -> bytes:
        """Return MP3 audio bytes. Raise TtsProviderUnavailable if not configured."""
