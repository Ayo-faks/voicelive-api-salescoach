import {
  Badge,
  Button,
  Card,
  CardHeader,
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
    source: 'labour_market_fixture · 2026-Q2',
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
    source: 'labour_market_fixture · 2026-Q2',
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
    source: 'labour_market_fixture · 2026-Q2',
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
    source: 'labour_market_fixture · 2026-Q2',
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
    source: 'labour_market_fixture · 2026-Q2',
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
    source: 'labour_market_fixture · 2026-Q2',
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

const useStyles = makeStyles({
  shell: { display: 'grid', gap: '18px' },
  header: { display: 'grid', gap: '6px' },
  title: {
    fontFamily: 'Manrope, sans-serif',
    fontSize: '1.5rem',
    fontWeight: 800,
  },
  subtitle: { color: tokens.colorNeutralForeground2, maxWidth: '640px' },
  filterRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  filters: { display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1 },
  searchBox: { maxWidth: '320px', flex: 1, minWidth: '180px' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '14px',
  },
  card: {
    padding: '16px',
    borderRadius: '16px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'grid',
    gap: '10px',
    transition: 'transform 0.15s, box-shadow 0.15s',
    ':hover': {
      transform: 'translateY(-2px)',
      boxShadow: '0 12px 28px rgba(15, 42, 58, 0.12)',
    },
  },
  cardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
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
    background: 'linear-gradient(90deg, #0a0a0a, #525252)',
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
  source: {
    fontSize: '0.7rem',
    color: tokens.colorNeutralForeground3,
    borderTop: `1px dashed ${tokens.colorNeutralStroke2}`,
    paddingTop: '8px',
  },
  compareBar: {
    position: 'sticky',
    bottom: '70px',
    backgroundColor: '#0f172a',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
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
        <Text className={styles.subtitle}>
          Career Pathways Marketplace · {pathways.length} pathways · fit, wage
          band, demand, learning gaps and locally grounded next steps.
        </Text>
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
            <Badge
              key={c}
              appearance={category === c ? 'filled' : 'outline'}
              onClick={() => setCategory(c)}
              style={{ cursor: 'pointer' }}
            >
              {c}
            </Badge>
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
                <Badge appearance="tint">{p.category}</Badge>
              </div>

              <div>
                <div className={styles.metaRow} style={{ marginBottom: 6 }}>
                  <span>
                    <strong style={{ color: '#0a0a0a', fontSize: '0.95rem' }}>
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
                    <Badge key={g} appearance="outline">
                      {g}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className={styles.cardActions}>
                <Button
                  appearance={compare.includes(p.id) ? 'primary' : 'secondary'}
                  size="small"
                  onClick={() => toggleCompare(p.id)}
                >
                  {compare.includes(p.id) ? 'Comparing' : 'Compare'}
                </Button>
                <Button appearance="subtle" size="small">
                  View details
                </Button>
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
          <Button appearance="primary" size="small">
            Compare side-by-side
          </Button>
        </div>
      )}
    </div>
  )
}
