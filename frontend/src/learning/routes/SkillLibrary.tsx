import {
  Card,
  Input,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  MagnifyingGlassIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline'
import { useEffect, useMemo, useState } from 'react'
import { listSkills, type CatalogueSkill } from '../api'
import { pathfinderTokens as t } from '../theme/pathfinder-tokens'

const fallbackSkills: CatalogueSkill[] = [
  {
    skill_id: 'ratio-proportion',
    tenant_id: 'tenant-phase-2',
    standard_id: 'jss2-maths',
    name: 'Ratio and proportion',
    description: 'Compare quantities, scale recipes, and use ratio tables.',
    subject: 'Mathematics',
    prerequisites: ['fraction-operations'],
    kc_tags: ['multiplicative-reasoning', 'scaling'],
    localisations: { 'yo-NG': 'Ipin ati afiwe' },
    year_group_min: 8,
    year_group_max: 8,
    status: 'active',
    lang: 'en-NG',
    provenance: [
      {
        source: 'pathfinder_phase_2_fixture',
        confidence: 1,
        evidence_count: 12,
      },
    ],
  },
  {
    skill_id: 'fraction-operations',
    tenant_id: 'tenant-phase-2',
    standard_id: 'jss2-maths',
    name: 'Fraction operations',
    description: 'Add, compare, and reason with fractions using visual bars.',
    subject: 'Mathematics',
    prerequisites: [],
    kc_tags: ['number-sense', 'equivalence'],
    localisations: { 'yo-NG': 'Ise ida' },
    year_group_min: 8,
    year_group_max: 8,
    status: 'active',
    lang: 'en-NG',
    provenance: [
      {
        source: 'pathfinder_phase_2_fixture',
        confidence: 1,
        evidence_count: 10,
      },
    ],
  },
  {
    skill_id: 'linear-equations',
    tenant_id: 'tenant-phase-2',
    standard_id: 'jss2-maths',
    name: 'Linear equations',
    description: 'Solve one-step and two-step equations from class contexts.',
    subject: 'Mathematics',
    prerequisites: ['ratio-proportion'],
    kc_tags: ['algebra', 'inverse-operations'],
    localisations: { 'yo-NG': 'Idogba ila' },
    year_group_min: 8,
    year_group_max: 9,
    status: 'active',
    lang: 'en-NG',
    provenance: [
      {
        source: 'pathfinder_phase_2_fixture',
        confidence: 1,
        evidence_count: 8,
      },
    ],
  },
  {
    skill_id: 'plane-geometry',
    tenant_id: 'tenant-phase-2',
    standard_id: 'jss2-maths',
    name: 'Plane geometry',
    description: 'Use angle, area, and shape properties in practical problems.',
    subject: 'Mathematics',
    prerequisites: [],
    kc_tags: ['measurement', 'spatial-reasoning'],
    localisations: { 'yo-NG': 'Jiometiri alapin' },
    year_group_min: 8,
    year_group_max: 9,
    status: 'active',
    lang: 'en-NG',
    provenance: [
      {
        source: 'pathfinder_phase_2_fixture',
        confidence: 1,
        evidence_count: 9,
      },
    ],
  },
]

const useStyles = makeStyles({
  shell: { display: 'grid', gap: '18px' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: '16px',
    flexWrap: 'wrap',
  },
  titleBlock: { display: 'grid', gap: '10px' },
  title: {
    fontFamily: t.font.display,
    fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
    fontWeight: 700,
    letterSpacing: '-0.025em',
  },
  subtitle: { color: tokens.colorNeutralForeground2, maxWidth: '680px' },
  headerMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  toolbar: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  searchBox: { maxWidth: '340px', flex: 1, minWidth: '220px' },
  filters: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
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
    border: `1px solid var(--pf-ink)`,
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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '14px',
  },
  card: {
    padding: '16px',
    borderRadius: t.radius.md,
    border: 'var(--pf-hairline)',
    boxShadow: 'var(--pf-shadow-card-elevated)',
    display: 'grid',
    gap: '10px',
  },
  cardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
    flexWrap: 'wrap',
  },
  cardTitleBlock: { display: 'block' },
  cardTitle: {
    display: 'block',
    fontWeight: 800,
    fontSize: '1rem',
    lineHeight: 1.25,
  },
  cardSkillId: {
    display: 'block',
    marginTop: '3px',
    color: tokens.colorNeutralForeground3,
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: '0.72rem',
    lineHeight: 1.35,
  },
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    color: tokens.colorNeutralForeground2,
  },
  tags: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  provenance: {
    borderTop: `1px dashed ${tokens.colorNeutralStroke2}`,
    paddingTop: '8px',
    color: tokens.colorNeutralForeground3,
    fontSize: '0.72rem',
  },
  empty: {
    padding: '40px',
    textAlign: 'center',
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: '14px',
    color: tokens.colorNeutralForeground3,
  },
})

function yearBand(skill: CatalogueSkill) {
  if (skill.year_group_min && skill.year_group_max) {
    return skill.year_group_min === skill.year_group_max
      ? `JSS${skill.year_group_min}`
      : `JSS${skill.year_group_min}-${skill.year_group_max}`
  }
  return 'Year group unset'
}

function provenanceLabel(skill: CatalogueSkill) {
  const first = skill.provenance[0]
  if (!first) return 'Review notes pending'
  return `${first.evidence_count} curriculum signal${first.evidence_count === 1 ? '' : 's'}`
}

function isSubject(value: string | null | undefined): value is string {
  return Boolean(value)
}

function displayCode(value: string) {
  return value
    .replace(/^ng[_-]/i, 'Nigerian ')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function statusLabel(value: string) {
  return displayCode(value)
}

export default function SkillLibrary() {
  const styles = useStyles()
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('All')
  const [skills, setSkills] = useState<CatalogueSkill[]>(fallbackSkills)
  const [source, setSource] = useState<'fixture' | 'live'>('fixture')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const result = await listSkills({ limit: 100 })
        if (!cancelled && result.skills.length > 0) {
          setSkills(result.skills)
          setSource('live')
        }
      } catch (err) {
        // Local frontend-only mode keeps the seeded fixture visible.
        // eslint-disable-next-line no-console
        console.warn('learning skills library refresh failed', err)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const subjects = useMemo(
    () => [
      'All',
      ...Array.from(
        new Set(skills.map(skill => skill.subject).filter(isSubject))
      ),
    ],
    [skills]
  )

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return skills.filter(skill => {
      const matchesSubject = subject === 'All' || skill.subject === subject
      const haystack = [
        skill.name,
        skill.skill_id,
        skill.description,
        skill.kc_tags.join(' '),
        skill.prerequisites.join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return matchesSubject && (!normalized || haystack.includes(normalized))
    })
  }, [query, skills, subject])

  return (
    <div className={styles.shell} data-testid="route-skill-library">
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <Text as="h1" className={styles.title}>
            Skills Library
          </Text>
          <div className={styles.headerMeta} aria-label="Catalogue context">
            <span className={styles.pill}>Curriculum catalogue</span>
            <span className={styles.pill}>{skills.length} skills</span>
            <span className={styles.pill}>Prerequisites</span>
            <span className={styles.pill}>Local language signals</span>
            <span className={styles.pill}>Review evidence</span>
          </div>
        </div>
        <span className={styles.pill}>
          {source === 'live' ? 'Updated catalogue' : 'Ready catalogue'}
        </span>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Input
            placeholder="Search skills"
            value={query}
            onChange={(_, data) => setQuery(data.value)}
            contentBefore={
              <MagnifyingGlassIcon
                style={{ width: 16, height: 16 }}
                aria-hidden="true"
              />
            }
          />
        </div>
        <div className={styles.filters}>
          {subjects.map(item => (
            <button
              key={item}
              type="button"
              aria-pressed={subject === item}
              className={
                subject === item ? styles.pillButtonActive : styles.pillButton
              }
              onClick={() => setSubject(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>No skills match this view.</div>
      ) : (
        <div className={styles.grid}>
          {filtered.map(skill => (
            <Card key={skill.skill_id} className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitleBlock}>
                  <Text className={styles.cardTitle}>{skill.name}</Text>{' '}
                  <Text className={styles.cardSkillId}>
                    Focus: {displayCode(skill.skill_id)}
                  </Text>
                </div>
                <span className={styles.pill}>{statusLabel(skill.status)}</span>
              </div>

              <Text size={200}>
                {skill.description ?? 'Description coming soon.'}
              </Text>

              <div className={styles.meta}>
                <span className={styles.pill}>
                  {skill.subject ?? 'Subject unset'}
                </span>
                <span className={styles.pill}>{yearBand(skill)}</span>
                <span className={styles.pill}>
                  {displayCode(skill.standard_id)}
                </span>
              </div>

              <div className={styles.tags}>
                <span className={styles.pill}>
                  <Squares2X2Icon width={14} height={14} aria-hidden="true" />
                  {skill.prerequisites.length} prerequisite
                  {skill.prerequisites.length === 1 ? '' : 's'}
                </span>
                {skill.kc_tags.slice(0, 4).map(tag => (
                  <span key={tag} className={styles.pill}>
                    {displayCode(tag)}
                  </span>
                ))}
              </div>

              <div className={styles.provenance}>{provenanceLabel(skill)}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
