import { Card, Input, Text, makeStyles } from '@fluentui/react-components'
import {
  ArrowTrendingUpIcon,
  BriefcaseIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline'
import { useEffect, useMemo, useState } from 'react'
import { fetchLearnerCareers } from '../api'
import { featureFlags } from '../../utils/featureFlags'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

type PathwaySkill = {
  skillId: string
  label: string
  weight: number
  mastery: number
  isGap: boolean
}

type Pathway = {
  id: string
  title: string
  category?: 'Data' | 'Energy' | 'Health' | 'Creative' | 'Trades' | 'Education'
  fit: number
  wageBand: string
  demand: string
  region?: string
  duration?: string
  rationale: string
  gaps: string[]
  skills?: PathwaySkill[]
  source: string
}

const staticPathways: Pathway[] = [
  {
    id: 'data-analyst',
    title: 'Data analyst apprenticeship',
    category: 'Data',
    fit: 82,
    wageBand: 'Entry to mid · NGN',
    demand: 'growing',
    region: 'Lagos · Abuja',
    duration: '18 months',
    rationale: 'Strong fit with algebra progress and spreadsheet practice.',
    gaps: ['ratio-proportion', 'fraction-operations'],
    source: 'Labour market outlook · 2026 Q2',
  },
  {
    id: 'solar-tech',
    title: 'Solar installation technician',
    category: 'Energy',
    fit: 74,
    wageBand: 'Entry · NGN',
    demand: 'growing',
    region: 'Kano · Lagos',
    duration: '12 months',
    rationale: 'Links geometry and measurement to a practical pathway.',
    gaps: ['plane-geometry'],
    source: 'Labour market outlook · 2026 Q2',
  },
  {
    id: 'community-health',
    title: 'Community health extension worker',
    category: 'Health',
    fit: 69,
    wageBand: 'Entry · NGN',
    demand: 'stable',
    region: 'Nationwide',
    duration: '24 months',
    rationale: 'Bias toward biology and statistics; complements maths base.',
    gaps: ['statistics'],
    source: 'Labour market outlook · 2026 Q2',
  },
  {
    id: 'creative-designer',
    title: 'Digital content designer',
    category: 'Creative',
    fit: 64,
    wageBand: 'Entry · NGN',
    demand: 'growing',
    region: 'Lagos',
    duration: '9 months',
    rationale: 'Visual reasoning + geometry transfer well.',
    gaps: ['plane-geometry'],
    source: 'Labour market outlook · 2026 Q2',
  },
  {
    id: 'plumbing-craft',
    title: 'Plumbing & water systems craft',
    category: 'Trades',
    fit: 58,
    wageBand: 'Entry · NGN',
    demand: 'stable',
    region: 'Lagos · Port Harcourt',
    duration: '14 months',
    rationale: 'Measurement-heavy; pairs with geometry strength.',
    gaps: ['ratio-proportion'],
    source: 'Labour market outlook · 2026 Q2',
  },
  {
    id: 'teaching-assistant',
    title: 'Primary teaching assistant',
    category: 'Education',
    fit: 71,
    wageBand: 'Entry · NGN',
    demand: 'stable',
    region: 'Nationwide',
    duration: '12 months',
    rationale: 'Communication strength + JSS2 maths fluency carry across.',
    gaps: ['fraction-operations'],
    source: 'Labour market outlook · 2026 Q2',
  },
]

const categories: Array<Pathway['category'] | 'All'> = [
  'All',
  'Data',
  'Energy',
  'Health',
  'Creative',
  'Trades',
  'Education',
]

function displayCode(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function formatWage(wage: Record<string, unknown>): string {
  const currency = typeof wage.currency === 'string' ? wage.currency : ''
  const min = typeof wage.min_monthly === 'number' ? wage.min_monthly : undefined
  const max = typeof wage.max_monthly === 'number' ? wage.max_monthly : undefined
  if (currency && min && max) {
    return `${currency} ${Math.round(min / 1000)}k–${Math.round(max / 1000)}k/mo`
  }
  return 'Wage data sourced'
}

const useStyles = makeStyles({
  shell: { display: 'grid', gap: 'var(--pf-space-xl)' },
  header: { display: 'grid', gap: 'var(--pf-space-md)' },
  title: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
    fontWeight: 700,
    letterSpacing: '-0.025em',
  },
  subtitle: { color: 'var(--pf-text-secondary)', maxWidth: '640px' },
  headerMeta: {
    display: 'flex',
    gap: 'var(--pf-space-sm)',
    flexWrap: 'wrap',
  },
  filterRow: {
    display: 'flex',
    gap: 'var(--pf-space-md)',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  filters: {
    display: 'flex',
    gap: 'var(--pf-space-xs)',
    flexWrap: 'wrap',
    flex: 1,
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    minHeight: '24px',
    paddingRight: '10px',
    paddingLeft: '10px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface-muted)',
    color: 'var(--pf-text-secondary)',
    boxSizing: 'border-box',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
    overflowWrap: 'normal',
  },
  pillButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '26px',
    paddingRight: '11px',
    paddingLeft: '11px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    boxSizing: 'border-box',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
  },
  pillButtonActive: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '26px',
    paddingRight: '11px',
    paddingLeft: '11px',
    borderRadius: t.radius.pill,
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    boxSizing: 'border-box',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
  },
  searchBox: { maxWidth: '320px', flex: 1, minWidth: '180px' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 'var(--pf-space-lg)',
  },
  card: {
    padding: 'var(--pf-space-lg)',
    borderRadius: t.radius.sm,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
    display: 'grid',
    gap: 'var(--pf-space-md)',
    transition:
      'box-shadow var(--pf-motion-normal) var(--pf-motion-ease), border-color var(--pf-motion-normal), transform var(--pf-motion-normal) var(--pf-motion-ease)',
    ':hover': {
      boxShadow: 'var(--pf-shadow-card-hover)',
      transform: 'translateY(-1px)',
    },
  },
  cardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 'var(--pf-space-md)',
    flexWrap: 'wrap',
  },
  cardTitle: {
    fontWeight: 800,
    fontSize: '1rem',
    lineHeight: 1.2,
  },
  fitBar: {
    height: '8px',
    borderRadius: '999px',
    backgroundColor: 'var(--pf-line-soft)',
    overflow: 'hidden',
  },
  fitFill: {
    height: '100%',
    borderRadius: '999px',
    background: 'linear-gradient(90deg, var(--pf-ink), var(--pf-ink-muted))',
  },
  metaRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    fontSize: '0.78rem',
    color: 'var(--pf-text-secondary)',
  },
  metaItem: { display: 'inline-flex', alignItems: 'center', gap: '4px' },
  iconSm: { width: '14px', height: '14px' },
  gapPills: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  cardActions: {
    display: 'flex',
    gap: '8px',
    marginTop: '4px',
  },
  cardButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '32px',
    paddingRight: '13px',
    paddingLeft: '13px',
    borderRadius: t.radius.pill,
    border: 'var(--pf-hairline)',
    backgroundColor: 'var(--pf-surface)',
    color: 'var(--pf-text)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.76rem',
    fontWeight: 800,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    transition:
      'background-color var(--pf-motion-fast), border-color var(--pf-motion-fast), color var(--pf-motion-fast), box-shadow var(--pf-motion-fast)',
    ':hover': {
      backgroundColor: 'var(--pf-surface-muted)',
      borderTopColor: 'var(--pf-text-tertiary)',
      borderRightColor: 'var(--pf-text-tertiary)',
      borderBottomColor: 'var(--pf-text-tertiary)',
      borderLeftColor: 'var(--pf-text-tertiary)',
    },
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  cardButtonActive: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '32px',
    paddingRight: '13px',
    paddingLeft: '13px',
    borderRadius: t.radius.pill,
    border: '1px solid var(--pf-ink)',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.76rem',
    fontWeight: 800,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-focus-ring)',
      outlineOffset: '3px',
      boxShadow: 'var(--pf-focus-outline)',
    },
  },
  source: {
    fontSize: '0.72rem',
    color: 'var(--pf-text-tertiary)',
  },
  compareBar: {
    position: 'sticky',
    bottom: '70px',
    backgroundColor: 'var(--pf-ink)',
    color: 'var(--pf-on-ink)',
    padding: '10px 14px',
    borderRadius: t.radius.sm,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    boxShadow: 'var(--pf-shadow-card-elevated)',
  },
  compareBarButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '32px',
    paddingRight: '14px',
    paddingLeft: '14px',
    borderRadius: t.radius.pill,
    border: '1px solid rgba(255,255,255,0.22)',
    backgroundColor: 'var(--pf-on-ink)',
    color: 'var(--pf-ink)',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.78rem',
    fontWeight: 800,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    ':focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'var(--pf-on-ink)',
      outlineOffset: '3px',
    },
  },
  empty: {
    padding: '40px',
    textAlign: 'center',
    border: '1px dashed var(--pf-line)',
    borderRadius: t.radius.sm,
    color: 'var(--pf-text-tertiary)',
  },
})

export default function PathwaysExplorer({
  studentId,
}: {
  studentId?: string
}) {
  const styles = useStyles()
  const [category, setCategory] = useState<(typeof categories)[number]>('All')
  const [query, setQuery] = useState('')
  const [compare, setCompare] = useState<string[]>([])
  // Cards start from the deterministic local list and are replaced by the
  // per-learner mastery-ranked plan from `GET /api/learning/learner/careers`
  // when the onboarding flag is on. Flag-off / cold-start / error keeps the
  // static example array so the page never renders empty.
  const [pathwaysData, setPathwaysData] = useState<Pathway[]>(staticPathways)
  const [planSource, setPlanSource] = useState<'mastery' | 'demand' | null>(
    null
  )

  useEffect(() => {
    if (!featureFlags.pathfinder_learner_onboarding_enabled) return
    let cancelled = false
    fetchLearnerCareers(studentId ? { student_id: studentId } : {})
      .then(plan => {
        if (cancelled || plan.pathways.length === 0) return
        setPathwaysData(
          plan.pathways.map(p => {
            const skills = (p.skills ?? []).map(s => ({
              skillId: s.skill_id,
              label: s.label,
              weight: s.weight,
              mastery: s.mastery,
              isGap: s.is_gap,
            }))
            return {
              id: p.id,
              title: p.title,
              fit: p.fit,
              wageBand: formatWage(p.wage_band),
              demand: p.demand_trend ?? 'tracked',
              rationale: p.rationale,
              gaps: skills.filter(s => s.isGap).map(s => s.label),
              skills,
              source: `Wage & demand sourced · ${p.demand_source}`,
            }
          })
        )
        setPlanSource(plan.source)
        setCategory('All')
      })
      .catch(err => {
        console.warn('learner careers fetch failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [studentId])

  const isLive = planSource !== null
  const subtitle = !isLive
    ? 'Example career routes with fit scores and demand signals — personalised ranking appears once practice data is available.'
    : planSource === 'mastery'
      ? 'Career routes ranked by current mastery — each with a fit score, demand signal, and the skills to close next.'
      : 'Career routes ranked by labour-market demand for now — mastery sharpens the ranking as practice builds.'

  const filtered = useMemo(() => {
    return pathwaysData.filter(p => {
      const matchCat =
        isLive || category === 'All' || p.category === category
      const matchQuery =
        query.trim() === '' ||
        p.title.toLowerCase().includes(query.toLowerCase()) ||
        p.rationale.toLowerCase().includes(query.toLowerCase())
      return matchCat && matchQuery
    })
  }, [pathwaysData, isLive, category, query])

  function toggleCompare(id: string) {
    setCompare(cur =>
      cur.includes(id)
        ? cur.filter(x => x !== id)
        : cur.length < 3
          ? [...cur, id]
          : cur
    )
  }

  return (
    <div className={styles.shell} data-testid="route-pathways-explorer">
      <div className={styles.header}>
        <Text as="h1" className={styles.title}>
          Pathways Explorer
        </Text>
        <Text className={styles.subtitle}>{subtitle}</Text>
        <div className={styles.headerMeta} aria-label="Pathway context">
          <span className={styles.pill}>{pathwaysData.length} routes</span>
        </div>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.searchBox}>
          <Input
            placeholder="Search pathways"
            value={query}
            onChange={(_, d) => setQuery(d.value)}
            contentBefore={
              <MagnifyingGlassIcon
                style={{ width: 16, height: 16 }}
                aria-hidden="true"
              />
            }
          />
        </div>
        {!isLive && (
          <div className={styles.filters}>
            {categories.map(c => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                className={
                  category === c ? styles.pillButtonActive : styles.pillButton
                }
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          No pathways match. Clear filters or try a different term.
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map(p => (
            <Card key={p.id} className={styles.card}>
              <div className={styles.cardHead}>
                <Text className={styles.cardTitle}>{p.title}</Text>
                {p.category && (
                  <span className={styles.pill}>{p.category}</span>
                )}
              </div>

              <div>
                <div className={styles.metaRow} style={{ marginBottom: 6 }}>
                  <span>
                    <strong style={{ color: 'var(--pf-ink)', fontSize: '0.95rem' }}>
                      {p.fit}%
                    </strong>{' '}
                    fit
                  </span>
                </div>
                <div className={styles.fitBar}>
                  <div
                    className={styles.fitFill}
                    style={{ width: `${p.fit}%` }}
                  />
                </div>
              </div>

              <Text size={200}>{p.rationale}</Text>

              <div className={styles.metaRow}>
                <span className={styles.metaItem}>
                  <BriefcaseIcon className={styles.iconSm} aria-hidden="true" />
                  {p.wageBand}
                </span>
                <span className={styles.metaItem}>
                  <ArrowTrendingUpIcon
                    className={styles.iconSm}
                    aria-hidden="true"
                  />
                  {p.demand}
                </span>
                {p.region && (
                  <span className={styles.metaItem}>
                    <MapPinIcon className={styles.iconSm} aria-hidden="true" />
                    {p.region}
                  </span>
                )}
                {p.duration && <span>· {p.duration}</span>}
              </div>

              <div>
                <Text size={200} weight="semibold">
                  {p.gaps.length > 0 ? 'Skills to close' : 'Linked skills'}
                </Text>
                <div className={styles.gapPills} style={{ marginTop: 6 }}>
                  {p.gaps.length > 0 ? (
                    p.gaps.map(g => (
                      <span key={g} className={styles.pill}>
                        {displayCode(g)}
                      </span>
                    ))
                  ) : p.skills && p.skills.length > 0 ? (
                    p.skills.slice(0, 3).map(s => (
                      <span key={s.skillId} className={styles.pill}>
                        {s.label}
                      </span>
                    ))
                  ) : (
                    <span className={styles.pill}>On track</span>
                  )}
                </div>
              </div>

              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={
                    compare.includes(p.id)
                      ? styles.cardButtonActive
                      : styles.cardButton
                  }
                  onClick={() => toggleCompare(p.id)}
                >
                  {compare.includes(p.id) ? 'Comparing' : 'Compare'}
                </button>
                <button type="button" className={styles.cardButton}>
                  View details
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <div className={styles.source}>
          {isLive
            ? planSource === 'mastery'
              ? 'Ranked from this learner’s mastery · wage & demand signals sourced'
              : 'Ranked from labour-market demand · wage & demand signals sourced'
            : 'Example routes · fit and demand signals · Labour market outlook · 2026 Q2'}
        </div>
      )}

      {compare.length > 0 && (
        <div className={styles.compareBar}>
          <span>
            {compare.length} pathway{compare.length > 1 ? 's' : ''} ready to
            compare
          </span>
          <button type="button" className={styles.compareBarButton}>
            Compare side-by-side
          </button>
        </div>
      )}
    </div>
  )
}
