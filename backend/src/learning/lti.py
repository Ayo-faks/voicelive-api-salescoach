"""LTI 1.3 launch contracts and verification for Pathfinder Learn."""

from __future__ import annotations

import json
import secrets
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence
from urllib import request as urllib_request

import jwt
from jwt import PyJWKSet
from pydantic import ConfigDict, Field, field_validator

from src.learning.errors import LearningApiError
from src.learning.models import ContractModel


DEPLOYMENT_ID_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/deployment_id"
MESSAGE_TYPE_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/message_type"
VERSION_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/version"
RESOURCE_LINK_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/resource_link"
ROLES_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/roles"
CONTEXT_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/context"


class LTIValidationError(LearningApiError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=401)


class LTIPlatformConfig(ContractModel):
    issuer: str = Field(min_length=1)
    client_id: str = Field(min_length=1)
    auth_login_url: str = Field(min_length=1)
    auth_token_url: str = Field(min_length=1)
    jwks_url: str = Field(min_length=1)
    deployment_ids: List[str] = Field(min_length=1)
    audience: Optional[str] = None


class LTIResourceLink(ContractModel):
    id: str = Field(min_length=1)
    title: Optional[str] = None


class LTIContext(ContractModel):
    id: str = Field(min_length=1)
    label: Optional[str] = None
    title: Optional[str] = None


class LTILaunchClaims(ContractModel):
    model_config = ConfigDict(extra="ignore", validate_assignment=True, populate_by_name=True)

    iss: str = Field(min_length=1)
    aud: str | List[str]
    sub: str = Field(min_length=1)
    nonce: str = Field(min_length=1)
    exp: int
    iat: int
    deployment_id: str = Field(alias=DEPLOYMENT_ID_CLAIM, min_length=1)
    message_type: str = Field(alias=MESSAGE_TYPE_CLAIM)
    version: str = Field(alias=VERSION_CLAIM)
    resource_link: LTIResourceLink = Field(alias=RESOURCE_LINK_CLAIM)
    roles: List[str] = Field(alias=ROLES_CLAIM)
    context: LTIContext = Field(alias=CONTEXT_CLAIM)

    @field_validator("message_type")
    @classmethod
    def validate_message_type(cls, value: str) -> str:
        if value != "LtiResourceLinkRequest":
            raise ValueError("unsupported LTI message type")
        return value

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: str) -> str:
        if value != "1.3.0":
            raise ValueError("unsupported LTI version")
        return value

    def audience_values(self) -> List[str]:
        return self.aud if isinstance(self.aud, list) else [self.aud]


class LTIState(ContractModel):
    state: str = Field(min_length=1)
    nonce: str = Field(min_length=1)
    issuer: str = Field(min_length=1)
    client_id: str = Field(min_length=1)
    target_link_uri: str = Field(min_length=1)
    lti_message_hint: Optional[str] = None
    deployment_id: Optional[str] = None
    expires_at: float


class LTIStateStore:
    def __init__(self, ttl_seconds: int = 600) -> None:
        self.ttl_seconds = ttl_seconds
        self._states: Dict[str, LTIState] = {}
        self._lock = threading.Lock()

    def create(
        self,
        *,
        issuer: str,
        client_id: str,
        target_link_uri: str,
        lti_message_hint: Optional[str] = None,
        deployment_id: Optional[str] = None,
    ) -> LTIState:
        now = time.time()
        state = LTIState(
            state=secrets.token_urlsafe(32),
            nonce=secrets.token_urlsafe(32),
            issuer=issuer,
            client_id=client_id,
            target_link_uri=target_link_uri,
            lti_message_hint=lti_message_hint,
            deployment_id=deployment_id,
            expires_at=now + self.ttl_seconds,
        )
        with self._lock:
            self._purge_expired(now)
            self._states[state.state] = state
        return state

    def pop(self, state: str) -> LTIState:
        now = time.time()
        with self._lock:
            self._purge_expired(now)
            record = self._states.pop(state, None)
        if record is None or record.expires_at < now:
            raise LTIValidationError("invalid or expired LTI state")
        return record

    def _purge_expired(self, now: float) -> None:
        expired = [state for state, record in self._states.items() if record.expires_at < now]
        for state in expired:
            self._states.pop(state, None)


JWKSProvider = Callable[[LTIPlatformConfig], Mapping[str, Any]]


def fetch_jwks(config: LTIPlatformConfig) -> Mapping[str, Any]:
    with urllib_request.urlopen(config.jwks_url, timeout=5) as response:  # noqa: S310 - configured platform URL
        return json.loads(response.read().decode("utf-8"))


class LTILaunchVerifier:
    def __init__(
        self,
        platforms: Sequence[LTIPlatformConfig],
        jwks_provider: JWKSProvider,
        *,
        clock_skew_seconds: int = 60,
        supported_algorithms: Sequence[str] = ("RS256",),
    ) -> None:
        self.platforms = list(platforms)
        self.jwks_provider = jwks_provider
        self.clock_skew_seconds = clock_skew_seconds
        self.supported_algorithms = tuple(supported_algorithms)
        self._used_nonces: Dict[str, float] = {}
        self._lock = threading.Lock()

    def find_platform(
        self,
        *,
        issuer: str,
        client_id: Optional[str] = None,
        deployment_id: Optional[str] = None,
    ) -> LTIPlatformConfig:
        matches = [platform for platform in self.platforms if platform.issuer == issuer]
        if client_id:
            matches = [platform for platform in matches if platform.client_id == client_id]
        if deployment_id:
            matches = [platform for platform in matches if deployment_id in platform.deployment_ids]
        if not matches:
            raise LTIValidationError("unknown LTI platform")
        if len(matches) > 1:
            raise LTIValidationError("ambiguous LTI platform")
        return matches[0]

    def verify(self, id_token: str) -> LTILaunchClaims:
        try:
            unverified_header = jwt.get_unverified_header(id_token)
            unverified_claims = jwt.decode(id_token, options={"verify_signature": False})
        except jwt.PyJWTError as exc:
            raise LTIValidationError("invalid LTI id_token") from exc

        issuer = str(unverified_claims.get("iss") or "")
        audience = unverified_claims.get("aud")
        audiences = audience if isinstance(audience, list) else [audience]
        audience_values = {str(item) for item in audiences if item}
        platform_matches = [
            platform
            for platform in self.platforms
            if platform.issuer == issuer and (platform.audience or platform.client_id) in audience_values
        ]
        if not platform_matches:
            raise LTIValidationError("unknown LTI platform")
        if len(platform_matches) > 1:
            raise LTIValidationError("ambiguous LTI platform")
        platform = platform_matches[0]
        expected_audience = platform.audience or platform.client_id
        algorithm = str(unverified_header.get("alg") or "")
        if algorithm not in self.supported_algorithms:
            raise LTIValidationError("unsupported LTI signing algorithm")
        signing_key = self._signing_key(platform, str(unverified_header.get("kid") or ""))

        try:
            decoded = jwt.decode(
                id_token,
                key=signing_key,
                algorithms=[algorithm],
                audience=expected_audience,
                issuer=platform.issuer,
                leeway=self.clock_skew_seconds,
                options={"require": ["iss", "aud", "sub", "nonce", "exp", "iat"]},
            )
            claims = LTILaunchClaims.model_validate(decoded)
        except (jwt.PyJWTError, ValueError) as exc:
            raise LTIValidationError("invalid LTI launch claims") from exc

        if claims.deployment_id not in platform.deployment_ids:
            raise LTIValidationError("unknown LTI deployment")
        self._record_nonce(claims.nonce, claims.exp)
        return claims

    def _signing_key(self, platform: LTIPlatformConfig, key_id: str) -> Any:
        try:
            jwks = PyJWKSet.from_dict(dict(self.jwks_provider(platform)))
        except Exception as exc:
            raise LTIValidationError("unable to load LTI JWKS") from exc
        for key in jwks.keys:
            if not key_id or key.key_id == key_id:
                return key.key
        raise LTIValidationError("unknown LTI signing key")

    def _record_nonce(self, nonce: str, exp: int) -> None:
        now = time.time()
        with self._lock:
            expired = [stored for stored, expiry in self._used_nonces.items() if expiry + self.clock_skew_seconds < now]
            for stored in expired:
                self._used_nonces.pop(stored, None)
            if nonce in self._used_nonces:
                raise LTIValidationError("reused LTI nonce")
            self._used_nonces[nonce] = float(exp)


def session_expiry_timestamp(ttl_seconds: int = 900) -> int:
    return int(datetime.now(timezone.utc).timestamp()) + ttl_seconds
