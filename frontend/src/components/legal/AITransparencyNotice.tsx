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
    padding: 'clamp(1.5rem, 4vw, 2.5rem) clamp(1.5rem, 4vw, 2.5rem)',
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
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.82rem',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
  },
})

export function AITransparencyNotice() {
  const styles = useStyles()
  const navigate = useNavigate()

  return (
    <div className={styles.wrapper}>
    <div className={styles.page}>
      <Button
        appearance="subtle"
        icon={<ArrowLeftIcon className="w-4 h-4" />}
        className={styles.backButton}
        onClick={() => navigate('/')}
      >
        Back
      </Button>

      <div className={styles.header}>
        <Text as="h1" className={styles.title} block>AI Transparency Notice</Text>
        <Text className={styles.updated} block>Last updated: 8 April 2026 — Draft for solicitor review</Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>Overview</Text>
        <Text className={styles.body}>
          Wulo uses artificial intelligence (AI) to support therapist-supervised speech practice for children.
          This notice explains what AI does in Wulo, what data it processes, and how human oversight is maintained.
          We believe transparency about AI use is essential, especially when children are involved.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>What AI does in Wulo</Text>
        <Text className={styles.body}>AI is used in the following areas of the application:</Text>
        <ul className={styles.list}>
          <li><strong>Real-time speech feedback:</strong> during practice sessions, AI listens to the child's speech and provides pronunciation scoring and feedback. This helps the child practise specific sounds and words with immediate, encouraging guidance.</li>
          <li><strong>Practice session conversations:</strong> an AI-powered avatar (e.g. Clara, Aiden) guides the child through structured speech exercises, following the therapist's selected exercise plan.</li>
          <li><strong>Session summaries:</strong> after each session, AI generates a summary of what was practised, including pronunciation scores and areas for development. The therapist reviews these summaries.</li>
          <li><strong>Child memory profiles:</strong> AI proposes observations about a child's speech patterns, strengths, and challenges across multiple sessions. <strong>These proposals are always reviewed and approved by the supervising therapist before being stored.</strong></li>
          <li><strong>Practice plans and recommendations:</strong> AI suggests personalised practice exercises based on the child's progress. Therapists review and approve all recommendations.</li>
        </ul>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>What data AI processes</Text>
        <table className={styles.table}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={{ textAlign: 'left', padding: '8px', fontWeight: 700 }}>Data type</th>
              <th style={{ textAlign: 'left', padding: '8px', fontWeight: 700 }}>Purpose</th>
              <th style={{ textAlign: 'left', padding: '8px', fontWeight: 700 }}>Stored?</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '8px' }}>Speech audio (real-time stream)</td>
              <td style={{ padding: '8px' }}>Pronunciation assessment and speech-to-text</td>
              <td style={{ padding: '8px' }}>No — processed in real time, not retained</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '8px' }}>Session transcript (text)</td>
              <td style={{ padding: '8px' }}>Generate feedback, summaries, and memory proposals</td>
              <td style={{ padding: '8px' }}>Yes — retained with child profile</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '8px' }}>Child profile (name, notes)</td>
              <td style={{ padding: '8px' }}>Personalise practice conversations</td>
              <td style={{ padding: '8px' }}>Yes — retained until deletion</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '8px' }}>Child memory items</td>
              <td style={{ padding: '8px' }}>Generate contextual practice recommendations</td>
              <td style={{ padding: '8px' }}>Yes — therapist-approved only</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>AI providers and data location</Text>
        <Text className={styles.body}>
          All AI processing is performed by <strong>Microsoft Azure AI Services</strong>, including:
        </Text>
        <ul className={styles.list}>
          <li><strong>Azure AI Speech:</strong> speech-to-text, text-to-speech, and pronunciation assessment.</li>
          <li><strong>Azure OpenAI Service:</strong> conversational AI (session guidance), session analysis, memory proposals, and practice plan generation.</li>
        </ul>
        <Text className={styles.body}>
          Data is processed within the <strong>UK South</strong> and <strong>West Europe</strong> Azure regions.
          Microsoft's Azure AI Services operate under enterprise data protection agreements and do not use customer
          data to train or improve their AI models.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>Human oversight</Text>
        <Text className={styles.body}>
          AI in Wulo is designed to support — never replace — the professional judgement of a qualified therapist.
          The following safeguards ensure human oversight:
        </Text>
        <ul className={styles.list}>
          <li>All practice sessions are designed for therapist supervision.</li>
          <li>AI-generated child memory proposals must be explicitly approved by the therapist before being stored.</li>
          <li>AI-generated practice plans require therapist review and approval.</li>
          <li>AI-generated recommendations are labelled as AI-generated and presented for therapist assessment.</li>
          <li>Therapists can edit, reject, or delete any AI-generated content at any time.</li>
        </ul>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>Limitations</Text>
        <Text className={styles.body}>
          AI systems have limitations. Wulo's AI may occasionally:
        </Text>
        <ul className={styles.list}>
          <li>Produce inaccurate pronunciation scores, particularly for regional accents or atypical speech patterns.</li>
          <li>Generate observations that do not accurately reflect a child's abilities.</li>
          <li>Suggest exercises that may not be appropriate for a specific child's needs.</li>
        </ul>
        <Text className={styles.body}>
          This is why every AI output is subject to therapist review. The AI is a support tool, not a decision-maker.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>Your rights</Text>
        <Text className={styles.body}>
          You have the right to understand how AI affects you or your child. You may:
        </Text>
        <ul className={styles.list}>
          <li>Request an explanation of any AI-generated content in your child's profile.</li>
          <li>Request that specific AI-generated content be deleted.</li>
          <li>Withdraw consent for AI processing at any time (this will stop all practice sessions for the child).</li>
          <li>Access all data held about your child via the data export feature in Workspace settings.</li>
        </ul>
        <Text className={styles.body}>
          For more information about your data rights, see our <a href="/privacy">Privacy Policy</a>.
        </Text>
      </div>

      <div className={styles.section}>
        <Text className={styles.heading}>Contact</Text>
        <Text className={styles.body}>
          Questions about AI in Wulo? Contact: <strong>privacy@wulo.ai</strong>.
        </Text>
      </div>
    </div>
    </div>
  )
}
