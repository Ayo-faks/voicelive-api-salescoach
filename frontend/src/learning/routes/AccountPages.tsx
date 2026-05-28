import { Link } from 'react-router-dom'
import { Text, makeStyles, tokens } from '@fluentui/react-components'
import {
  ArrowRightStartOnRectangleIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  InformationCircleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

const useStyles = makeStyles({
  shell: { display: 'grid', gap: '18px', maxWidth: '760px' },
  header: { display: 'grid', gap: '8px' },
  eyebrow: {
    fontFamily: t.font.display,
    fontSize: '0.78rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: tokens.colorNeutralForeground3,
  },
  title: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
    fontWeight: 700,
    letterSpacing: '-0.025em',
  },
  subtitle: { color: tokens.colorNeutralForeground2 },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: '12px',
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorNeutralStroke2,
    padding: '20px',
    display: 'grid',
    gap: '12px',
  },
  list: { display: 'grid', gap: '8px' },
  row: {
    display: 'grid',
    gridTemplateColumns: '32px 1fr auto',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 14px',
    borderRadius: '10px',
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorNeutralStroke2,
    textDecoration: 'none',
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    ':hover': { backgroundColor: tokens.colorNeutralBackground2 },
  },
  rowIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    display: 'grid',
    placeItems: 'center',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorBrandForeground1,
  },
  rowText: { display: 'grid', gap: '2px', minWidth: 0 },
  rowTitle: { fontWeight: 600, fontSize: '0.95rem' },
  rowHint: { fontSize: '0.8rem', color: tokens.colorNeutralForeground3 },
  chevron: { width: '18px', height: '18px', color: tokens.colorNeutralForeground3 },
  section: { display: 'grid', gap: '10px' },
  sectionTitle: { fontWeight: 700, fontSize: '1.05rem' },
  para: { color: tokens.colorNeutralForeground2, lineHeight: 1.55 },
  bullets: { display: 'grid', gap: '6px', paddingLeft: '18px', margin: 0 },
  back: {
    color: tokens.colorBrandForeground1,
    fontWeight: 600,
    textDecoration: 'none',
    fontSize: '0.85rem',
    width: 'fit-content',
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
    hint: 'How Pathfinder handles your data, consents, and parental controls',
    icon: ShieldCheckIcon,
    testId: 'account-action-privacy',
  },
  {
    href: '/account/terms',
    label: 'Terms',
    hint: 'The agreement that governs your use of Pathfinder',
    icon: DocumentTextIcon,
    testId: 'account-action-terms',
  },
  {
    href: '/account/ai-notice',
    label: 'AI notice',
    hint: 'How the Pathfinder tutor uses AI, limits, and the safety net',
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
        <Text className={styles.eyebrow}>Pathfinder · Account</Text>
        <Text as="h1" className={styles.title}>
          Account & settings
        </Text>
        <Text className={styles.subtitle}>
          Manage your Pathfinder experience — voice, privacy, what your tutor
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
              End your Pathfinder session on this device
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
        <Text className={styles.eyebrow}>Pathfinder · Settings</Text>
        <Text as="h1" className={styles.title}>
          Settings
        </Text>
        <Text className={styles.subtitle}>
          Tune how Pathfinder looks, sounds, and reaches out to you.
        </Text>
      </header>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Voice & language</Text>
        <Text className={styles.para}>
          Pathfinder tutors in English and is being trained to support Yoruba.
          You can switch between push-to-talk and continuous voice from the
          learner home.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Accessibility</Text>
        <Text className={styles.para}>
          Large-text mode, reduced motion, and high-contrast colours follow
          your system preferences. Captions are always on for tutor voice.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Notifications</Text>
        <Text className={styles.para}>
          Daily practice reminders and counsellor sign-off prompts can be
          enabled per device. Pathfinder never sends marketing messages.
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
        <Text className={styles.eyebrow}>Pathfinder · Privacy</Text>
        <Text as="h1" className={styles.title}>
          Privacy
        </Text>
        <Text className={styles.subtitle}>
          What Pathfinder collects from your learning, and what stays with you.
        </Text>
      </header>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>What we collect</Text>
        <ul className={styles.bullets}>
          <li>Your exam path, year group, and subject choices.</li>
          <li>Practice answers and progress signals used to plan the next topic.</li>
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
    </div>
  )
}

export function PathfinderTerms() {
  const styles = useStyles()
  return (
    <div className={styles.shell} data-testid="route-account-terms">
      <BackLink />
      <header className={styles.header}>
        <Text className={styles.eyebrow}>Pathfinder · Terms</Text>
        <Text as="h1" className={styles.title}>
          Terms of use
        </Text>
        <Text className={styles.subtitle}>
          The agreement between you and Wulo Academy for using Pathfinder.
        </Text>
      </header>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Who Pathfinder is for</Text>
        <Text className={styles.para}>
          Pathfinder is a study companion for JSS1–SS3 learners preparing for
          WAEC, NECO, JAMB, and equivalent exams. Learners under 13 use it
          with a guardian-acknowledged account.
        </Text>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>Using the service fairly</Text>
        <ul className={styles.bullets}>
          <li>Use Pathfinder for your own learning — don't share your login.</li>
          <li>Don't try to extract or copy the question bank.</li>
          <li>Be respectful when you talk to the tutor; abuse may pause access.</li>
        </ul>
      </article>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>What we promise</Text>
        <Text className={styles.para}>
          We make a best effort to keep Pathfinder available, accurate, and
          aligned to the syllabus. We are not a substitute for a qualified
          teacher or counsellor.
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
        <Text className={styles.eyebrow}>Pathfinder · AI notice</Text>
        <Text as="h1" className={styles.title}>
          How Pathfinder uses AI
        </Text>
        <Text className={styles.subtitle}>
          The tutor is an AI assistant — here is how it works, what it can do,
          and what it must not do.
        </Text>
      </header>
      <article className={styles.card}>
        <Text className={styles.sectionTitle}>What the AI tutor does</Text>
        <Text className={styles.para}>
          The tutor explains concepts, generates short practice questions, and
          turns wrong answers into a step-by-step concept fix. It is grounded
          in the WAEC / NECO / JAMB syllabus and Pathfinder's vetted skill
          library.
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
          A counsellor signs off on the practice plans for sensitive topics
          and reviews flagged conversations. Pathways guidance stays
          exploratory and never makes promises about future earnings.
        </Text>
      </article>
    </div>
  )
}
