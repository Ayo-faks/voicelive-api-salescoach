# Pathfinder Learn App Guide and Pilot Walkthrough

Use this document to explain the current Pathfinder Learn web app in a stakeholder walkthrough. It maps each visible page, form, and control to the real teaching or school-leadership job it supports.

The current demo is a responsive web app: teacher and admin views work best on desktop or tablet, while the learner workflow also condenses for phone and offline practice.

## Roles and Entry Points

| Role | Default route | Main purpose | Real-life school function |
|---|---|---|---|
| Learner / student | `/home` | Daily diagnostic, practice, and career questions | Complete short work independently in class, at home, or on a shared device |
| Teacher / admin | `/teacher` | Class mastery dashboard and approval queue | Diagnose the class, plan reteaching, approve interventions, and review evidence |
| Admin | `/library` | Curriculum skills catalogue | Align diagnostics and practice to the taught curriculum |
| Parent / learner / admin | `/profile` | Learner profile and parent-ready summary | Explain progress and next actions in plain language for home and school meetings |
| Parent / learner / admin | `/pathways` | Career and pathway exploration | Connect current strengths and gaps to realistic subject and career choices |
| Admin | `/safety` | Trust, safety, cost, and school-leader console | Show cohort impact, risk, unit cost, governance, and rollout readiness |

## Global App Shell

The Pathfinder shell gives each role only the navigation they are allowed to use. Admin users see Teacher, Library, Profile, Pathways, and Trust & Safety. Learners see Today, Profile, and Pathways.

Visible global controls:

- Sidebar or bottom navigation, depending on screen size.
- Cookie consent banner, positioned away from the voice/text agent controls.
- Optional voice agent launcher when the backend feature flag enables it.
- English / Yoruba voice readiness and counsellor sign-off status in the app chrome.

Teaching function: role-aware navigation prevents a student from seeing teacher controls, while still letting a teacher or school leader move quickly between class evidence, parent output, and governance.

## Page Map

### 1. Learner Today — `/home`

This is the student-facing workspace. It is built for desktop web, tablet, shared school devices, and phones.

Visible features and forms:

- `Start 5-step demo` button launches a short diagnostic.
- Optional `Voice check-in` button records a voice frame when voice is enabled.
- Cross-device panel explains desktop web, tablet/shared device, and phone/offline modes.
- `3-5 minute demo diagnostic` card asks five signals: numeracy, reading comprehension, voice read-aloud, subject knowledge, and career interest.
- Multiple-choice answer buttons capture diagnostic responses.
- Adaptive moment card appears when the student answers the ratio item incorrectly; the next item becomes a smaller scaffolded ratio step.
- `Bite-sized practice exercise` card presents a teacher-approved ratio recovery exercise.
- Practice answer buttons give immediate feedback and then show a spaced retrieval schedule.
- `Career Navigator` form includes a text input and `Ask by text` / `Ask by voice` buttons.
- Career answer card responds to “Can I still become a doctor if I’m weak in chemistry?” with grounded guidance and a visible `No outcome guarantee` badge.
- Today’s path, weekly progress, recent feedback, and trust summary support the student’s daily routine.

Teaching function: this page turns diagnostic assessment into a short routine students can complete without waiting for the teacher to mark every script. The adaptive moment shows the student getting a smaller step instead of simply being marked wrong. The practice card turns an approved plan into one concrete exercise and schedules retrieval so the same gap is revisited later.

### 2. Teacher Mastery Dashboard — `/teacher`

This is the main classroom command centre.

Visible features and forms:

- Class selector tabs: JSS1 A, JSS2 A, JSS3 A, SS1 A, SS2 A, SS3 A.
- Mastery filter tabs: All learners, Needs support, Developing, Secure.
- Class heatmap for 58 students across maths sub-skills: Ratio, Fractions, Linear equations, Geometry.
- Heatmap cells show mastery percentage and uncertainty; clicking a cell opens the student profile drawer.
- `Transparent student profile` prompt and `Open student profile` button make the drawer discoverable.
- Student profile drawer shows strengths, gaps and evidence, voice fluency, proposed memory facts, skill mastery, recent responses, and recent mastery events.
- Mastery adjustment form in the drawer allows a teacher to adjust probability / uncertainty with a reason.
- Class summary tiles show 58 students, 7 intervention flags, weakest sub-skills, and 3 proposed student facts.
- Weakest sub-skills list ranks class gaps for the week.
- Teacher-controlled memory queue lists proposed facts and provides `Approve`, `Edit`, and `Reject` controls.
- Student fact edit form captures edited student name, memory fact, and evidence before approval.
- `Plan an intervention` intent bar accepts a teacher request such as “Create a short ratio reteach plan for students below 60% mastery.”
- Pending practice plan card shows a 1-2 week plan awaiting teacher approval.
- Plan review supports approve, reject, and edit-and-approve flows.
- Audit events list records profile views, overrides, pending plans, approvals, and fact decisions.

Teaching function: this page replaces manual guesswork with a class diagnosis. A teacher can see that ratio and fractions are the week’s weakest skills, identify the seven students below support threshold, open one student’s evidence, approve only the student facts they trust, and approve or edit the next 1-2 week practice plan. The app proposes; the teacher remains accountable.

### 3. Skills Library — `/library`

This is the curriculum catalogue.

Visible features and forms:

- `Search skills` input filters the catalogue by skill name, code, description, prerequisite, and knowledge-component tags.
- Subject filter buttons narrow the catalogue.
- Skill cards show skill name, focus code, status, subject, year band, standard, prerequisites, KC tags, and provenance.

Teaching function: this page helps a teacher or academic lead confirm that Pathfinder is diagnosing and practising real taught skills, not generic ed-tech topics. It supports scheme-of-work planning, prerequisite checks, and remediation sequencing.

### 4. Learner Profile and Parent Summary — `/profile`

This page turns the learner evidence into a plain-language school and home update.

Visible features and controls:

- Learner profile header for Tobi A. with current focus, review date, and counsellor sign-off.
- `One-page parent-ready summary` card with `Ready to send home` status.
- `Send home summary` button.
- Parent summary sections: What we noticed, What Pathfinder did, What to do at home, Next school action.
- Skill radar chart compares mastery against the JSS2 target.
- Risks and flags card highlights ratio mastery below 50% and rising uncertainty.
- Parent progress card gives a family-readable summary.
- Mastery trajectory chart shows ratio and fractions progress over six weeks.
- Counsellor gate panel handles career narration approval / revision.
- Voice queue card shows queued multilingual voice practice.
- Audit notes appear after counsellor actions.

Teaching function: this page supports parent evenings, weekly progress updates, and intervention meetings. It translates “42% ratio mastery with uncertainty” into a parent-safe explanation of what the child is strong at, what they need next, what can be practised at home, and what the school will review.

### 5. Pathways Explorer — `/pathways`

This page connects learning evidence to realistic future options.

Visible features and forms:

- `Search pathways` input filters pathway cards by title and rationale.
- Category filter buttons narrow the view.
- Pathway cards show fit score, wage band, demand signal, region, duration, rationale, linked learning gaps, and source.
- `Compare` buttons let the user select up to three pathways.
- `View details` buttons reserve the detail path for a fuller pathway view.
- Compare bar appears when pathways are selected.

Teaching function: this page gives counsellors and teachers a grounded way to discuss futures without making promises. It shows how current gaps, such as chemistry or ratio weakness, relate to possible pathways and what the student would need to improve.

### 6. Trust & Safety / School Leader Console — `/safety`

This page is for admin, head teacher, DPO, or funder review.

Visible features and controls:

- `Export report` button.
- `Run safety review` button.
- Release banner: all gates green, 25% controlled rollout, last review date.
- `Admin / School Leader View` showing cohort progress, students at risk, common gaps, practice completion, cost per student, teacher approvals pending, intervention impact, and family output readiness.
- Pilot KPI strip for diagnostic completion, approved interventions, evidence coverage, safety pass rate, data request SLA, and weekly cost per student.
- Governance trend chart for safety pass rate, data request SLA, and evidence coverage.
- Release rollout card with rollback triggers and `Pause rollout` button.
- Audit action log with signed history.

Teaching and leadership function: this page answers the school-buyer question: is the intervention working, is it safe, what does it cost, which teachers still have pending approvals, and do students improve after 6-8 weeks?

## End-to-End Teaching Flow

1. **Baseline check-in.** Student opens `/home`, starts the 5-step diagnostic, and answers numeracy, reading, voice, subject, and career-interest prompts.
2. **Adaptive response.** If the student misses the ratio question, Pathfinder visibly adapts the next item to a smaller scaffolded step.
3. **Evidence capture.** Diagnostic responses, mastery estimates, voice fluency, and local sync state become evidence for the teacher.
4. **Class diagnosis.** Teacher opens `/teacher`, reviews the 58-student heatmap, weakest sub-skills, and 7 intervention flags.
5. **Student drill-down.** Teacher selects `Open student profile` or a heatmap cell to inspect strengths, gaps, evidence, voice fluency, and proposed memory facts.
6. **Teacher-controlled memory.** Teacher approves, edits, or rejects proposed student facts. Approved facts can personalise future plans; rejected facts cannot.
7. **Plan proposal.** Pathfinder creates or seeds a 1-2 week practice plan for the weakest skills and affected students.
8. **Human approval.** Teacher reviews, edits, approves, or rejects the plan. The plan does not silently mutate student state.
9. **Student practice.** Student completes one bite-sized exercise from the approved plan and receives immediate feedback.
10. **Spaced retrieval.** The app schedules follow-up practice today, tomorrow, and later in the week.
11. **Parent communication.** Teacher or admin opens `/profile` and sends a one-page parent summary.
12. **Career conversation.** Student asks a pathway question; Pathfinder gives age-appropriate, grounded guidance without promising outcomes.
13. **School leadership review.** Admin opens `/safety` to review cohort progress, at-risk students, unit cost, pending approvals, and intervention impact after 6-8 weeks.

## Real-Life Teaching Function Map

| School job | Pathfinder feature | What changes in the teacher’s week |
|---|---|---|
| Diagnose a large class | Heatmap, diagnostic, mastery uncertainty | Teacher sees which sub-skills are weak before planning the next lesson |
| Group students for reteaching | Weakest sub-skills, intervention flags, target student list | Teacher forms small groups based on evidence, not memory or exam averages |
| Understand one student’s struggle | Transparent profile drawer | Teacher can explain why Pathfinder thinks the student is struggling |
| Prevent invisible personalisation | Teacher-controlled memory approval | Student facts only affect future plans after teacher approval |
| Create short intervention plans | Pending 1-2 week practice plan | Teacher gets a draft plan with target skills, students, resources, and rationale |
| Keep the teacher in control | Approve / edit / reject plan controls | The teacher can tighten scope, reject weak suggestions, and leave an audit trail |
| Reduce marking load | Auto-scored practice and immediate feedback | Teacher focuses on intervention decisions instead of marking repeated worksheets |
| Build retrieval habit | Spaced retrieval schedule | Missed skills return automatically until mastery improves |
| Communicate with parents | One-page parent-ready summary | Parent meetings start from clear strengths, gaps, home action, and next school action |
| Support careers guidance | Career Navigator and Pathways Explorer | Students get realistic next steps, not unsupported promises |
| Manage school rollout | Trust & Safety console | Leaders see impact, cost per student, governance, and safety readiness |
| Evidence compliance | Audit events, xAPI, metrics, export report | The school can show what happened, who approved it, and why |

## Demo Walkthrough Script

Use this path for a live stakeholder walkthrough after the backend and frontend are running.

1. Open `/teacher` as an admin or teacher.
2. Point out the class summary: 58 students, 7 intervention flags, 3 weakest sub-skills, and 3 proposed facts.
3. Show the class heatmap and explain that each cell is mastery plus uncertainty.
4. Click `Open student profile` and review strengths, gaps/evidence, voice fluency, proposed memory facts, and recent responses.
5. In the drawer, explain that a teacher can adjust mastery only with an evidence-backed reason.
6. Review `Teacher-controlled memory`; approve, edit, or reject one proposed fact if the demo calls for it.
7. Review the `1-2 week practice plan awaiting teacher approval` card.
8. Open plan review, explain target skills, target learners, resources, rationale, and provenance, then approve or edit-and-approve.
9. Open `/home` with a learner role or demo browser context; run the 5-step diagnostic and intentionally answer the first ratio question incorrectly.
10. Show the adaptive moment: the next item changes to a smaller ratio scaffold.
11. Complete the practice exercise with `9 cups`; show immediate feedback and the spaced retrieval schedule.
12. Ask the career question; show the `No outcome guarantee` badge and grounded science-pathway guidance.
13. Open `/profile`; show the one-page parent-ready summary and explain how it supports parent meetings.
14. Open `/pathways`; search or filter pathways and compare up to three options.
15. Open `/safety`; show cohort progress, students at risk, cost per student, teacher approvals pending, intervention impact, family output, and the audit action log.
16. Optionally open `/api/learning/audit` and `/api/learning/metrics` to show backend evidence: approval decisions, xAPI counters, and route metrics.

## Demo Acceptance Checklist

- `/teacher` shows the seeded pending practice plan, not an empty pending-plan state.
- `/teacher` has a visible `Open student profile` action near the heatmap.
- The profile drawer shows strengths, gaps/evidence, voice fluency, proposed memory facts, skill mastery, and recent evidence.
- Teacher-controlled memory shows approve, edit, and reject controls.
- The learner diagnostic visibly adapts after an incorrect answer.
- The practice exercise gives immediate feedback and schedules spaced retrieval.
- The career answer is grounded and includes `No outcome guarantee`.
- `/profile` includes the one-page parent-ready summary.
- `/safety` includes cohort progress, at-risk students, common gaps, practice completion, unit cost, pending approvals, intervention impact, and family output.
- Audit events update after profile views, overrides, plan decisions, and student fact decisions.

## Backend Evidence to Mention

- `GET /api/learning/class/mastery` powers the heatmap.
- `GET /api/learning/approvals/pending` powers the pending practice plan queue.
- `POST /api/learning/approvals/<plan_id>/approve`, `/reject`, and `/edit-approve` store teacher decisions.
- `GET /api/learning/student-facts/pending` powers teacher-controlled memory.
- `POST /api/learning/student-facts/<fact_id>/approve`, `/reject`, and `/edit-approve` store memory decisions.
- `GET /api/learning/students/<student_id>/profile` powers the transparent profile drawer.
- `GET /api/learning/audit` and `GET /api/learning/metrics` provide audit and observability evidence.
- Postgres/RLS validation for pilot acceptance should still use `backend/scripts/verify_learning_postgres_rls.py --json` against the runtime database.