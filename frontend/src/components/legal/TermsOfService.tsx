/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Text, makeStyles } from '@fluentui/react-components'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { useNavigate } from 'react-router-dom'

const useStyles = makeStyles({
  wrapper: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, rgba(233, 245, 246, 0.98), rgba(224, 239, 241, 0.98))',
    padding: 'var(--space-xl) var(--space-md)',
  },
  page: {
    maxWidth: '720px',
    margin: '0 auto',
    padding: 'clamp(1.5rem, 4vw, 2.5rem)',
    display: 'grid',
    gap: 'var(--space-lg)',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    border: '1px solid rgba(13, 138, 132, 0.10)',
    borderRadius: '12px',
  },
  backButton: {
    justifySelf: 'start',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
    color: 'var(--color-primary, #0d8a84)',
  },
  header: {
    display: 'grid',
    gap: '8px',
    paddingBottom: 'var(--space-md, 16px)',
    borderBottom: '1px solid rgba(13, 138, 132, 0.12)',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(1.6rem, 3.5vw, 2.2rem)',
    fontWeight: '800',
    letterSpacing: '-0.04em',
    lineHeight: 1.2,
    color: 'var(--color-text-primary)',
    marginBottom: '0',
  },
  updated: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.78rem',
    lineHeight: 1.4,
    letterSpacing: '0.01em',
  },
  section: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  heading: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.1rem',
    fontWeight: '700',
    color: 'var(--color-text-primary)',
    marginTop: 'var(--space-xs, 4px)',
  },
  body: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.88rem',
    lineHeight: 1.8,
  },
  list: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.88rem',
    lineHeight: 1.8,
    paddingLeft: '1.4rem',
    margin: 0,
    display: 'grid',
    gap: '6px',
  },
})

export function TermsOfService() {
  const styles = useStyles()
  const navigate = useNavigate()

  return (
    <div className={styles.wrapper}>
    <div className={styles.page}>
      <Button
        appearance="subtle"
        icon={<ArrowLeftIcon className="w-4 h-4" />}
        className={styles.backButton}
        onClick={() => navigate(-1)}
      >
        Back
      </Button>

      <div className={styles.header}>
        <Text as="h1" className={styles.title} block>Terms of Service</Text>
        <Text className={styles.updated} block>Last updated: 8 April 2026 — Draft for solicitor review</Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>1. Acceptance of terms</Text>
        <Text className={styles.body}>
          By accessing or using Wulo ("the Service"), you agree to be bound by these Terms of Service. If you do not
          agree before using the Service, you must not access or use it. If you are using the Service on behalf of an
          organisation (e.g. an NHS trust, local authority, or independent practice), you represent that you have
          authority to bind that organisation to these terms.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>2. Description of service</Text>
        <Text className={styles.body}>
          Wulo is a therapist-supervised speech practice platform for children with Special Educational Needs (SEN).
          The Service uses AI to provide real-time pronunciation feedback, practice plans, and progress tracking under
          the supervision of a qualified speech and language therapist or educator.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>3. Supervised use only</Text>
        <Text className={styles.body}>
          The Service is designed exclusively for use under the supervision of a qualified therapist or educator.
          It must not be used as a substitute for clinical assessment, diagnosis, or unsupervised therapeutic intervention.
        </Text>
        <ul className={styles.list}>
          <li>All AI-generated feedback, recommendations, and observations are for supervised practice support only.</li>
          <li>Therapists are responsible for reviewing and approving all AI-generated content before clinical decisions are made.</li>
          <li>The Service does not provide medical advice, diagnosis, or treatment.</li>
        </ul>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>4. User roles and responsibilities</Text>
        <Text className={styles.body}><strong>Therapists and educators:</strong></Text>
        <ul className={styles.list}>
          <li>Must hold appropriate professional qualifications.</li>
          <li>Are responsible for obtaining parental/guardian consent before creating a child profile.</li>
          <li>Must review all AI-generated content (memory items, practice plans, recommendations) before acting on them.</li>
          <li>Must supervise all practice sessions or delegate supervision appropriately.</li>
        </ul>
        <Text className={styles.body}><strong>Parents and guardians:</strong></Text>
        <ul className={styles.list}>
          <li>Must provide informed consent before their child's data is processed.</li>
          <li>May supervise practice sessions at home when authorised by the therapist.</li>
          <li>May withdraw consent and request data deletion at any time.</li>
        </ul>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>5. Account security</Text>
        <Text className={styles.body}>
          You are responsible for maintaining the security of your account credentials. You must immediately notify us
          of any unauthorised access or security breach. We are not liable for losses arising from unauthorised use of
          your account.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>6. Acceptable use</Text>
        <Text className={styles.body}>You agree not to:</Text>
        <ul className={styles.list}>
          <li>Use the Service for any purpose other than supervised speech practice.</li>
          <li>Attempt to reverse-engineer, decompile, or extract the AI models or algorithms.</li>
          <li>Upload or transmit harmful, offensive, or unlawful content.</li>
          <li>Share access credentials with unauthorised individuals.</li>
          <li>Use the Service in a manner that violates any applicable law or regulation.</li>
        </ul>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>7. Intellectual property</Text>
        <Text className={styles.body}>
          The Service, including its design, software, AI models, and documentation, is owned by or licensed to us and
          protected by copyright, trademark, and other intellectual property laws. You are granted a limited,
          non-exclusive, non-transferable licence to use the Service for its intended purpose.
        </Text>
        <Text className={styles.body}>
          Session data, child profiles, and other content you create using the Service remain your property. You grant
          us a limited licence to process this data solely to provide the Service.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>8. Limitation of liability</Text>
        <Text className={styles.body}>
          To the maximum extent permitted by law, the Service is provided "as is" without warranties of any kind,
          express or implied. We do not warrant that the Service will be uninterrupted, error-free, or suitable for
          clinical decision-making without therapist oversight.
        </Text>
        <Text className={styles.body}>
          We shall not be liable for any indirect, incidental, special, or consequential damages arising from the use
          or inability to use the Service. Our total liability shall not exceed the amount paid for the Service in the
          12 months preceding the claim.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>9. Data protection</Text>
        <Text className={styles.body}>
          Our collection and use of personal data is governed by our{' '}
          <a href="/privacy">Privacy Policy</a>. By using the Service, you acknowledge that you have read and
          understood our privacy practices.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>10. Termination</Text>
        <Text className={styles.body}>
          We may suspend or terminate your access to the Service if you breach these terms, or for any reason with
          reasonable notice. Upon termination, you may request export of your data in accordance with our Privacy Policy.
          We will delete your data within 30 days of account closure unless retention is required by law.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>11. Modifications</Text>
        <Text className={styles.body}>
          We reserve the right to modify these terms at any time. Material changes will be communicated through the
          application at least 30 days before they take effect. Continued use of the Service after changes take effect
          constitutes acceptance of the modified terms.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>12. Governing law</Text>
        <Text className={styles.body}>
          These terms are governed by the laws of England and Wales. Any disputes arising from these terms shall be
          subject to the exclusive jurisdiction of the courts of England and Wales.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>Contact</Text>
        <Text className={styles.body}>
          For questions about these terms, contact: <strong>privacy@wulo.ai</strong>.
        </Text>
      </div>
    </div>
    </div>
  )
}
