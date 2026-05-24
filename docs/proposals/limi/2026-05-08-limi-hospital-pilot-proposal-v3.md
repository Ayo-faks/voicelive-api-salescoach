<table border="0" cellpadding="0" cellspacing="0" style="border:none;">
<tr>
<td style="vertical-align:middle; padding-right:16px; border:none;"><img src="../assets/wulo-logo.png" alt="Wulo" width="100" /></td>
<td style="vertical-align:middle; border:none;"><h3 style="margin:0;">A 12-week clinical pilot of Wulo at The Limi Hospital</h3></td>
</tr>
</table>

---

## Executive summary

**The problem.** Paediatric speech and post‑ENT rehabilitation outcomes at any hospital are limited less by what happens in the consultation room and more by what happens in the 167 hours a week the child is at home. Prescribed practice is inconsistently completed, parents have no structured way to report on it, and the clinician spends the first portion of the next visit reconstructing what happened rather than progressing the plan.

**The proposed solution.** Wulo is a clinician‑supervised digital practice tool. The Limi clinician prescribes the practice; the child completes short guided sessions at home on a phone or tablet; the clinician reviews a structured one‑screen summary before the next visit. Wulo does not diagnose, does not replace a clinician, and is not marketed to families independently.

**The proposal.** A tightly scoped 12‑week clinical pilot, 20–30 paediatric patients from Limi's existing caseload, run by a named Limi Clinical Lead, against pre‑agreed adherence and outcome thresholds. The pilot is designed to give Limi **decision‑grade evidence**, not a satisfaction report.

**What Limi gets.** An Evidence Pack Limi owns outright, no software fee during the pilot, and a credit mechanism that converts the implementation fee into a discount if Limi proceeds to an annual licence.

**What Limi must do.** Nominate one Clinical Lead (≈60 minutes/week) and one Admin Liaison, approve a DPIA, and confirm the cohort. No infrastructure work, no IT integration, no procurement of devices.

---

## What Wulo is (and isn't)

Wulo is a **digital prescription for practice**, used between visits. One loop:

1. **The clinician sets the path.** Selects target phonemes, words, or language goals from the Wulo library, or authors custom exercises for a specific child via the clinician dashboard.
2. **The child practises.** Short 3–5 minute guided sessions with a calm AI buddy. Audio prompts, visual cues, retries, word‑level pronunciation feedback. No reading ability is required; all instructions are spoken and illustrated.
3. **The parent has a clear, light role.** Plain‑English visibility into what was practised. Typical parent time: under 5 minutes per session to start the child off; no clinical interpretation required.
4. **The clinician reviews structured data.** Before the next visit, a one‑screen summary (e.g. *"Child struggled with /s/ blends in initial position; strong on final /k/; 8 of 12 prescribed sessions completed"*). No audio playback is required for the review.

**Wulo is not** a diagnostic tool, a replacement for a clinician, an unsupervised consumer app, or a screening service. It is a clinician‑led practice and review layer.

**Built on Microsoft Azure.** Live today at `sen.wulo.ai`.

### See it in 90 seconds

A short clinician walkthrough showing how to assign a target, the child practice flow, and the structured review screen:

**▶︎ Watch the Wulo clinician walkthrough:** [youtube.com/watch?v=EPKsGBDSeac](https://www.youtube.com/watch?v=EPKsGBDSeac&t=5s)

---

## Why Limi, why now: the operational case


- **Compliance is the binding constraint.** Limi's clinicians already write good plans. The pilot's primary purpose is to convert prescribed practice into evidenced practice and surface non‑compliance early.
- **Post‑ENT and post‑surgical follow‑through.** Paediatric speech difficulty at Limi is frequently caught downstream of hearing loss, adenoidectomy, tonsillectomy, grommets, or cleft repair. Today, a one‑off surgical episode often does not convert into a structured rehabilitation pathway. Wulo gives the ENT and paediatric service a way to retain the child in a defined recovery relationship after the procedure, with documented adherence, relevant to clinical outcomes and to retention into follow‑up visits.
- **Family‑centred operations.** Limi's positioning as a multispecialty group for the family is consistent with Wulo's design: the clinician leads, the parent supports lightly, the child practises in a calm format.
- **Low operational burden.** No device procurement, no integration with hospital systems, no extra clinic time. The pilot runs on the family's own phone or tablet. Limi's clinician workload is bounded at ≈60 minutes/week for the Clinical Lead and a one‑time onboarding session per family.

---

## Operational details

| Item | Detail |
|---|---|
| **Child device** | Any modern Android (Android 9+) or iOS (14+) phone or tablet with a working microphone. Tested on low‑end Android handsets. |
| **Parent device** | Same device; or a separate phone if the family prefers. The parent dashboard is web‑based. |
| **Clinician device** | Standard laptop or desktop with a modern browser (Chrome, Edge, Safari). No installation. |
| **Connectivity** | Works on 3G/4G/5G and Wi‑Fi. |
| **Languages (child‑facing prompts)** | English (Nigerian English accent supported). Yoruba, Hausa, and Igbo onboarding scripts available for the family‑facing screens on request; child practice prompts are in English in the pilot. |
| **Languages (parent materials)** | English by default. |
| **Clinician exercise authoring** | The clinician selects a target sound or word from the library. |
| **Pre‑built clinical content available today** | Articulation library (initial/medial/final position) for the main English consonants and consonant clusters; minimal‑pair sets; structured carryover word lists; post‑ENT rehabilitation starter packs (post‑grommet listening tasks, post‑adenoidectomy resonance tasks, post‑cleft articulation tasks).|
| **Support response times during the pilot** | Clinician‑facing issues: same business day. Family‑facing issues: within 24 hours. Critical outage: within 2 hours. Dedicated WhatsApp and email channel for the Limi team. |

---

## Clinical governance and data protection

This section is written to be reviewable by Limi's information governance and legal teams. Anything not specified here is open to negotiation in the pilot agreement.

- **Regulatory alignment.** Nigeria Data Protection Act (2023) and the NDPC General Application and Implementation Directive. A Data Protection Impact Assessment (DPIA) is shared with Limi within 5 working days of pilot agreement and signed by both parties before any patient is enrolled.
- **Controller / processor.** Limi is the **Data Controller** for all patient data. Neuter Labs Ltd (operator of Wulo) is the **Data Processor**, acting only on Limi's documented instructions. A signed Data Processing Agreement (DPA) accompanies the pilot agreement.
- **Hosting and data residency.** Patient‑identifiable records are stored in Microsoft Azure regions agreed with Limi at pilot start (default: UK South for the pilot). No data is sold, sub‑licensed, or shared with third parties.
- **Cross‑border transfer.** Any transfer of personal data outside Nigeria is performed under standard contractual safeguards documented in the DPA and disclosed in the consent form signed by the parent.
- **What is retained.** Structured practice data: phoneme accuracy scores, retry counts, completion timestamps, engagement metrics, clinician notes. Retention period during the pilot: duration of the pilot plus 90 days, after which Limi chooses deletion or migration to an adoption contract.
- **What is not retained.** Raw audio recordings of the child's voice are processed in‑memory for pronunciation scoring and discarded. No persistent audio of the child is stored by default. If Limi explicitly opts in to short‑clip retention (for clinician review of a specific case), retention is bounded to 30 days and is logged.
- **Use for model improvement.** Patient voice data is **not** used to train Wulo's models in the pilot. Aggregated, non‑identifying performance statistics (e.g. accuracy distributions per phoneme across the cohort) may be used for product improvement only with Limi's written consent.
- **Access controls.** Role‑based access. Limi clinicians see only patients in Limi's workspace. Neuter Labs engineering access to production is restricted, logged, and disclosed in the DPA.
- **Audit logging.** All clinician actions (assignment, override, review) and all administrative access are logged and exportable to Limi on request.
- **Incident response.** Any suspected data incident is reported to Limi's nominated DPO within 24 hours of discovery. A full written incident report is delivered within 72 hours, aligned to NDPA notification timelines.
- **Consent.** Aligned to Limi's existing paediatric consent process. Parental consent is captured before enrolment; child assent is captured where age‑appropriate. Parents may withdraw and request deletion at any time, with confirmed deletion within 30 days.
- **Safeguarding.** Wulo does not give clinical advice to families, does not screen, and does not assess. It delivers practice that the clinician has prescribed.

---

## Exercise authoring and IP

Any exercises Limi clinicians author in Wulo remain Limi's intellectual property. By default they are private to Limi's workspace. 

---

## Pilot framework

| Item | Detail |
|---|---|
| **Setting** | The Limi Children's Hospital |
| **Cohort size** | 20–30 children |
| **Ages** | 4–12 |
| **Inclusion criteria** | Active paediatric SLT, ENT, or paediatric caseload at Limi; functional hearing (aided or unaided) sufficient to engage with audio prompts; parent or carer with a smartphone and basic English. |
| **Primary leads** | 1 Clinical Lead (SLT, paediatrician, or ENT) + 1 Admin Liaison |
| **Phase 1 (Weeks 1–2)** | Onboarding, clinician training, baseline capture (see *Success metrics*), family enrolment |
| **Phase 2 (Weeks 3–10)** | Active practice, weekly clinician review, mid‑pilot calibration update |
| **Phase 3 (Weeks 11–12)** | Outcome measurement, family survey, Evidence Pack delivery |
| **Minimum cohort completion threshold** | At least 70% of enrolled children must complete Week 12 for the Evidence Pack to be treated as a primary result; below that, results are reported as exploratory. |

---

## Success metrics: the Evidence Pack

Each metric has a defined baseline method, a defined Week‑12 measurement, and a **pre‑agreed pass threshold**. The pilot is judged against Limi's own current numbers, not a generic benchmark.

| # | Metric | Baseline method (Week 1) | Week‑12 measurement | Pre‑agreed pass threshold |
|---|---|---|---|---|
| 1 | **Adherence** | Retrospective audit of the previous 8 weeks of case notes for the enrolled cohort: % of prescribed home‑practice tasks documented as completed. Where notes are silent, the case is counted as non‑adherent (conservative). | % of enrolled children completing ≥ 2 Wulo sessions per week for at least 8 of the 12 pilot weeks. | **≥ 60% of enrolled children** meet the adherence bar. |
| 2 | **Clinician time on reconstruction** | At pilot start, the Clinical Lead times the first segment of 10 consecutive paediatric consultations and records minutes spent on "what happened at home" reconstruction. | Same measurement protocol at Week 12 across at least 10 consultations in the enrolled cohort. | **≥ 30% reduction** in mean reconstruction time. |
| 3 | **Parental experience** | Pre‑pilot survey of enrolled families: NPS plus three structured questions on home‑practice clarity and confidence. | Same survey post‑pilot. | **Post‑pilot NPS ≥ +30** and improvement of ≥ 1 point on the structured clarity question. |
| 4 | **Speech progression** | Standardised clinician rating per enrolled child on a defined articulation/intelligibility scale (proposed: percentage of target phonemes produced correctly in single‑word probes, recorded at baseline by the Clinical Lead). Limi may substitute an equivalent standardised measure already in routine use. | Same measure, by the same clinician where possible. | **≥ 50% of enrolled children** show a clinically meaningful improvement as judged by the Clinical Lead against the baseline measurement protocol. |

**Go / no‑go rule.** The pilot is considered successful if **at least 3 of the 4 thresholds are met, and metric #1 (adherence) is one of them.** Adherence is treated as the binding outcome because every downstream metric depends on it. Anything else is reported as a partial result.

The Evidence Pack is Limi's, regardless of what Limi decides next. It can be used internally, in board reporting, or in publication.

---

## Investment and commitment

| Item | Amount |
|---|---|
| **Wulo software licence (12 weeks)** | **Waived (₦0)** |
| **Implementation & Onboarding Fee** *(one‑time)* | **₦450,000** |

**What the ₦450,000 covers and why it is charged before value is proven.** The fee covers bespoke work Wulo delivers *for Limi* during weeks 0–2, before any patient practice begins: clinician training, the DPIA and clinical safety review tailored to Limi, the Data Processing Agreement, family onboarding materials, and the dedicated support channel for the Limi team. This work has a real cost and we believe it is more honest to price it than to absorb it and recover it later in licence pricing.

**What the fee is not.** It is not a software charge; the software licence is waived. It is not a commitment to continue after Week 12. It does not include a Limi‑branded portal, which is an adoption‑phase deliverable.

**Fee credit if Limi proceeds.** If Limi signs an annual licence within 60 days of Week 12, the ₦450,000 implementation fee is credited in full against the first‑year licence. If Limi does not proceed, the fee is retained as payment for the work delivered. Limi keeps the Evidence Pack either way.

**On the indicative annual range.** The range below is provided so Limi's finance team can plan, not as a price anchor. Final pricing is proposed in writing **after** the pilot, on the basis of cohort size, clinician count, and which Limi services are in scope. The pilot is not used to justify a price increase; the upper end of the range applies only to the broadest configuration.

**Limi's commitment:**

- A Clinical Lead, ≈60 minutes/week, monitoring the cohort via the Wulo dashboard.
- An Admin Liaison for family onboarding and consent flow.
- A 60‑minute kickoff, a 30‑minute mid‑pilot review, and a 60‑minute close‑out.

---

## Beyond the pilot

Three options, Limi's choice:

- **Stop.** Limi keeps the Evidence Pack. No fees beyond the implementation fee already paid. No lock‑in.
- **Extend** the cohort at the Children's Hospital to 60–100 active children for a further 12 weeks on the same terms, and bring in adjacent Limi services (ENT outpatient, paediatric follow‑up).
- **Adopt** under an annual licence covering the Children's Hospital and any Limi service that sees paediatric patients. At adoption, Wulo configures a Limi‑branded portal as standard. **Indicative annual range: ₦4.5M – ₦7.5M**, subject to cohort size, clinician count, and the services in scope. Pilot implementation fee credited as above. Final pricing proposed in writing after Week 12.

---

## About Wulo

Wulo is a clinician‑supervised digital practice tool for paediatric speech and language rehabilitation. Live at `sen.wulo.ai`, deployed on Microsoft Azure, and currently onboarding clinical pilot partners in the UK and Nigeria. Wulo is operated by Neuter Labs Ltd (UK).

---

## Next step

A short decision rather than a meeting. To start within three weeks, Limi confirms four things in writing:

1. **Clinical sponsor:** the name of the Clinical Lead and the Admin Liaison.
2. **Cohort:** indicative size (20–30) and the services contributing patients (paediatric SLT, ENT, paediatrics).
3. **Pilot agreement:** countersignature of the short pilot agreement, DPA, and DPIA scope.
4. **Start date:** proposed Week 1 date.

A 30‑minute call with the Medical Director or nominated lead is available if useful, but is not required to begin.

---

*Prepared by the Wulo team (Neuter Labs Ltd). Non‑binding. Contains no confidential patient data.*
