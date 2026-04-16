# Wulo AI Optionality And Asset Strategy

Prepared: 2026-04-13

This memo answers six strategic questions grounded in the current repository, product docs, and service architecture.

## 1. If Wulo Were Going To Be An AI App, What Could It Be?

The strongest version of Wulo is not a generic AI speech app. It is an AI continuity-of-care platform for paediatric speech therapy.

The child-facing layer would be the visible product surface:

- real-time voice interaction
- adaptive prompts and retries
- calm avatar-based practice
- immediate scoring and encouragement

The therapist-facing layer would be the real commercial engine:

- AI-assisted session review
- governed child memory
- explainable recommendations
- next-session planning
- longitudinal context across sessions

The clinic-facing layer would be the longer-term strategic expansion:

- de-identified cross-child insight
- cue effectiveness patterns
- exercise-type performance patterns
- institutional reporting and tuning

The sharpest way to think about Wulo as an AI company is this:

Wulo could become an AI operating system for supervised speech practice, where the child buddy is the interface and the therapist intelligence layer is the true product.

## 2. What Are The Clear Features Today?

Wulo already has a substantial shipped surface.

### Child Practice Features

- realtime voice-based child practice sessions
- avatar-led session experience over WebRTC
- therapist-authored and built-in exercises
- guided prompts, retries, and supportive practice flow
- immediate utterance scoring for supported exercises

### Therapist Workflow Features

- authenticated therapist workspace
- child profile creation and management
- session history and session detail review
- therapist notes and structured feedback
- dashboard charts and review surfaces

### AI And Decision-Support Features

- pronunciation assessment via Azure Speech
- post-session structured AI analysis
- governed child memory proposal generation
- therapist approval and rejection of memory items
- compiled child memory summaries
- explainable next-exercise recommendation ranking
- Copilot-backed next-session planning and refinement

### Access, Privacy, And Collaboration Features

- therapist workspaces and workspace-aware access control
- therapist invite-code claiming flow
- parent invitations and linked child access
- parental consent flow and gating before sessions
- child data export and deletion
- audit logging and retention tooling

### Platform Features

- SQLite runtime path with bootstrap and backup support
- PostgreSQL-capable backend path
- Azure Container Apps deployment path
- telemetry instrumentation and legal page support

The important point is that Wulo is not a thin prototype anymore. It already behaves like a real product system, even if commercial proof is still early.

## 3. What Are The Possible Features Tomorrow?

The most valuable next features are not random AI add-ons. They are features that deepen the therapist workflow and improve measurable continuity of care.

### Higher-Value Product Features

- adaptive live sessions that change prompts and cueing based on approved child memory
- stronger parent practice loop with reminders, assignments, and simplified progress views
- school and SENCO dashboards for cohort and waiting-list support
- local authority and NHS pathway reporting for supervised practice cohorts
- therapist copilot functions for exercise authoring, note drafting, and plan QA
- better progress comparison across target sounds, exercise types, and time windows
- richer clinical workflow explanation for why recommendations were made
- research-grade or commissioning-grade reporting outputs

### Stronger Intelligence Features

- live cue optimization based on what has worked before
- benchmark insights across reviewed children in de-identified form
- stronger recommendation tuning from therapist-reviewed outcomes
- compact outcome summaries for case review and renewal conversations

### Features That Should Be Avoided Or Treated Carefully

- autonomous diagnosis
- unsupervised therapeutic decision-making
- black-box recommendations without evidence
- any feature that weakens therapist control or clinical trust

The right future roadmap is not more AI. It is more trustworthy and more useful supervised AI.

## 4. What Business Could Spin Out Of Wulo?

There are multiple businesses latent inside the current product.

### 1. Therapist Copilot SaaS

This is the cleanest adjacent business.

It would focus on:

- review
- memory
- recommendations
- planning
- continuity between sessions

This could work even without owning the full child-facing avatar experience.

### 2. White-Label Practice Infrastructure

Wulo could become the backend platform for clinics, therapy providers, or education companies that want their own branded supervised speech-practice experience.

### 3. Waiting-List Continuity Platform

For schools, local authorities, or NHS community providers, Wulo could become a structured between-session or pre-therapy support system for waiting-list cohorts.

### 4. Clinic Intelligence Product

The institutional memory direction suggests a future analytics product that helps clinics understand what cues, targets, and exercise structures are working across their practice.

### 5. Cross-Vertical Supervised AI Workflow Platform

The governed-memory, planning, recommendation, and therapist-review stack could be adapted to adjacent domains such as occupational therapy, literacy intervention, autism support, or other supervised child-development workflows.

### 6. Regulated Child-AI Infrastructure Business

Because Wulo already includes consent, audit, export, deletion, and reviewed memory logic, it could evolve into infrastructure for child-data AI products that need safer human-in-the-loop design.

The strongest spinout depends on where real traction appears first:

- therapist traction favors a copilot business
- institutional traction favors a waiting-list and reporting business
- weak product traction but strong infrastructure quality favors an API or platform business

## 5. What Data Would Be Needed For Future Business?

Wulo already captures useful operational and product data, but future businesses would require deeper and more structured evidence.

### Data Already Present In The Current Product

- child profiles
- transcripts
- pronunciation scores
- AI assessments
- therapist notes
- plans
- memory items and proposals
- recommendation logs
- consent records
- audit trail events

### Data Needed For A Stronger Therapist Copilot Business

- recommendation acceptance and rejection rates
- plan adoption and therapist edits
- review completion rates
- time-to-review metrics
- repeat weekly usage patterns
- session-to-next-session continuity metrics
- retention and willingness-to-pay signals

### Data Needed For Clinic Intelligence Or Institutional Products

- de-identified longitudinal outcomes by target sound
- exercise-type performance over time
- cue effectiveness patterns
- progression rates by age band and practice type
- cohort-level adherence and completion data
- review efficiency and therapist time-saved metrics

### Data Needed For Stronger Commercial Learning

- pilot-to-paid conversion
- pricing feedback by segment
- churn and non-renewal reasons
- demo-to-activation drop-off
- role-based usage patterns across therapist, parent, and school users

### Data Needed For A Proprietary Model Or Scoring Business

This is the hardest category.

Wulo would need:

- properly consented raw audio retention
- high-quality therapist labels
- age-calibrated ground truth
- longitudinal outcome labels
- clear separation between operational data use and model-improvement data use

That is important because the current privacy posture is intentionally conservative: audio is processed in real time and not stored after sessions. That is good for compliance, but weak for building a proprietary speech-model asset.

In short, Wulo has enough data to build workflow intelligence, but not yet enough to claim a deep proprietary model moat.

## 6. If Wulo Fails, What Components Could Be Sold As An API, Agent, Or Service?

If the product company fails, the codebase still contains multiple saleable assets.

### Strongest API Candidates

#### Speech Assessment API

This includes:

- utterance scoring
- pronunciation assessment
- post-session structured analysis

This is one of the clearest standalone services in the repo.

#### Recommendation API

The next-exercise ranking logic, evidence handling, and recommendation logging could be sold as a recommendation service for supervised practice products.

### Strongest Agent Candidates

#### Planning Agent

The therapist planning runtime could be sold as a next-session planning copilot for clinical or educational workflows.

#### Review Copilot

The combination of session summary, memory inputs, and structured planning can be repackaged as a review assistant for professionals who need support but still want control.

### Strongest Workflow-Service Candidates

#### Governed Memory Service

The child memory service is more broadly valuable than Wulo itself.

It already includes:

- proposal generation
- approval and rejection workflow
- summary compilation
- evidence linking
- runtime-safe read-only personalization inputs

That pattern generalizes well beyond speech therapy.

#### Institutional Memory Service

The de-identified clinic-level insight engine could become an analytics service for reviewed-outcome environments.

#### Realtime Voice Session Orchestration Service

The WebSocket, Voice Live, avatar, and session setup stack could be sold as white-label infrastructure for real-time guided voice experiences.

#### Child-AI Compliance Layer

The consent, export, deletion, access control, and audit stack could be repackaged as compliance-ready workflow infrastructure for child-data AI products.

#### Invitation And Collaboration Layer

The parent invitation, caregiver-linking, workspace, and role flows could be reused in many supervised family-facing systems.

### Least Sellable Components

- the Wulo-specific branding
- the current narrow GTM story
- generic frontend presentation layers without the underlying workflow engines

### Most Sellable Components

- assessment and scoring APIs
- planning and recommendation agents
- governed memory service
- real-time voice orchestration infrastructure
- compliance-ready supervised-AI backend services

## Bottom Line

If Wulo succeeds, it should likely succeed as a therapist-centric AI workflow platform with a child-facing practice layer.

If it partially succeeds, the most defensible adjacent business is therapist copilot plus clinic intelligence.

If the product business fails, the strongest salvage value is in the assessment API, governed memory system, planning and recommendation agent stack, and compliance-ready supervised-AI infrastructure.