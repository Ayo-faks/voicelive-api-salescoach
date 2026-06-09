import { Link } from 'react-router-dom'
import { Text, makeStyles } from '@fluentui/react-components'
import {
  ArrowRightStartOnRectangleIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  InformationCircleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

const LAST_UPDATED = '5 June 2026'
const PRIVACY_CONTACT = 'privacy@wulo.ai'

const useStyles = makeStyles({
  shell: { display: 'grid', gap: 'var(--pf-space-xl)', maxWidth: '820px' },
  header: { display: 'grid', gap: 'var(--pf-space-sm)' },
  eyebrow: {
    fontFamily: t.font.display,
    fontSize: '0.78rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--pf-text-tertiary)',
  },
  title: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
    fontWeight: 700,
    letterSpacing: '-0.025em',
  },
  subtitle: { color: 'var(--pf-text-secondary)' },
  meta: { fontSize: '0.8rem', color: 'var(--pf-text-tertiary)' },
  card: {
    backgroundColor: 'var(--pf-surface)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    padding: 'var(--pf-space-xl)',
    display: 'grid',
    gap: 'var(--pf-space-md)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
  },
  list: { display: 'grid', gap: 'var(--pf-space-md)' },
  row: {
    display: 'grid',
    gridTemplateColumns: '32px 1fr auto',
    alignItems: 'center',
    gap: 'var(--pf-space-md)',
    padding: 'var(--pf-space-md) var(--pf-space-lg)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    textDecoration: 'none',
    color: 'var(--pf-text)',
    backgroundColor: 'var(--pf-surface)',
    transition:
      'background-color var(--pf-motion-fast), border-color var(--pf-motion-fast), box-shadow var(--pf-motion-fast), transform var(--pf-motion-fast)',
    ':hover': {
      backgroundColor: 'var(--pf-surface-muted)',
      borderTopColor: 'var(--pf-text-tertiary)',
      borderRightColor: 'var(--pf-text-tertiary)',
      borderBottomColor: 'var(--pf-text-tertiary)',
      borderLeftColor: 'var(--pf-text-tertiary)',
      boxShadow: 'var(--pf-shadow-card-hover)',
      transform: 'translateY(-1px)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  rowIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    display: 'grid',
    placeItems: 'center',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-ink)',
  },
  rowText: { display: 'grid', gap: '2px', minWidth: 0 },
  rowTitle: { fontWeight: 600, fontSize: '0.95rem' },
  rowHint: { fontSize: '0.8rem', color: 'var(--pf-text-tertiary)' },
  chevron: {
    width: '18px',
    height: '18px',
    color: 'var(--pf-text-tertiary)',
  },
  section: { display: 'grid', gap: '10px' },
  sectionTitle: { fontWeight: 700, fontSize: '1.05rem' },
  para: { color: 'var(--pf-text-secondary)', lineHeight: 1.55 },
  bullets: { display: 'grid', gap: '6px', paddingLeft: '18px', margin: 0 },
  back: {
    color: 'var(--pf-ink)',
    fontWeight: 600,
    textDecoration: 'none',
    fontSize: '0.85rem',
    width: 'fit-content',
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
      borderRadius: t.radius.sm,
    },
  },
})

type AccountLink = {
  href: string
  label: string
  hint: string
  icon: typeof Cog6ToothIcon
  testId: string
}

const ACCOUNT_LINKS: AccountLink[] = [
  {
    href: '/account/settings',
    label: 'Settings',
    hint: 'Voice, language, accessibility, and notification preferences',
    icon: Cog6ToothIcon,
    testId: 'account-action-settings',
  },
  {
    href: '/account/privacy',
    label: 'Privacy',
    hint: 'How Wulo Academy handles your data, consents, and parental controls',
    icon: ShieldCheckIcon,
    testId: 'account-action-privacy',
  },
  {
    href: '/account/terms',
    label: 'Terms',
    hint: 'The agreement that governs your use of Wulo Academy',
    icon: DocumentTextIcon,
    testId: 'account-action-terms',
  },
  {
    href: '/account/ai-notice',
    label: 'AI notice',
    hint: 'How the Wulo Academy tutor uses AI, limits, and the safety net',
    icon: InformationCircleIcon,
    testId: 'account-action-ai-notice',
  },
]

function BackLink() {
  const styles = useStyles()
  return (
    <Link to="/account" className={styles.back} data-testid="account-back">
      ← Back to Account & settings
    </Link>
  )
}

export function PathfinderAccountHub() {
  const styles = useStyles()
  return (
    <div className={styles.shell} data-testid="route-account-hub">
      <header className={styles.header}>
        <Text className={styles.eyebrow}>Wulo Academy · Account</Text>
        <Text as="h1" className={styles.title}>
          Account & settings
        </Text>
        <Text className={styles.subtitle}>
          Manage your Wulo Academy experience — voice, privacy, what your tutor
          may do, and the policies that govern your learning.
        </Text>
      </header>

      <nav className={styles.list} aria-label="Account sections">
        {ACCOUNT_LINKS.map(link => {
          const Icon = link.icon
          return (
            <Link
              key={link.href}
              to={link.href}
              className={styles.row}
              data-testid={link.testId}
            >
              <span className={styles.rowIcon} aria-hidden="true">
                <Icon style={{ width: 18, height: 18 }} />
              </span>
              <span className={styles.rowText}>
                <Text className={styles.rowTitle}>{link.label}</Text>
                <Text className={styles.rowHint}>{link.hint}</Text>
              </span>
              <ChevronRightIcon className={styles.chevron} aria-hidden="true" />
            </Link>
          )
        })}
        <a
          href="/logout"
          className={styles.row}
          data-testid="account-action-sign-out"
        >
          <span className={styles.rowIcon} aria-hidden="true">
            <ArrowRightStartOnRectangleIcon style={{ width: 18, height: 18 }} />
          </span>
          <span className={styles.rowText}>
            <Text className={styles.rowTitle}>Sign out</Text>
            <Text className={styles.rowHint}>
              End your Wulo Academy session on this device
            </Text>
          </span>
          <ChevronRightIcon className={styles.chevron} aria-hidden="true" />
        </a>
      </nav>
    </div>
  )
}

export function PathfinderSettings() {
  const styles = useStyles()
  return (
    <div className={styles.shell} data-testid="route-account-settings">
      <BackLink />
      <header className={styles.header}>
        <Text className={styles.eyebrow}>Wulo Academy · Settings</Text>
        <Text as="h1" className={styles.title}>
          Settings
        </Text>
        <Text className={styles.subtitle}>
          Tune how Wulo Academy looks, sounds, and reaches out to you.
        </Text>
      </header>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Voice & language</Text>
        <Text className={styles.para}>
          Wulo Academy tutors in English and is being trained to support Yoruba.
          You can switch between push-to-talk and continuous voice from the
          learner home.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Accessibility</Text>
        <Text className={styles.para}>
          Large-text mode, reduced motion, and high-contrast colours follow your
          system preferences. Captions are always on for tutor voice.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Notifications</Text>
        <Text className={styles.para}>
          Daily practice reminders and counsellor sign-off prompts can be
          enabled per device. Wulo Academy never sends marketing messages.
        </Text>
      </article>
    </div>
  )
}

export function PathfinderPrivacy() {
  const styles = useStyles()
  return (
    <div className={styles.shell} data-testid="route-account-privacy">
      <BackLink />
      <header className={styles.header}>
        <Text className={styles.eyebrow}>Wulo Academy · Privacy</Text>
        <Text as="h1" className={styles.title}>
          Privacy
        </Text>
        <Text className={styles.subtitle}>
          What Wulo Academy collects from your learning, and what stays with you.
        </Text>
        <Text className={styles.meta}>Last updated {LAST_UPDATED}</Text>
      </header>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>What we collect</Text>
        <ul className={styles.bullets}>
          <li>Your exam path, year group, and subject choices.</li>
          <li>
            Practice answers and progress signals used to plan the next topic.
          </li>
          <li>Optional guardian contact details, only if you provide them.</li>
        </ul>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>What we never sell or share</Text>
        <Text className={styles.para}>
          Your name, voice recordings, and answer text are never sold and are
          not shared with advertisers. Counsellors only see aggregated mastery,
          not raw audio.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Your controls</Text>
        <Text className={styles.para}>
          You can withdraw analytics consent any time from the onboarding
          wizard, and you can ask us to delete your learner profile.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Children and guardians</Text>
        <Text className={styles.para}>
          Wulo Academy is built for JSS1–SS3 learners, including children under
          13. For under-13 learners we require a guardian-acknowledged account,
          we collect only the minimum needed to run practice, and we never use a
          child's data for advertising or profiling. Guardians can review,
          export, or delete their child's learner profile by contacting us.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>How long we keep your data</Text>
        <Text className={styles.para}>
          We keep your learner profile and practice history while your account
          is active. If your account stays inactive for 24 months, or when you
          ask us to delete it, we remove your personal data within 30 days,
          except for limited records we must keep to meet legal obligations.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Where your data is processed</Text>
        <Text className={styles.para}>
          Wulo Academy runs on Microsoft Azure (Sweden Central). We use Microsoft
          Azure AI to power tutoring and speech, and Google or Microsoft only to
          verify your sign-in. We do not share your data with advertising
          networks.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Contact us</Text>
        <Text className={styles.para}>
          Questions about your data, or want to exercise your rights? Email{' '}
          <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>. Wulo
          Academy is operated by the Wulo team; contact us for the registered
          operating entity and postal address.
        </Text>
      </article>
    </div>
  )
}

export function PathfinderTerms() {
  const styles = useStyles()
  return (
    <div className={styles.shell} data-testid="route-account-terms">
      <BackLink />
      <header className={styles.header}>
        <Text className={styles.eyebrow}>Wulo Academy · Terms</Text>
        <Text as="h1" className={styles.title}>
          Terms of use
        </Text>
        <Text className={styles.subtitle}>
          The agreement between you and Wulo Academy for using Wulo Academy.
        </Text>
        <Text className={styles.meta}>Last updated {LAST_UPDATED}</Text>
      </header>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Who Wulo Academy is for</Text>
        <Text className={styles.para}>
          Wulo Academy is a study companion for JSS1–SS3 learners preparing for
          WAEC, NECO, JAMB, and equivalent exams. Learners under 13 use it with
          a guardian-acknowledged account.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Using the service fairly</Text>
        <ul className={styles.bullets}>
          <li>
            Use Wulo Academy for your own learning — don't share your login.
          </li>
          <li>Don't try to extract or copy the question bank.</li>
          <li>
            Be respectful when you talk to the tutor; abuse may pause access.
          </li>
        </ul>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>What we promise</Text>
        <Text className={styles.para}>
          We make a best effort to keep Wulo Academy available, accurate, and
          aligned to the syllabus. We are not a substitute for a qualified
          teacher or counsellor.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Contact and changes</Text>
        <Text className={styles.para}>
          Wulo Academy is operated by the Wulo team. Questions about these terms?
          Email <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>. We
          may update these terms; we will post the new effective date here and,
          for material changes, let you know in the app.
        </Text>
      </article>
    </div>
  )
}

export function PathfinderAiNotice() {
  const styles = useStyles()
  return (
    <div className={styles.shell} data-testid="route-account-ai-notice">
      <BackLink />
      <header className={styles.header}>
        <Text className={styles.eyebrow}>Wulo Academy · AI notice</Text>
        <Text as="h1" className={styles.title}>
          How Wulo Academy uses AI
        </Text>
        <Text className={styles.subtitle}>
          The tutor is an AI assistant — here is how it works, what it can do,
          and what it must not do.
        </Text>
        <Text className={styles.meta}>Last updated {LAST_UPDATED}</Text>
      </header>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>What the AI tutor does</Text>
        <Text className={styles.para}>
          The tutor explains concepts, generates short practice questions, and
          turns wrong answers into a step-by-step concept fix. It is grounded in
          the WAEC / NECO / JAMB syllabus and Wulo Academy's vetted skill library.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Limits to be aware of</Text>
        <ul className={styles.bullets}>
          <li>The tutor can be wrong. Always sanity-check critical answers.</li>
          <li>It does not give medical, legal, or career promises.</li>
          <li>It will refuse unsafe topics and route you to a counsellor.</li>
        </ul>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>The safety net</Text>
        <Text className={styles.para}>
          A counsellor signs off on the practice plans for sensitive topics and
          reviews flagged conversations. Pathways guidance stays exploratory and
          never makes promises about future earnings.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Your data and the AI</Text>
        <Text className={styles.para}>
          The tutor is powered by Microsoft Azure AI. Your practice answers help
          personalise your learning. We do not sell your data, and we never use a
          child's data to train advertising or third-party models.
        </Text>
      </article>
    </div>
  )
}
