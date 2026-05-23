import { Badge, Button, Text, makeStyles } from '@fluentui/react-components'
import {
  ArrowRightIcon,
  BoltIcon,
  CheckBadgeIcon,
  ChevronRightIcon,
  ClockIcon,
  PlayCircleIcon,
  SparklesIcon,
  WifiIcon,
} from '@heroicons/react/24/outline'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

type Activity = {
  id: string
  title: string
  meta: string
  minutes: number
  type: 'check-in' | 'practice' | 'exit-ticket'
}

const todaysPath: Activity[] = [
  {
    id: 'ratio-check',
    title: 'Ratio mini check-in',
    meta: 'Ratio & proportion · adaptive',
    minutes: 5,
    type: 'check-in',
  },
  {
    id: 'fraction-bar',
    title: 'Fraction bar practice',
    meta: 'Fraction operations · 6 items',
    minutes: 8,
    type: 'practice',
  },
  {
    id: 'exit-ticket',
    title: 'Exit ticket: scaling recipes',
    meta: 'Teacher reviewed',
    minutes: 3,
    type: 'exit-ticket',
  },
]

const weeklyTiles: Array<{ label: string; value: string; delta: string }> = [
  { label: 'Sessions', value: '4 / 5', delta: 'On pace' },
  { label: 'Streak', value: '7 days', delta: 'Personal best' },
  { label: 'Mastery', value: '+12%', delta: 'Ratio focus' },
]

const useStyles = makeStyles({
  root: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 320px',
    gap: '24px',
    '@media (max-width: 1100px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  main: { display: 'grid', gap: '20px', minWidth: 0 },
  side: {
    display: 'grid',
    gap: '16px',
    alignContent: 'start',
    '@media (max-width: 1100px)': { gridTemplateColumns: '1fr' },
  },
  hero: {
    position: 'relative',
    padding: '32px',
    borderRadius: t.radius.xxl,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    boxShadow: t.surface.raisedShadow,
    overflow: 'hidden',
    '@media (max-width: 720px)': { padding: '24px' },
  },
  heroEyebrow: {
    fontSize: '0.72rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    opacity: 0.65,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  heroTitle: {
    fontFamily: t.font.display,
    fontSize: '2.4rem',
    lineHeight: 1.05,
    fontWeight: 600,
    letterSpacing: '-0.025em',
    margin: '10px 0 8px',
    color: t.brand.onInk,
    '@media (max-width: 720px)': { fontSize: '1.9rem' },
  },
  heroSub: {
    fontSize: '1rem',
    opacity: 0.82,
    maxWidth: '46ch',
    lineHeight: 1.5,
  },
  heroPills: {
    marginTop: '22px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  heroPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: t.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.16)',
    fontSize: '0.78rem',
    fontWeight: 500,
    letterSpacing: '-0.01em',
  },
  heroCta: {
    marginTop: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 18px',
    borderRadius: t.radius.pill,
    backgroundColor: t.brand.onInk,
    color: t.brand.ink,
    fontWeight: 600,
    fontSize: '0.92rem',
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    transition: 'transform .15s ease, box-shadow .15s ease',
    ':hover': {
      transform: 'translateY(-1px)',
      boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
    },
  },
  card: {
    backgroundColor: t.surface.card,
    border: t.surface.hairline,
    borderRadius: t.radius.xl,
    padding: '20px 22px',
    boxShadow: t.surface.raisedShadow,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '14px',
  },
  cardTitle: {
    fontFamily: t.font.display,
    fontSize: '1.05rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: t.brand.text,
  },
  cardCaption: {
    fontSize: '0.78rem',
    color: t.brand.textTertiary,
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderRadius: t.radius.md,
    backgroundColor: t.brand.surfaceMuted,
    border: t.surface.hairline,
    color: t.brand.textSecondary,
    fontSize: '0.85rem',
  },
  pathList: {
    display: 'grid',
    gap: '10px',
  },
  pathRow: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr auto auto',
    alignItems: 'center',
    gap: '14px',
    padding: '14px 16px',
    borderRadius: t.radius.md,
    backgroundColor: t.brand.surfaceMuted,
    boxShadow: `inset 0 0 0 1px ${t.brand.line}`,
    cursor: 'pointer',
    ':hover': {
      backgroundColor: t.brand.lineSoft,
    },
  },
  pathIcon: {
    width: '40px',
    height: '40px',
    borderRadius: t.radius.md,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
  },
  pathTitle: {
    display: 'grid',
    gap: '2px',
  },
  pathTitleText: {
    fontWeight: 600,
    color: t.brand.text,
    fontSize: '0.94rem',
  },
  pathMeta: {
    fontSize: '0.78rem',
    color: t.brand.textTertiary,
  },
  minutes: {
    fontSize: '0.78rem',
    color: t.brand.textSecondary,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
  },
  weekGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px',
    '@media (max-width: 520px)': { gridTemplateColumns: '1fr' },
  },
  weekTile: {
    padding: '16px',
    borderRadius: t.radius.lg,
    backgroundColor: t.brand.surfaceMuted,
    border: t.surface.hairline,
    display: 'grid',
    gap: '4px',
  },
  weekLabel: {
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: t.brand.textTertiary,
    fontWeight: 600,
  },
  weekValue: {
    fontFamily: t.font.display,
    fontSize: '1.5rem',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: t.brand.text,
  },
  weekDelta: { fontSize: '0.78rem', color: t.brand.textSecondary },
  sideHeading: {
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: t.brand.textTertiary,
    fontWeight: 600,
    margin: '4px 0',
  },
  sideRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px 0',
    borderBottom: t.surface.hairline,
    ':last-child': { borderBottom: 'none' },
  },
  sideRowIcon: {
    width: '18px',
    height: '18px',
    color: t.brand.text,
    flexShrink: 0,
    marginTop: '2px',
  },
  sideRowText: {
    fontSize: '0.85rem',
    color: t.brand.text,
    fontWeight: 500,
    lineHeight: 1.35,
  },
  sideRowMeta: {
    fontSize: '0.74rem',
    color: t.brand.textTertiary,
    marginTop: '2px',
  },
})

export default function StudentLearningHome() {
  const styles = useStyles()
  const today = new Date('2026-05-21')
  const formatted = today.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <section className={styles.root} data-testid="route-student-home">
      <div className={styles.main}>
        <article className={styles.hero}>
          <span className={styles.heroEyebrow}>
            <SparklesIcon style={{ width: 14, height: 14 }} aria-hidden="true" />
            {formatted}
          </span>
          <h1 className={styles.heroTitle}>Hi Tobi — let's keep the streak.</h1>
          <p className={styles.heroSub}>
            Your ratio path is 42% mastered. One short check-in today closes the
            gap with your class average.
          </p>
          <div className={styles.heroPills}>
            <span className={styles.heroPill}>
              <BoltIcon style={{ width: 14, height: 14 }} aria-hidden="true" />
              7-day streak
            </span>
            <span className={styles.heroPill}>en-NG · Yoruba voice</span>
            <span className={styles.heroPill}>JSS2 · Maths</span>
          </div>
          <button type="button" className={styles.heroCta}>
            <PlayCircleIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
            Start today's check-in
            <ArrowRightIcon style={{ width: 16, height: 16 }} aria-hidden="true" />
          </button>
        </article>

        <div className={styles.banner}>
          <WifiIcon style={{ width: 18, height: 18 }} aria-hidden="true" />
          Offline-ready. Yoruba voice frame queued — will sync when connection
          returns.
        </div>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>Today's path</Text>
            <Text className={styles.cardCaption}>~16 min total · 3 steps</Text>
          </div>
          <div className={styles.pathList}>
            {todaysPath.map(item => (
              <button
                key={item.id}
                type="button"
                className={styles.pathRow}
                style={{ textAlign: 'left', font: 'inherit' }}
              >
                <div className={styles.pathIcon} aria-hidden="true">
                  <PlayCircleIcon style={{ width: 20, height: 20 }} />
                </div>
                <div className={styles.pathTitle}>
                  <span className={styles.pathTitleText}>{item.title}</span>
                  <span className={styles.pathMeta}>{item.meta}</span>
                </div>
                <span className={styles.minutes}>
                  <ClockIcon style={{ width: 14, height: 14 }} aria-hidden="true" />
                  {item.minutes} min
                </span>
                <ChevronRightIcon
                  style={{ width: 18, height: 18, color: t.brand.textTertiary }}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>This week</Text>
            <Text className={styles.cardCaption}>Mon — Sun · auto-tracked</Text>
          </div>
          <div className={styles.weekGrid}>
            {weeklyTiles.map(tile => (
              <div key={tile.label} className={styles.weekTile}>
                <span className={styles.weekLabel}>{tile.label}</span>
                <span className={styles.weekValue}>{tile.value}</span>
                <span className={styles.weekDelta}>{tile.delta}</span>
              </div>
            ))}
          </div>
        </article>
      </div>

      <aside className={styles.side} aria-label="Learner side panel">
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>Up next</Text>
            <Badge appearance="outline">Adaptive</Badge>
          </div>
          <p style={{ fontSize: '0.88rem', color: t.brand.textSecondary, lineHeight: 1.5, margin: 0 }}>
            Linear equations · introduce slope using ratios you've practiced.
          </p>
          <Button appearance="subtle" style={{ marginTop: 12, paddingLeft: 0 }}>
            Preview path
          </Button>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>Recent feedback</Text>
            <Text className={styles.cardCaption}>From your teacher</Text>
          </div>
          <div className={styles.sideRow}>
            <CheckBadgeIcon className={styles.sideRowIcon} aria-hidden="true" />
            <div>
              <div className={styles.sideRowText}>"Strong work on fraction bars."</div>
              <div className={styles.sideRowMeta}>Mrs. Adebayo · 2 days ago</div>
            </div>
          </div>
          <div className={styles.sideRow}>
            <SparklesIcon className={styles.sideRowIcon} aria-hidden="true" />
            <div>
              <div className={styles.sideRowText}>Approved for ratio recovery group</div>
              <div className={styles.sideRowMeta}>Counsellor sign-off · last week</div>
            </div>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <Text className={styles.cardTitle}>Trust</Text>
            <Badge appearance="outline" color="success">All gates green</Badge>
          </div>
          <p style={{ fontSize: '0.82rem', color: t.brand.textSecondary, lineHeight: 1.5, margin: 0 }}>
            Every recommendation is teacher-reviewed. Provenance and audit log
            available in Trust & Safety.
          </p>
        </article>
      </aside>
    </section>
  )
}
