"""Notification fan-out for safeguarding events.

Channels (B2C, single admin):
  - InAppChannel:   inserts an in-app notification row (admin sees red banner)
  - AdminEmail:     emails ADMIN_EMAIL via Azure Communication Services
  - AdminSms:       texts ADMIN_SMS_TO via Twilio
  - ParentEmail:    emails the account-owning parent

Severity matrix:
  critical → in-app + admin email + admin SMS + parent email
  high     → in-app + admin email + parent email
  medium   → in-app only
  low      → in-app only
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Callable, List, Mapping, Optional, Protocol

from .models import Severity
from .repository import SafeguardingEvent

logger = logging.getLogger(__name__)


ENV_ADMIN_EMAIL = "ADMIN_EMAIL"
ENV_ADMIN_SMS_TO = "ADMIN_SMS_TO"
ENV_TWILIO_SID = "TWILIO_ACCOUNT_SID"
ENV_TWILIO_TOKEN = "TWILIO_AUTH_TOKEN"
ENV_TWILIO_FROM = "TWILIO_FROM_NUMBER"
ENV_NOTIFICATIONS_DISABLED = "SAFEGUARDING_NOTIFICATIONS_DISABLED"
ENV_SHADOW_MODE = "SAFEGUARDING_SHADOW_MODE"


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    return raw in {"1", "true", "yes", "on"} if raw else default


@dataclass(frozen=True)
class DispatchResult:
    channels_attempted: List[str] = field(default_factory=list)
    channels_delivered: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Channel protocol + implementations
# ---------------------------------------------------------------------------


class NotificationChannel(Protocol):
    name: str

    def send(self, event: SafeguardingEvent) -> None: ...


@dataclass
class InAppChannel:
    """Writes a row the admin UI can render as a banner / list."""

    insert_row: Callable[[Mapping[str, Any]], None]
    name: str = "in_app"

    def send(self, event: SafeguardingEvent) -> None:
        self.insert_row(
            {
                "type": "safeguarding_alert",
                "severity": event.severity,
                "event_id": event.id,
                "title": _summary_title(event),
                "body": _summary_body(event),
                "created_at": event.created_at,
            }
        )


@dataclass
class AdminEmailChannel:
    send_email: Callable[[str, str, str, str], None]  # to, subject, plain, html
    admin_email: str
    name: str = "admin_email"

    def send(self, event: SafeguardingEvent) -> None:
        if not self.admin_email:
            return
        subject = f"[{event.severity.upper()}] Safeguarding alert"
        plain = _admin_email_plain(event)
        html = _admin_email_html(event)
        self.send_email(self.admin_email, subject, plain, html)


@dataclass
class ParentEmailChannel:
    send_email: Callable[[str, str, str, str], None]
    resolve_parent_email: Callable[[Optional[str]], Optional[str]]
    name: str = "parent_email"

    def send(self, event: SafeguardingEvent) -> None:
        parent_email = self.resolve_parent_email(event.parent_user_id)
        if not parent_email:
            return
        subject = "An important note about your child's recent session"
        plain = _parent_email_plain(event)
        html = _parent_email_html(event)
        self.send_email(parent_email, subject, plain, html)


@dataclass
class TwilioSmsChannel:
    sid: str
    token: str
    from_number: str
    to_number: str
    name: str = "admin_sms"

    def send(self, event: SafeguardingEvent) -> None:
        if not (self.sid and self.token and self.from_number and self.to_number):
            return
        try:
            # Imported lazily so the dependency is optional.
            from twilio.rest import Client  # type: ignore
        except Exception as exc:  # noqa: BLE001
            logger.warning("Twilio SDK not installed: %s", exc)
            return
        body = (
            f"Wulo safeguarding {event.severity.upper()}: "
            f"{', '.join(event.categories) or 'concern'}. "
            f"Open admin to review event {event.id[:8]}."
        )
        try:
            Client(self.sid, self.token).messages.create(
                to=self.to_number, from_=self.from_number, body=body[:320]
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Twilio send failed: %s", exc)
            raise


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------


# Severity → channel name set. Channels not registered are skipped silently.
_MATRIX: dict[str, frozenset[str]] = {
    Severity.CRITICAL.value: frozenset({"in_app", "admin_email", "admin_sms", "parent_email"}),
    Severity.HIGH.value: frozenset({"in_app", "admin_email", "parent_email"}),
    Severity.MEDIUM.value: frozenset({"in_app"}),
    Severity.LOW.value: frozenset({"in_app"}),
    Severity.NONE.value: frozenset(),
}


class SafeguardingNotifier:
    def __init__(self, channels: List[NotificationChannel]):
        self._channels = {c.name: c for c in channels}

    @property
    def enabled(self) -> bool:
        return not _flag(ENV_NOTIFICATIONS_DISABLED)

    @property
    def shadow_mode(self) -> bool:
        return _flag(ENV_SHADOW_MODE)

    def dispatch(self, event: SafeguardingEvent) -> DispatchResult:
        if not self.enabled:
            return DispatchResult(errors=["notifications_disabled"])
        wanted = _MATRIX.get(event.severity, frozenset())
        # In shadow mode, only in-app — operator reviews queue, no outbound.
        if self.shadow_mode:
            wanted = wanted & {"in_app"}

        attempted: List[str] = []
        delivered: List[str] = []
        errors: List[str] = []
        for name in wanted:
            channel = self._channels.get(name)
            if channel is None:
                continue
            attempted.append(name)
            try:
                channel.send(event)
                delivered.append(name)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Safeguarding notifier channel %s failed: %s", name, exc)
                errors.append(f"{name}: {exc!r}"[:200])
        return DispatchResult(channels_attempted=attempted, channels_delivered=delivered, errors=errors)


# ---------------------------------------------------------------------------
# Message helpers
# ---------------------------------------------------------------------------


def _summary_title(event: SafeguardingEvent) -> str:
    cats = ", ".join(event.categories) or "concern"
    return f"{event.severity.upper()}: {cats}"


def _summary_body(event: SafeguardingEvent) -> str:
    quote = event.evidence_quote.strip().replace("\n", " ")
    if len(quote) > 200:
        quote = quote[:197] + "..."
    return f'"{quote}"'


def _admin_email_plain(event: SafeguardingEvent) -> str:
    return (
        f"Safeguarding alert — severity {event.severity.upper()}\n\n"
        f"Categories: {', '.join(event.categories) or 'unspecified'}\n"
        f"Direction: {event.direction}\n"
        f"Time (UTC): {event.created_at}\n"
        f"Session: {event.session_id or 'unknown'}\n"
        f"Child: {event.child_id or 'unknown'}\n\n"
        f'Evidence: "{event.evidence_quote.strip()}"\n\n'
        f"Open the admin console to acknowledge and record the action taken.\n"
        f"Event id: {event.id}\n"
    )


def _admin_email_html(event: SafeguardingEvent) -> str:
    from html import escape

    return (
        f"<h2 style='color:#b74d3f'>Safeguarding alert — {escape(event.severity.upper())}</h2>"
        f"<p><b>Categories:</b> {escape(', '.join(event.categories) or 'unspecified')}</p>"
        f"<p><b>Direction:</b> {escape(event.direction)}<br/>"
        f"<b>Time (UTC):</b> {escape(event.created_at)}<br/>"
        f"<b>Session:</b> {escape(event.session_id or 'unknown')}<br/>"
        f"<b>Child:</b> {escape(event.child_id or 'unknown')}</p>"
        f"<blockquote>{escape(event.evidence_quote.strip())}</blockquote>"
        f"<p>Open the admin console to acknowledge and record the action taken.</p>"
        f"<p style='color:#888;font-size:12px'>Event id: {escape(event.id)}</p>"
    )


def _parent_email_plain(event: SafeguardingEvent) -> str:
    return (
        "Hello,\n\n"
        "During your child's session with our learning buddy today, our "
        "safety system flagged something we wanted to bring to your "
        "attention. We have paused or noted the moment and a member of "
        "our safeguarding team has been alerted.\n\n"
        "If you'd like to discuss what was said, please reply to this "
        "email and we will be in touch quickly. If you believe your child "
        "is in immediate danger, please contact the NSPCC helpline on "
        "0808 800 5000 or call 999.\n\n"
        "Thank you,\n"
        "The Wulo team\n"
    )


def _parent_email_html(event: SafeguardingEvent) -> str:
    return (
        "<p>Hello,</p>"
        "<p>During your child's session with our learning buddy today, our "
        "safety system flagged something we wanted to bring to your "
        "attention. We have paused or noted the moment and a member of "
        "our safeguarding team has been alerted.</p>"
        "<p>If you'd like to discuss what was said, please reply to this "
        "email and we will be in touch quickly. If you believe your child "
        "is in immediate danger, please contact the NSPCC helpline on "
        "<b>0808 800 5000</b> or call <b>999</b>.</p>"
        "<p>Thank you,<br/>The Wulo team</p>"
    )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def build_notifier(
    *,
    in_app_inserter: Optional[Callable[[Mapping[str, Any]], None]] = None,
    email_sender: Optional[Callable[[str, str, str, str], None]] = None,
    parent_email_resolver: Optional[Callable[[Optional[str]], Optional[str]]] = None,
    env: Optional[Mapping[str, str]] = None,
) -> SafeguardingNotifier:
    """Wire channels from env. Missing config silently disables that channel."""
    src = env if env is not None else os.environ
    channels: List[NotificationChannel] = []

    if in_app_inserter is not None:
        channels.append(InAppChannel(insert_row=in_app_inserter))

    admin_email = (src.get(ENV_ADMIN_EMAIL) or "").strip()
    if email_sender is not None and admin_email:
        channels.append(AdminEmailChannel(send_email=email_sender, admin_email=admin_email))

    if email_sender is not None and parent_email_resolver is not None:
        channels.append(
            ParentEmailChannel(
                send_email=email_sender,
                resolve_parent_email=parent_email_resolver,
            )
        )

    sid = (src.get(ENV_TWILIO_SID) or "").strip()
    token = (src.get(ENV_TWILIO_TOKEN) or "").strip()
    from_num = (src.get(ENV_TWILIO_FROM) or "").strip()
    to_num = (src.get(ENV_ADMIN_SMS_TO) or "").strip()
    if sid and token and from_num and to_num:
        channels.append(
            TwilioSmsChannel(sid=sid, token=token, from_number=from_num, to_number=to_num)
        )

    return SafeguardingNotifier(channels=channels)
