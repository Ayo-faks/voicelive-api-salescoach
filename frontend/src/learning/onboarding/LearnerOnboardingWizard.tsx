/**
 * 3-step learner onboarding wizard (Pathfinder slice 2).
 *
 * Step 1: identity + required consents (terms, privacy, AI notice) + optional analytics.
 * Step 2: exam + year group + up to 6 subject chips.
 * Step 3: interests, career consent, optional guardian contact → finish PATCH.
 *
 * Renders via Fluent + plain HTML inputs to avoid widening the component
 * surface. All state is local; persistence flows through the
 * `useLearnerProfile` hook passed in by the parent.
 */
import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  Text,
  Checkbox,
  Input,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components'
import { useNavigate } from 'react-router-dom'

import type {
  ConsentInput,
  LearnerProfile,
  LearnerProfilePatch,
  LearnerProfileResponse,
} from '../../services/api'

export interface LearnerOnboardingWizardProps {
  profile: LearnerProfile | null
  isLoading: boolean
  patch: (patch: LearnerProfilePatch) => Promise<LearnerProfileResponse>
  recordConsent: (input: ConsentInput) => Promise<LearnerProfileResponse>
  /** Optional override for the post-finish destination — defaults to `/home`. */
  onComplete?: () => void
}

const EXAM_OPTIONS = ['WAEC', 'NECO', 'JAMB', 'Junior WAEC', 'IGCSE', 'A-Level']
const YEAR_OPTIONS = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3']
const AGE_BAND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'under-13', label: 'Under 13' },
  { value: '13-15', label: '13–15' },
  { value: '16-17', label: '16–17' },
  { value: '18-24', label: '18–24' },
  { value: '25-plus', label: '25+' },
]
const SUBJECTS_BY_EXAM: Record<string, string[]> = {
  WAEC: [
    'Mathematics',
    'English Language',
    'Basic Science',
    'Biology',
    'Chemistry',
    'Physics',
    'Economics',
    'Literature',
  ],
  NECO: [
    'Mathematics',
    'English Language',
    'Biology',
    'Chemistry',
    'Physics',
    'Economics',
  ],
  JAMB: [
    'Mathematics',
    'English Language',
    'Biology',
    'Chemistry',
    'Physics',
    'Economics',
  ],
  'Junior WAEC': [
    'Mathematics',
    'English Language',
    'Basic Science',
    'Social Studies',
  ],
  IGCSE: ['Mathematics', 'English Language', 'Biology', 'Chemistry', 'Physics'],
  'A-Level': [
    'Mathematics',
    'Further Maths',
    'Biology',
    'Chemistry',
    'Physics',
    'Economics',
  ],
}
const INTEREST_OPTIONS = [
  'Engineering',
  'Medicine',
  'Data',
  'Business',
  'Design',
  'Software',
  'Education',
  'Arts',
  'Law',
  'Sports',
]

const MAX_SUBJECTS = 6
const MAX_INTERESTS = 8
const CURRENT_CONSENT_VERSION = '2026-05-01'

const useStyles = makeStyles({
  root: {
    maxWidth: '720px',
    margin: '0 auto',
    padding: '24px 16px 48px',
    display: 'grid',
    gap: '20px',
  },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: '12px',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    padding: '24px',
    display: 'grid',
    gap: '16px',
  },
  progress: {
    display: 'flex',
    gap: '8px',
    fontSize: '13px',
    color: tokens.colorNeutralForeground3,
  },
  field: { display: 'grid', gap: '6px' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  chip: {
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
    borderRadius: '999px',
    padding: '6px 14px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '13px',
  },
  chipActive: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    ...shorthands.borderColor(tokens.colorBrandStroke1),
  },
  actions: { display: 'flex', justifyContent: 'space-between', gap: '12px' },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: '13px' },
})

type Step = 1 | 2 | 3

interface Step1State {
  display_name: string
  age_band: string
  locale: string
  country: string
  terms: boolean
  privacy: boolean
  ai_notice: boolean
  analytics_consent: boolean
}

interface Step2State {
  exam: string
  year_group: string
  subjects: string[]
}

interface Step3State {
  interests: string[]
  career_consent: boolean
  guardian_email: string
  guardian_relationship: string
}

function initialStep1(profile: LearnerProfile | null): Step1State {
  return {
    display_name:
      typeof profile?.display_name === 'string' ? profile.display_name : '',
    age_band: typeof profile?.age_band === 'string' ? profile.age_band : '',
    locale: typeof profile?.locale === 'string' ? profile.locale : 'en-NG',
    country: typeof profile?.country === 'string' ? profile.country : 'NG',
    terms: false,
    privacy: false,
    ai_notice: false,
    analytics_consent: false,
  }
}

function initialStep2(profile: LearnerProfile | null): Step2State {
  const subjects = Array.isArray(profile?.subjects)
    ? (profile?.subjects as string[])
    : []
  return {
    exam: typeof profile?.exam === 'string' ? profile.exam : 'WAEC',
    year_group:
      typeof profile?.year_group === 'string' ? profile.year_group : 'SS2',
    subjects: subjects.slice(0, MAX_SUBJECTS),
  }
}

function initialStep3(profile: LearnerProfile | null): Step3State {
  const interests = Array.isArray(profile?.interests)
    ? (profile?.interests as string[])
    : []
  return {
    interests: interests.slice(0, MAX_INTERESTS),
    career_consent: false,
    guardian_email:
      typeof profile?.guardian_email === 'string' ? profile.guardian_email : '',
    guardian_relationship:
      typeof profile?.guardian_relationship === 'string'
        ? profile.guardian_relationship
        : '',
  }
}

export function LearnerOnboardingWizard({
  profile,
  isLoading,
  patch,
  recordConsent,
  onComplete,
}: LearnerOnboardingWizardProps): JSX.Element {
  const styles = useStyles()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(1)
  const [s1, setS1] = useState<Step1State>(() => initialStep1(profile))
  const [s2, setS2] = useState<Step2State>(() => initialStep2(profile))
  const [s3, setS3] = useState<Step3State>(() => initialStep3(profile))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const availableSubjects = useMemo(
    () => SUBJECTS_BY_EXAM[s2.exam] ?? SUBJECTS_BY_EXAM.WAEC,
    [s2.exam]
  )

  const goNext = useCallback(async () => {
    setError(null)
    if (step === 1) {
      if (!s1.display_name.trim()) {
        setError('Please enter your name.')
        return
      }
      if (!s1.age_band) {
        setError('Please pick your age band.')
        return
      }
      if (!s1.terms || !s1.privacy || !s1.ai_notice) {
        setError(
          'Please confirm the terms, privacy notice, and AI notice to continue.'
        )
        return
      }
      setSubmitting(true)
      try {
        await recordConsent({
          kind: 'terms',
          version: CURRENT_CONSENT_VERSION,
          granted: true,
        })
        await recordConsent({
          kind: 'privacy',
          version: CURRENT_CONSENT_VERSION,
          granted: true,
        })
        await recordConsent({
          kind: 'ai_notice',
          version: CURRENT_CONSENT_VERSION,
          granted: true,
        })
        if (s1.analytics_consent) {
          await recordConsent({
            kind: 'analytics',
            version: CURRENT_CONSENT_VERSION,
            granted: true,
          })
        }
        await patch({
          display_name: s1.display_name.trim(),
          age_band: s1.age_band,
          locale: s1.locale.trim() || 'en-NG',
          country: s1.country.trim() || 'NG',
        })
        setStep(2)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save step 1.')
      } finally {
        setSubmitting(false)
      }
      return
    }
    if (step === 2) {
      if (!s2.exam || !s2.year_group) {
        setError('Pick an exam and year group to continue.')
        return
      }
      if (s2.subjects.length === 0) {
        setError('Choose at least one subject.')
        return
      }
      setSubmitting(true)
      try {
        await patch({
          exam: s2.exam,
          year_group: s2.year_group,
          subjects: s2.subjects,
        })
        setStep(3)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save step 2.')
      } finally {
        setSubmitting(false)
      }
      return
    }
  }, [patch, recordConsent, s1, s2, step])

  const finish = useCallback(async () => {
    setError(null)
    setSubmitting(true)
    try {
      if (s3.career_consent) {
        await recordConsent({
          kind: 'career',
          version: CURRENT_CONSENT_VERSION,
          granted: true,
        })
      }
      const finalPatch: LearnerProfilePatch = {
        interests: s3.interests,
      }
      if (s3.guardian_email.trim())
        finalPatch.guardian_email = s3.guardian_email.trim()
      if (s3.guardian_relationship.trim())
        finalPatch.guardian_relationship = s3.guardian_relationship.trim()
      await patch(finalPatch)
      if (onComplete) onComplete()
      else navigate('/home')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not finish onboarding.'
      )
    } finally {
      setSubmitting(false)
    }
  }, [navigate, onComplete, patch, recordConsent, s3])

  const goBack = useCallback(() => {
    setError(null)
    if (step > 1) setStep((step - 1) as Step)
  }, [step])

  const toggleSubject = (subject: string) => {
    setS2(prev => {
      const has = prev.subjects.includes(subject)
      if (has)
        return { ...prev, subjects: prev.subjects.filter(s => s !== subject) }
      if (prev.subjects.length >= MAX_SUBJECTS) return prev
      return { ...prev, subjects: [...prev.subjects, subject] }
    })
  }

  const toggleInterest = (interest: string) => {
    setS3(prev => {
      const has = prev.interests.includes(interest)
      if (has)
        return {
          ...prev,
          interests: prev.interests.filter(s => s !== interest),
        }
      if (prev.interests.length >= MAX_INTERESTS) return prev
      return { ...prev, interests: [...prev.interests, interest] }
    })
  }

  return (
    <div className={styles.root} data-testid="learner-onboarding-wizard">
      <div className={styles.progress} aria-label="Onboarding progress">
        <span>Step {step} of 3</span>
      </div>

      {step === 1 && (
        <div className={styles.card} data-testid="learner-onboarding-step-1">
          <Text weight="semibold" size={500}>
            Welcome to Wulo Academy
          </Text>
          <Text size={300}>
            Tell us who you are so we can set up your learning plan.
          </Text>

          <div className={styles.field}>
            <label htmlFor="onboarding-display-name">Your name</label>
            <Input
              id="onboarding-display-name"
              data-testid="onboarding-display-name"
              value={s1.display_name}
              onChange={(_e, data) =>
                setS1({ ...s1, display_name: data.value })
              }
              maxLength={80}
            />
          </div>

          <label className={styles.field}>
            <span>Age band</span>
            <select
              data-testid="onboarding-age-band"
              value={s1.age_band}
              onChange={e => setS1({ ...s1, age_band: e.currentTarget.value })}
            >
              <option value="">— pick one —</option>
              {AGE_BAND_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.field}>
            <label htmlFor="onboarding-locale">
              Locale (BCP-47, e.g. en-NG)
            </label>
            <Input
              id="onboarding-locale"
              data-testid="onboarding-locale"
              value={s1.locale}
              onChange={(_e, data) => setS1({ ...s1, locale: data.value })}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="onboarding-country">Country (ISO 2 letters)</label>
            <Input
              id="onboarding-country"
              data-testid="onboarding-country"
              value={s1.country}
              onChange={(_e, data) =>
                setS1({ ...s1, country: data.value.toUpperCase().slice(0, 2) })
              }
            />
          </div>

          <Checkbox
            data-testid="consent-checkbox-terms"
            label="I agree to the Wulo terms of service."
            checked={s1.terms}
            onChange={(_e, data) =>
              setS1({ ...s1, terms: Boolean(data.checked) })
            }
          />
          <Checkbox
            data-testid="consent-checkbox-privacy"
            label="I have read the privacy notice."
            checked={s1.privacy}
            onChange={(_e, data) =>
              setS1({ ...s1, privacy: Boolean(data.checked) })
            }
          />
          <Checkbox
            data-testid="consent-checkbox-ai_notice"
            label="I understand Wulo Academy uses AI to suggest activities and pathways."
            checked={s1.ai_notice}
            onChange={(_e, data) =>
              setS1({ ...s1, ai_notice: Boolean(data.checked) })
            }
          />
          <Checkbox
            data-testid="consent-checkbox-analytics"
            label="Optional: share anonymous usage analytics to help us improve."
            checked={s1.analytics_consent}
            onChange={(_e, data) =>
              setS1({ ...s1, analytics_consent: Boolean(data.checked) })
            }
          />

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
          <div className={styles.actions}>
            <span />
            <Button
              appearance="primary"
              onClick={goNext}
              disabled={submitting || isLoading}
              data-testid="learner-onboarding-next"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className={styles.card} data-testid="learner-onboarding-step-2">
          <Text weight="semibold" size={500}>
            Your exam path
          </Text>
          <Text size={300}>
            Pick the exam, year, and the subjects you’re working on.
          </Text>

          <label className={styles.field}>
            <span>Exam</span>
            <select
              data-testid="onboarding-exam"
              value={s2.exam}
              onChange={e =>
                setS2({ ...s2, exam: e.currentTarget.value, subjects: [] })
              }
            >
              {EXAM_OPTIONS.map(opt => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Year group</span>
            <select
              data-testid="onboarding-year-group"
              value={s2.year_group}
              onChange={e =>
                setS2({ ...s2, year_group: e.currentTarget.value })
              }
            >
              {YEAR_OPTIONS.map(opt => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.field}>
            <span>Subjects (up to {MAX_SUBJECTS})</span>
            <div className={styles.chipRow} data-testid="onboarding-subjects">
              {availableSubjects.map(subject => {
                const selected = s2.subjects.includes(subject)
                return (
                  <button
                    type="button"
                    key={subject}
                    className={`${styles.chip}${selected ? ` ${styles.chipActive}` : ''}`}
                    onClick={() => toggleSubject(subject)}
                    data-testid={`onboarding-subject-${subject}`}
                    aria-pressed={selected}
                  >
                    {subject}
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
          <div className={styles.actions}>
            <Button onClick={goBack} data-testid="learner-onboarding-back">
              Back
            </Button>
            <Button
              appearance="primary"
              onClick={goNext}
              disabled={submitting || isLoading}
              data-testid="learner-onboarding-next"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className={styles.card} data-testid="learner-onboarding-step-3">
          <Text weight="semibold" size={500}>
            Career interests
          </Text>
          <Text size={300}>
            These help Wulo Academy suggest careers and elective pathways.
          </Text>

          <div className={styles.field}>
            <span>Interests (up to {MAX_INTERESTS})</span>
            <div className={styles.chipRow} data-testid="onboarding-interests">
              {INTEREST_OPTIONS.map(interest => {
                const selected = s3.interests.includes(interest)
                return (
                  <button
                    type="button"
                    key={interest}
                    className={`${styles.chip}${selected ? ` ${styles.chipActive}` : ''}`}
                    onClick={() => toggleInterest(interest)}
                    data-testid={`onboarding-interest-${interest}`}
                    aria-pressed={selected}
                  >
                    {interest}
                  </button>
                )
              })}
            </div>
          </div>

          <Checkbox
            data-testid="consent-checkbox-career"
            label="Let the planner recommend full-strength pathway matches using my interests."
            checked={s3.career_consent}
            onChange={(_e, data) =>
              setS3({ ...s3, career_consent: Boolean(data.checked) })
            }
          />

          <div className={styles.field}>
            <label htmlFor="onboarding-guardian-email">
              Guardian email (optional)
            </label>
            <Input
              id="onboarding-guardian-email"
              data-testid="onboarding-guardian-email"
              value={s3.guardian_email}
              onChange={(_e, data) =>
                setS3({ ...s3, guardian_email: data.value })
              }
              type="email"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="onboarding-guardian-relationship">
              Guardian relationship (optional)
            </label>
            <Input
              id="onboarding-guardian-relationship"
              data-testid="onboarding-guardian-relationship"
              value={s3.guardian_relationship}
              onChange={(_e, data) =>
                setS3({ ...s3, guardian_relationship: data.value })
              }
              maxLength={40}
            />
          </div>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
          <div className={styles.actions}>
            <Button onClick={goBack} data-testid="learner-onboarding-back">
              Back
            </Button>
            <Button
              appearance="primary"
              onClick={finish}
              disabled={submitting || isLoading}
              data-testid="learner-onboarding-finish"
            >
              Finish
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default LearnerOnboardingWizard
