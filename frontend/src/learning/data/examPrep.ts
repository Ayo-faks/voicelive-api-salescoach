/**
 * Exam-prep catalogue for the learner-facing Exam prep library.
 *
 * Previously this catalogue was hard-coded inside `StudentLearningHome`. It now
 * lives here so it can be rendered as its own navigable, searchable library
 * page (`/exam-prep`) while remaining a single source of truth.
 *
 * Every item carries an explicit `subject` so the library can filter reliably;
 * the early Maths/English items that previously omitted it have been backfilled.
 */

export type Activity = {
  id: string
  title: string
  meta: string
  minutes: number
  type: 'check-in' | 'practice' | 'exit-ticket'
  skillId?: string
  subject?: string
}

export const examPrep: Activity[] = [
  {
    id: 'maths-ss3-indices',
    title: 'Maths · Laws of indices',
    meta: 'SS3 Indices · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.indices.laws_of_indices',
    subject: 'mathematics',
  },
  {
    id: 'maths-ss3-mensuration',
    title: 'Maths · Mensuration',
    meta: 'SS3 Geometry · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.geometry.mensuration',
    subject: 'mathematics',
  },
  {
    id: 'maths-jss3-fractions',
    title: 'Maths · Fractions',
    meta: 'JSS3 Number · JSSCE prep',
    minutes: 5,
    type: 'practice',
    skillId: 'jss3.number.fractions',
    subject: 'mathematics',
  },
  {
    id: 'english-ss3-sentence',
    title: 'English · Sentence completion',
    meta: 'SS3 Lexis & structure · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.lexis_and_structure.sentence_completion',
    subject: 'english',
  },
  {
    id: 'english-jss3-comprehension',
    title: 'English · Reading comprehension',
    meta: 'JSS3 Comprehension · JSSCE prep',
    minutes: 6,
    type: 'practice',
    skillId: 'jss3.comprehension.reading',
    subject: 'english',
  },
  {
    id: 'english-jss3-vocab',
    title: 'English · Synonyms',
    meta: 'JSS3 Vocabulary · JSSCE prep',
    minutes: 5,
    type: 'practice',
    skillId: 'jss3.english.vocab.synonyms',
    subject: 'english',
  },
  {
    id: 'government-ss3-basics',
    title: 'Government · Power & authority',
    meta: 'SS3 Basic concepts · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.government.basic_concepts.power_authority',
    subject: 'government',
  },
  {
    id: 'government-ss3-constitution',
    title: 'Government · Nigerian constitutions',
    meta: 'SS3 Constitution · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.government.constitution.nigerian_constitutions',
    subject: 'government',
  },
  {
    id: 'history-ss3-early-states',
    title: 'History · Early Nigerian states',
    meta: 'SS3 Early states · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.history.early_nigerian_states.kanem_bornu',
    subject: 'history',
  },
  {
    id: 'history-ss3-independence',
    title: 'History · Road to independence',
    meta: 'SS3 Independence · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.history.independence.challenges',
    subject: 'history',
  },
  {
    id: 'literature-ss3-figures-of-speech',
    title: 'Literature · Figures of speech',
    meta: 'SS3 Figures of speech · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.literature.figures_of_speech.comparison',
    subject: 'literature',
  },
  {
    id: 'literature-ss3-african-prose',
    title: 'Literature · African prose fiction',
    meta: 'SS3 African literature · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.literature.african_literature.prose_fiction',
    subject: 'literature',
  },
  {
    id: 'physics-ss3-kinematics',
    title: 'Physics · Motion & kinematics',
    meta: 'SS3 Kinematics · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.physics.kinematics.speed_def',
    subject: 'physics',
  },
  {
    id: 'physics-ss3-current-electricity',
    title: 'Physics · Current electricity',
    meta: 'SS3 Electricity · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.physics.current_electricity.current_def',
    subject: 'physics',
  },
  {
    id: 'economics-ss3-scarcity',
    title: 'Economics · Scarcity & choice',
    meta: 'SS3 Basic economic problem · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.economics.basic_economic_problem.scarcity',
    subject: 'economics',
  },
  {
    id: 'economics-ss3-opportunity-cost',
    title: 'Economics · Opportunity cost',
    meta: 'SS3 Basic economic problem · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.economics.basic_economic_problem.opportunity_cost',
    subject: 'economics',
  },
  {
    id: 'data-processing-ss3-data',
    title: 'Data Processing · Data vs information',
    meta: 'SS3 Data & information · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.data_processing.data_information.data_def',
    subject: 'data_processing',
  },
  {
    id: 'data-processing-ss3-information',
    title: 'Data Processing · Information',
    meta: 'SS3 Data & information · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.data_processing.data_information.info_def',
    subject: 'data_processing',
  },
  {
    id: 'computer-science-ss3-history',
    title: 'Computer Science · History of computing',
    meta: 'SS3 Generations of computers · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.computer_science.history_generations.definition',
    subject: 'computer_science',
  },
  {
    id: 'computer-science-ss3-abacus',
    title: 'Computer Science · Early computing devices',
    meta: 'SS3 Generations of computers · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.computer_science.history_generations.abacus',
    subject: 'computer_science',
  },
  {
    id: 'agricultural-science-ss3-meaning',
    title: 'Agricultural Science · Meaning & importance',
    meta: 'SS3 Meaning & importance · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.agricultural_science.meaning_importance.definition',
    subject: 'agricultural_science',
  },
  {
    id: 'agricultural-science-ss3-food',
    title: 'Agricultural Science · Food & agriculture',
    meta: 'SS3 Meaning & importance · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.agricultural_science.meaning_importance.food',
    subject: 'agricultural_science',
  },
  {
    id: 'biology-ss3-living-things',
    title: 'Biology · Characteristics of living things',
    meta: 'SS3 Living things · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.biology.living_things.mrs_gren',
    subject: 'biology',
  },
  {
    id: 'biology-ss3-respiration',
    title: 'Biology · Respiration',
    meta: 'SS3 Living things · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.biology.living_things.respiration_def',
    subject: 'biology',
  },
  {
    id: 'chemistry-ss3-matter',
    title: 'Chemistry · Particulate nature of matter',
    meta: 'SS3 Particulate matter · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.chemistry.particulate_matter.matter_def',
    subject: 'chemistry',
  },
  {
    id: 'chemistry-ss3-states',
    title: 'Chemistry · States of matter',
    meta: 'SS3 Particulate matter · WAEC/NECO prep',
    minutes: 6,
    type: 'practice',
    skillId: 'ss3.chemistry.particulate_matter.states',
    subject: 'chemistry',
  },
]

/** Human-readable subject label from the slug stored on each item. */
export function examPrepSubjectLabel(subject: string | undefined): string {
  if (!subject) return 'General'
  return subject
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Year band derived from the skill-id prefix (e.g. `ss3.*` → `SS3`). */
export function examPrepYear(item: Activity): string {
  const skill = item.skillId ?? ''
  if (skill.startsWith('jss3')) return 'JSS3'
  if (skill.startsWith('ss3')) return 'SS3'
  return 'Other'
}

/** Exam track derived from the item meta (`JSSCE` vs `WAEC/NECO`). */
export function examPrepExam(item: Activity): string {
  if (item.meta.includes('JSSCE')) return 'JSSCE'
  if (item.meta.includes('WAEC')) return 'WAEC/NECO'
  return 'Other'
}
