import {
  Card,
  Input,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  ArrowTrendingUpIcon,
  BriefcaseIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline'
import { useMemo, useState } from 'react'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

type Pathway = {
  id: string
  title: string
  category: 'Data' | 'Energy' | 'Health' | 'Creative' | 'Trades' | 'Education'
  fit: number
  wageBand: string
  demand: 'growing' | 'stable' | 'declining'
  region: string
  duration: string
  rationale: string
  gaps: string[]
  source: string
}

const pathways: Pathway[] = [
  {
    id: 'data-analyst',
    title: 'Data analyst apprenticeship',
    category: 'Data',
    fit: 82,
    wageBand: 'Entry to mid · NGN',
    demand: 'growing',
    region: 'Lagos · Abuja',
    duration: '18 months',
    rationale:
      'Strong fit with algebra progress and spreadsheet practice.',
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

const useStyles = makeStyles({
  shell: { display: 'grid', gap: '18px' },
  header: { display: 'grid', gap: '10px' },
  title: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
    fontWeight: 700,
    letterSpacing: '-0.025em',
  },
  subtitle: { color: tokens.colorNeutralForeground2, maxWidth: '640px' },
  headerMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  filterRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  filters: { display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1 },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    minHeight: '24px',
    paddingRight: '10px',
    paddingLeft: '10px',
    borderRadius: t.radius.pill,
    border: t.surface.hairline,
    backgroundColor: t.surface.cardMuted,
    color: t.brand.textSecondary,
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
    border: t.surface.hairline,
    backgroundColor: t.surface.card,
    color: t.brand.text,
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
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
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
    gap: '14px',
  },
  card: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: t.surface.hairline,
    boxShadow: t.surface.cardElevatedShadow,
    display: 'grid',
    gap: '10px',
    transition: 'box-shadow 0.15s, border-color 0.15s',
    ':hover': {
      boxShadow: t.surface.cardHoverShadow,
    },
  },
  cardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
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
    backgroundColor: tokens.colorNeutralBackground3,
    overflow: 'hidden',
  },
  fitFill: {
    height: '100%',
    borderRadius: '999px',
    background: `linear-gradient(90deg, ${t.brand.ink}, ${t.brand.inkMuted})`,
  },
  metaRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    fontSize: '0.78rem',
    color: tokens.colorNeutralForeground2,
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
    border: t.surface.hairline,
    backgroundColor: t.brand.surface,
    color: t.brand.text,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.76rem',
    fontWeight: 800,
    lineHeight: 1,
    whiteSpace: 'nowrap',
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
    border: `1px solid ${t.brand.ink}`,
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.76rem',
    fontWeight: 800,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },
  source: {
    fontSize: '0.7rem',
    color: tokens.colorNeutralForeground3,
    borderTop: `1px dashed ${tokens.colorNeutralStroke2}`,
    paddingTop: '8px',
  },
  compareBar: {
    position: 'sticky',
    bottom: '70px',
    backgroundColor: t.brand.ink,
    color: t.brand.onInk,
    padding: '10px 14px',
    borderRadius: t.radius.md,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
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
    backgroundColor: t.brand.onInk,
    color: t.brand.ink,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.78rem',
    fontWeight: 800,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },
  empty: {
    padding: '40px',
    textAlign: 'center',
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: '14px',
    color: tokens.colorNeutralForeground3,
  },
})

export default function PathwaysExplorer() {
  const styles = useStyles()
  const [category, setCategory] = useState<(typeof categories)[number]>('All')
  const [query, setQuery] = useState('')
  const [compare, setCompare] = useState<string[]>([])

  const filtered = useMemo(() => {
    return pathways.filter(p => {
      const matchCat = category === 'All' || p.category === category
      const matchQuery =
        query.trim() === '' ||
        p.title.toLowerCase().includes(query.toLowerCase()) ||
        p.rationale.toLowerCase().includes(query.toLowerCase())
      return matchCat && matchQuery
    })
  }, [category, query])

  function toggleCompare(id: string) {
    setCompare(cur =>
      cur.includes(id) ? cur.filter(x => x !== id) : cur.length < 3 ? [...cur, id] : cur
    )
  }

  return (
    <div className={styles.shell} data-testid="route-pathways-explorer">
      <div className={styles.header}>
        <Text as="h1" className={styles.title}>
          Pathways Explorer
        </Text>
        <div className={styles.headerMeta} aria-label="Pathway context">
          <span className={styles.pill}>Career pathways</span>
          <span className={styles.pill}>{pathways.length} routes</span>
          <span className={styles.pill}>Fit scoring</span>
          <span className={styles.pill}>Demand signals</span>
          <span className={styles.pill}>Learning gaps</span>
          <span className={styles.pill}>Local next steps</span>
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
        <div className={styles.filters}>
          {categories.map(c => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              className={category === c ? styles.pillButtonActive : styles.pillButton}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
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
                <span className={styles.pill}>{p.category}</span>
              </div>

              <div>
                <div className={styles.metaRow} style={{ marginBottom: 6 }}>
                  <span>
                    <strong style={{ color: t.brand.ink, fontSize: '0.95rem' }}>
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
                <span className={styles.metaItem}>
                  <MapPinIcon className={styles.iconSm} aria-hidden="true" />
                  {p.region}
                </span>
                <span>· {p.duration}</span>
              </div>

              <div>
                <Text size={200} weight="semibold">
                  Linked gaps
                </Text>
                <div className={styles.gapPills} style={{ marginTop: 6 }}>
                  {p.gaps.map(g => (
                    <span key={g} className={styles.pill}>
                      {displayCode(g)}
                    </span>
                  ))}
                </div>
              </div>

              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={compare.includes(p.id) ? styles.cardButtonActive : styles.cardButton}
                  onClick={() => toggleCompare(p.id)}
                >
                  {compare.includes(p.id) ? 'Comparing' : 'Compare'}
                </button>
                <button type="button" className={styles.cardButton}>
                  View details
                </button>
              </div>

              <div className={styles.source}>{p.source}</div>
            </Card>
          ))}
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
