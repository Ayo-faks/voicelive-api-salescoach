# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# ---------------------------------------------------------------------------------------------

"""Invitation email delivery via Azure Communication Services."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from html import escape
import logging
from typing import Any, Mapping, Optional
from urllib.parse import quote

try:
    from azure.communication.email import EmailClient
except ImportError:  # pragma: no cover - exercised only when dependency is missing
    EmailClient = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class InvitationEmailDeliveryResult:
    status: str
    attempted: bool
    delivered: bool
    provider_message_id: Optional[str] = None
    error: Optional[str] = None


class AzureCommunicationEmailService:
    """Thin wrapper for sending transactional invitation emails."""

    def __init__(
        self,
        *,
        connection_string: str,
        sender_address: str,
        sender_display_name: str,
        public_app_url: str,
    ):
        self._connection_string = connection_string.strip()
        self._sender_address = sender_address.strip()
        self._sender_display_name = sender_display_name.strip() or "Wulo"
        self._public_app_url = public_app_url.strip().rstrip("/")
        self._client = None
        self._disabled_reason: Optional[str] = None

        if EmailClient is None:
            self._disabled_reason = "azure-communication-email dependency is not installed"
            return

        if not self._connection_string or not self._sender_address or not self._public_app_url:
            self._disabled_reason = "Email service is not configured"
            return

        self._client = EmailClient.from_connection_string(self._connection_string)

    @classmethod
    def from_config(cls, config: Mapping[str, Any]) -> "AzureCommunicationEmailService":
        return cls(
            connection_string=str(config.get("azure_communication_services_connection_string") or ""),
            sender_address=str(config.get("azure_communication_services_sender_address") or ""),
            sender_display_name=str(config.get("azure_communication_services_sender_display_name") or "Wulo"),
            public_app_url=str(config.get("public_app_url") or ""),
        )

    def send_invitation_email(
        self,
        *,
        recipient_email: str,
        invitation_id: str,
        child_name: str,
        inviter_name: str,
        relationship: str,
        expires_at: Optional[str] = None,
    ) -> InvitationEmailDeliveryResult:
        if self._client is None:
            return InvitationEmailDeliveryResult(
                status="not_configured",
                attempted=False,
                delivered=False,
                error=self._disabled_reason,
            )

        invitation_url = self._build_invitation_url(invitation_id)
        subject = f"Wulo invitation for {child_name}"
        expiry_copy = self._format_expiry(expires_at)
        relationship_copy = relationship.replace("_", " ").strip() or "parent"
        plain_text = (
            f"{inviter_name} invited you to Wulo for {child_name}.\n\n"
            f"Open this link to sign in and review the invitation: {invitation_url}\n\n"
            f"Access type: {relationship_copy}.\n"
            f"{expiry_copy}"
        )
        html = (
            f"<html><body>"
            f"<p>{escape(inviter_name)} invited you to Wulo for <strong>{escape(child_name)}</strong>.</p>"
            f"<p><a href=\"{escape(invitation_url)}\">Open Wulo and review the invitation</a></p>"
            f"<p>Access type: {escape(relationship_copy)}.</p>"
            f"<p>{escape(expiry_copy)}</p>"
            f"</body></html>"
        )
        message = {
            "senderAddress": self._sender_address,
            "content": {
                "subject": subject,
                "plainText": plain_text,
                "html": html,
            },
            "recipients": {
                "to": [
                    {
                        "address": recipient_email,
                        "displayName": recipient_email,
                    }
                ]
            },
            "headers": {
                "X-Wulo-Invitation-Id": invitation_id,
            },
        }

        try:
            poller = self._client.begin_send(message)
            response = poller.result()
        except Exception as error:  # pragma: no cover - network/provider failure path
            logger.exception("Failed to send invitation email for %s", invitation_id)
            return InvitationEmailDeliveryResult(
                status="failed",
                attempted=True,
                delivered=False,
                error=str(error),
            )

        return InvitationEmailDeliveryResult(
            status="sent",
            attempted=True,
            delivered=True,
            provider_message_id=self._extract_message_id(response),
        )

    def _build_invitation_url(self, invitation_id: str) -> str:
        return f"{self._public_app_url}/?invitationId={quote(invitation_id)}"

    def _format_expiry(self, expires_at: Optional[str]) -> str:
        if not expires_at:
            return "This invitation does not currently show an expiration date."

        normalized = expires_at.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return f"This invitation expires on {expires_at}."

        return f"This invitation expires on {parsed.strftime('%b %d, %Y at %H:%M %Z').strip()}."

    def _extract_message_id(self, response: Any) -> Optional[str]:
        if isinstance(response, Mapping):
            for key in ("id", "messageId", "message_id"):
                value = response.get(key)
                if value:
                    return str(value)

        for key in ("id", "messageId", "message_id"):
            value = getattr(response, key, None)
            if value:
                return str(value)

        return None