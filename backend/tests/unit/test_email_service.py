from src.services.email_service import AzureCommunicationEmailService


def test_build_invitation_url_uses_public_root_entry_point():
    service = AzureCommunicationEmailService(
        connection_string='',
        sender_address='',
        sender_display_name='Wulo',
        public_app_url='https://staging-sen.wulo.ai',
    )

    assert service._build_invitation_url('invite-123') == 'https://staging-sen.wulo.ai/?invitationId=invite-123'


def test_build_family_invitation_url_uses_public_root_entry_point():
    service = AzureCommunicationEmailService(
        connection_string='',
        sender_address='',
        sender_display_name='Wulo',
        public_app_url='https://staging-sen.wulo.ai',
    )

    assert service._build_invitation_url('family-invite-123', query_param='familyInvitationId') == (
        'https://staging-sen.wulo.ai/?familyInvitationId=family-invite-123'
    )