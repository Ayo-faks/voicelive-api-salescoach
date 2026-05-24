import {
  Badge,
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
      { source: 'pathfinder_phase_2_fixture', confidence: 1, evidence_count: 12 },
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
      { source: 'pathfinder_phase_2_fixture', confidence: 1, evidence_count: 10 },
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
      { source: 'pathfinder_phase_2_fixture', confidence: 1, evidence_count: 8 },
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
      { source: 'pathfinder_phase_2_fixture', confidence: 1, evidence_count: 9 },
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
  titleBlock: { display: 'grid', gap: '6px' },
  title: {
    fontFamily: 'Manrope, sans-serif',
    fontSize: '1.5rem',
    fontWeight: 800,
  },
  subtitle: { color: tokens.colorNeutralForeground2, maxWidth: '680px' },
  toolbar: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  searchBox: { maxWidth: '340px', flex: 1, minWidth: '220px' },
  filters: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '14px',
  },
  card: {
    padding: '16px',
    borderRadius: '14px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'grid',
    gap: '10px',
  },
  cardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
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
  if (!first) return 'No provenance yet'
  return `${first.source} · ${first.evidence_count} evidence`
}

function isSubject(value: string | null | undefined): value is string {
  return Boolean(value)
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
    () => ['All', ...Array.from(new Set(skills.map(skill => skill.subject).filter(isSubject)))],
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
          <Text className={styles.subtitle}>
            Curriculum catalogue · {skills.length} skills · prerequisites,
            knowledge components, localisations and provenance.
          </Text>
        </div>
        <Badge appearance="tint">{source === 'live' ? 'Live catalogue' : 'Fixture catalogue'}</Badge>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Input
            placeholder="Search skills"
            value={query}
            onChange={(_, data) => setQuery(data.value)}
            contentBefore={<MagnifyingGlassIcon style={{ width: 16, height: 16 }} aria-hidden="true" />}
          />
        </div>
        <div className={styles.filters}>
          {subjects.map(item => (
            <Badge
              key={item}
              appearance={subject === item ? 'filled' : 'outline'}
              onClick={() => setSubject(item)}
              style={{ cursor: 'pointer' }}
            >
              {item}
            </Badge>
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
                  <Text className={styles.cardTitle}>{skill.name}</Text>
                  {' '}
                  <Text className={styles.cardSkillId}>{skill.skill_id}</Text>
                </div>
                <Badge appearance="outline">{skill.status}</Badge>
              </div>

              <Text size={200}>{skill.description ?? 'No description yet.'}</Text>

              <div className={styles.meta}>
                <Badge appearance="tint">{skill.subject ?? 'Subject unset'}</Badge>
                <Badge appearance="outline">{yearBand(skill)}</Badge>
                <Badge appearance="outline">{skill.standard_id}</Badge>
              </div>

              <div className={styles.tags}>
                <Badge icon={<Squares2X2Icon width={14} height={14} aria-hidden="true" />} appearance="outline">
                  {skill.prerequisites.length} prereq
                </Badge>
                {skill.kc_tags.slice(0, 4).map(tag => (
                  <Badge key={tag} appearance="outline">
                    {tag}
                  </Badge>
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