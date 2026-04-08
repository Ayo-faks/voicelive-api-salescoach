/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Text, makeStyles } from '@fluentui/react-components'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { useNavigate } from 'react-router-dom'

const useStyles = makeStyles({
  page: {
    maxWidth: '780px',
    margin: '0 auto',
    padding: 'var(--space-xl)',
    display: 'grid',
    gap: 'var(--space-lg)',
  },
  backButton: {
    justifySelf: 'start',
    fontFamily: 'var(--font-display)',
    fontWeight: '600',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(1.6rem, 3.5vw, 2.2rem)',
    fontWeight: '800',
    letterSpacing: '-0.04em',
    color: 'var(--color-text-primary)',
  },
  updated: {
    color: 'var(--color-text-tertiary)',
    fontSize: '0.8rem',
  },
  section: {
    display: 'grid',
    gap: 'var(--space-sm)',
  },
  heading: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.15rem',
    fontWeight: '700',
    color: 'var(--color-text-primary)',
  },
  body: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.9rem',
    lineHeight: 1.7,
  },
  list: {
    color: 'var(--color-text-secondary)',
    fontSize: '0.9rem',
    lineHeight: 1.7,
    paddingLeft: '1.5rem',
    margin: 0,
    display: 'grid',
    gap: '4px',
  },
})

export function PrivacyPolicy() {
  const styles = useStyles()
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <Button
        appearance="subtle"
        icon={<ArrowLeftIcon className="w-4 h-4" />}
        className={styles.backButton}
        onClick={() => navigate(-1)}
      >
        Back
      </Button>

      <div>
        <Text as="h1" className={styles.title} block>Privacy Policy</Text>
        <Text className={styles.updated}>Last updated: 8 April 2026 — Draft for solicitor review</Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>1. Who we are</Text>
        <Text className={styles.body}>
          Wulo ("we", "us", "our") provides a therapist-supervised speech practice platform for children with
          Special Educational Needs (SEN). This privacy policy explains how we collect, use, store and protect
          personal data when you use our application.
        </Text>
        <Text className={styles.body}>
          For the purposes of UK GDPR, we are the data controller. Contact us at: <strong>privacy@wulo.ai</strong>.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>2. What data we collect</Text>
        <Text className={styles.body}>We collect and process the following categories of personal data:</Text>
        <ul className={styles.list}>
          <li><strong>Therapist account data:</strong> name, email address, role, identity provider, account creation date.</li>
          <li><strong>Parent/guardian account data:</strong> name, email address, relationship to child.</li>
          <li><strong>Child profile data:</strong> first name, date of birth (optional), therapist notes.</li>
          <li><strong>Session data:</strong> practice session transcripts, AI-generated feedback, pronunciation assessments, session duration and timestamps.</li>
          <li><strong>Child memory data:</strong> AI-generated observations about a child's speech patterns, strengths, and areas for development, reviewed and approved by the supervising therapist.</li>
          <li><strong>Practice plans:</strong> AI-generated and therapist-approved practice recommendations.</li>
          <li><strong>Speech audio:</strong> real-time audio streamed during practice sessions for AI-powered speech assessment. Audio is processed in real time and is not stored after the session ends.</li>
        </ul>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>3. Lawful basis for processing</Text>
        <Text className={styles.body}>We process personal data on the following lawful bases under UK GDPR:</Text>
        <ul className={styles.list}>
          <li><strong>Consent (Article 6(1)(a)):</strong> parental/guardian consent is obtained before any child data is processed. Consent can be withdrawn at any time.</li>
          <li><strong>Legitimate interests (Article 6(1)(f)):</strong> for therapist account management and platform security.</li>
          <li><strong>Contract (Article 6(1)(b)):</strong> to provide the service to subscribing organisations (NHS trusts, local authorities, independent practices).</li>
        </ul>
        <Text className={styles.body}>
          As children's data may relate to health-adjacent information, we treat it as special category data and rely on explicit consent (Article 9(2)(a)).
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>4. How we use your data</Text>
        <ul className={styles.list}>
          <li>Provide therapist-supervised speech practice sessions for children.</li>
          <li>Generate AI-powered pronunciation assessments and practice feedback.</li>
          <li>Create and maintain child memory profiles to personalise practice across sessions.</li>
          <li>Generate practice plans and exercise recommendations.</li>
          <li>Enable therapist review and oversight of all AI-generated content.</li>
          <li>Monitor platform security and prevent misuse.</li>
        </ul>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>5. Third-party processors</Text>
        <Text className={styles.body}>We use the following third-party data processors:</Text>
        <ul className={styles.list}>
          <li><strong>Microsoft Azure AI Services:</strong> speech-to-text, text-to-speech, pronunciation assessment, and large language model (LLM) processing. Data is processed within the UK South and West Europe Azure regions.</li>
          <li><strong>Microsoft Azure (hosting):</strong> application hosting, database (PostgreSQL), and file storage.</li>
          <li><strong>Microsoft Entra ID:</strong> authentication and identity management.</li>
        </ul>
        <Text className={styles.body}>
          All processors are bound by Data Processing Agreements and comply with UK GDPR. We do not sell, share, or
          transfer personal data to any third party for marketing purposes.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>6. Cookies and local storage</Text>
        <Text className={styles.body}>
          We use cookies and browser storage as follows:
        </Text>
        <ul className={styles.list}>
          <li><strong>Essential (always active):</strong> Authentication session cookie (set by Azure), UI preferences stored in localStorage (e.g. onboarding status, view mode). These are strictly necessary for the app to function.</li>
          <li><strong>Analytics (opt-in only):</strong> Microsoft Clarity sets cookies (<code>_clck</code>, <code>_clsk</code>) for session replays and usage analytics. These are only loaded after you give consent via our cookie banner. You can change your preference at any time.</li>
        </ul>
        <Text className={styles.body}>
          We do not use any advertising or tracking cookies.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>7. Data retention</Text>
        <ul className={styles.list}>
          <li><strong>Speech audio:</strong> processed in real time during sessions. Not stored after the session ends.</li>
          <li><strong>Session transcripts and assessments:</strong> retained for 6 months of inactivity, then automatically deleted.</li>
          <li><strong>Child profiles and memory data:</strong> automatically soft-deleted after 6 months of inactivity. Hard-deleted 1 month later unless reactivated. Parents or therapists may also request immediate deletion at any time.</li>
          <li><strong>Therapist/parent accounts:</strong> retained until account deletion is requested.</li>
        </ul>
        <Text className={styles.body}>
          When data is deleted, it is permanently removed from all active systems. Backups containing deleted data are overwritten within 30 days.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>8. Children's data and the ICO Children's Code</Text>
        <Text className={styles.body}>
          Wulo is designed to comply with the ICO Age Appropriate Design Code (Children's Code). Key measures include:
        </Text>
        <ul className={styles.list}>
          <li>Parental/guardian consent is required before any child data is processed.</li>
          <li>Data collection is minimised to what is necessary for speech practice.</li>
          <li>All AI-generated content about children is reviewed by a supervising therapist before being stored.</li>
          <li>Children's data is never used for profiling, marketing, or any purpose beyond supervised speech practice.</li>
          <li>Default settings are set to maximum privacy.</li>
          <li>A Data Protection Impact Assessment (DPIA) has been completed for the processing of children's data with AI.</li>
        </ul>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>9. Your rights</Text>
        <Text className={styles.body}>Under UK GDPR, you have the following rights:</Text>
        <ul className={styles.list}>
          <li><strong>Right of access:</strong> request a copy of all data we hold about you or your child.</li>
          <li><strong>Right to rectification:</strong> request correction of inaccurate data.</li>
          <li><strong>Right to erasure:</strong> request deletion of all data. Available via the Workspace settings page or by contacting us.</li>
          <li><strong>Right to withdraw consent:</strong> withdraw parental consent at any time. This will stop all data processing for the child.</li>
          <li><strong>Right to data portability:</strong> receive your data in a machine-readable format (JSON).</li>
          <li><strong>Right to lodge a complaint:</strong> with the Information Commissioner's Office (ICO) at ico.org.uk.</li>
        </ul>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>10. Security</Text>
        <Text className={styles.body}>
          We implement appropriate technical and organisational measures to protect personal data, including:
          encryption in transit (TLS 1.2+), encryption at rest, role-based access control, audit logging,
          and regular security reviews. See our <a href="https://github.com/AyoCodess/voicelive-api-salescoach/blob/main/SECURITY.md" target="_blank" rel="noreferrer">Security Policy</a> for vulnerability disclosure procedures.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>11. Changes to this policy</Text>
        <Text className={styles.body}>
          We may update this privacy policy from time to time. Changes will be posted on this page with an updated
          "last updated" date. If changes are significant, we will notify you via the application.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>Contact</Text>
        <Text className={styles.body}>
          For questions about this privacy policy or to exercise your data rights, contact: <strong>privacy@wulo.ai</strong>.
        </Text>
      </div>
    </div>
  )
}
