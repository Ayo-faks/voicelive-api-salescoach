# Wulo — UK Investor Narrative & Agile Funding Strategy

> **Company:** Wulo (sen.wulo.ai)
> **Jurisdiction:** UK Ltd
> **Sector:** EdTech / HealthTech / SEN
> **Stage:** Pre-seed
> **Location:** United Kingdom

---

## The Opportunity in One Paragraph

Two million children in the UK struggle with speech and language. Over 65,000 are on NHS waiting lists, nearly half waiting more than 12 weeks. The SLT workforce has a 21% vacancy rate. The system cannot hire its way out of this crisis. Wulo is a therapist-supervised AI practice platform that scales the most constrained resource in paediatric speech therapy — the time between sessions — without replacing the therapist. It gives children guided, real-time voice practice with pronunciation feedback, gives parents visibility, and gives therapists structured review. The product is live, deployed on Azure, and ready for its first paid cohorts.

---

## Why Now

### 1. NHS is actively seeking scalable practice tools
NHS England commissioned RCSLT and NHS Elect in 2025 to build a Transformation Toolkit specifically for reducing children's SALT waiting times. Seven regional improvement collaboratives are running pilots through April 2026. The system is signalling demand for exactly what Wulo provides.

### 2. Post-COVID speech delay surge has not resolved
67% of primary teachers report children behind on language development as a result of COVID (Speech and Language UK, 2023). 76% of schools surveyed said 2020 intake needed more support than previous years. This cohort is now in Key Stage 2 and the backlog has compounded.

### 3. AI voice technology has crossed the quality threshold
Real-time AI voice interaction, pronunciation scoring, and structured speech exercises are now possible at consumer-grade latency and cost. Two years ago, this required a research lab. Today Wulo runs it in a browser on Azure with sub-second response times.

### 4. Regulatory and buyer readiness
The UK education and health systems are increasingly open to supervised digital tools — not as replacement for therapists, but as practice multipliers. Ofsted's revised framework places greater emphasis on inclusion and SEND provision. Schools need tools, not just therapist hours.

---

## What Wulo Does

| For | Wulo provides |
|-----|---------------|
| **Children** | A calm, child-friendly AI "practice buddy" that runs guided voice exercises with short prompts, retries, and encouraging feedback |
| **Therapists** | Exercise authoring (target sounds, words, difficulty), structured session review (articulation, engagement, pronunciation), saved progress per child |
| **Parents** | Visibility into what their child practised and how they did, without needing clinical expertise |
| **Schools** | Structured practice for children on waiting lists or between SLT sessions, with SENCO-level reporting |
| **Local Authorities / NHS** | Scalable, non-diagnostic practice for waiting-list cohorts, with outcome data for commissioning |

### Technical Differentiation
- **Real-time AI voice buddy** — not pre-recorded prompts or text-based drills
- **Azure Speech pronunciation scoring** — word-level feedback on articulation
- **Therapist-authored exercises** — clinician controls targets, sounds, difficulty
- **WebRTC avatar** — engaging visual presence for children
- **Session review dashboard** — therapist reviews practice without listening to full recordings

---

## Market Size (UK)

| Segment | Size | Wulo revenue potential |
|---------|------|-----------------------|
| Independent paediatric SLTs | ~5,000 in private practice (ASLTIP + RCSLT) | £2.9M ARR at 100% penetration, £49/mo |
| SEND / special schools | ~1,500 special schools + ~4,000 mainstream schools with SEND units | £16M ARR at 20% penetration, £4,000/yr |
| Local authorities (152 in England) | SALT commissioning budgets | £3.8M ARR at 25% penetration, £100K avg contract |
| NHS community providers | ~150 in-scope providers | Overlaps with LA budgets |

**Serviceable addressable market (Year 1–3):** £5–10M ARR across therapists and schools.
**Long-term UK TAM:** £20M+ ARR including LA/NHS.

> International expansion (Ireland, Australia, Canada, US) is a later-stage play. UK-first.

---

## Business Model

### Revenue model
SaaS subscription — per-therapist, per-school, or per-cohort.

### Unit economics target (Month 12)
| Metric | Target |
|--------|--------|
| Therapist ARPU | £49/mo (£588/yr) |
| School ARPU | £4,000/yr |
| Gross margin | >80% (Azure compute is the primary COGS) |
| Therapist CAC | <£100 (organic + referral) |
| School CAC | <£500 (outbound + events) |
| Payback period | <3 months (therapist), <1 term (school) |

### Path to £100K ARR
| Milestone | When | Revenue |
|-----------|------|---------|
| 10 paid therapists @ £49/mo | Month 3 | £490/mo |
| 30 paid therapists + 3 school pilots | Month 5 | £2,970/mo |
| 50 therapists + 5 schools + 1 LA pilot | Month 8 | £8,350/mo = £100K ARR |

---

## Competitive Landscape

Full matrix in [WULO-COMPETITOR-MATRIX.md](WULO-COMPETITOR-MATRIX.md). Summary:

| Competitor | What they are | Why Wulo is different |
|------------|---------------|----------------------|
| **Mable Therapy** | Online SLT marketplace for LAs/NHS | Mable delivers live sessions (scales linearly). Wulo scales practice (scales with AI). Complementary, not head-to-head. |
| **SuperPenguin** | Caregiver guidance app for NHS pathways | Guidance, not real-time practice. No pronunciation scoring. Narrow scope (stammering, limited areas). |
| **BetterSpeech** | US teletherapy marketplace | US-only, insurance model. No UK presence, no between-session practice tool. |
| **Speech Blubs** | Consumer speech app (10M+ downloads) | No therapist oversight, no clinical workflow, no UK focus. Consumer, not clinical. |
| **Speech Therapy App UK** | Simple UK articulation drill app | Static drills, no AI, no therapist dashboard, no school/LA play. |

**Wulo's unique position:** Only UK platform combining real-time AI voice practice + therapist-directed exercises + pronunciation scoring + structured review.

---

## Traction & Status

| Item | Status |
|------|--------|
| Product | Live at sen.wulo.ai |
| Auth | Google + Microsoft Entra ID (dual-provider) |
| Data persistence | Azure File Share + SQLite |
| Infrastructure | Azure Container Apps, Azure AI Foundry, Azure Speech |
| Built-in exercises | 10+ (phoneme isolation, minimal pairs, blending, silent sorting, guided story) |
| Therapist exercise authoring | Supported |
| Pronunciation feedback | Azure Speech word-level scoring |
| Session review | Saved sessions with therapist notes |
| Domain | sen.wulo.ai |

**Next milestones:**
1. 10 design-partner therapists (Month 1–2)
2. First paid subscriptions (Month 3)
3. First school pilots (Month 4)
4. 100+ active children with outcome data (Month 5)

---

## Team

> [Fill in: founder background, clinical advisors, technical team]

Key hires needed in next 6 months:
- **Part-time clinical advisor** (HCPC-registered SLT) — credibility, content, governance
- **Growth/partnerships lead** — therapist and school outreach

---

## Agile Funding Strategy

### Why agile funding fits Wulo

Wulo is an AI product where velocity creates value. A 2-person team can ship a feature, sign a pilot, and double the product's credibility in the time it takes a traditional VC to schedule a second partner meeting. Raising in milestone-linked tranches lets Wulo:

1. Capture value in real time as milestones de-risk the business
2. Avoid a 3–6 month fundraising pause that kills momentum
3. Reward early believers with a lower valuation
4. Keep the team focused on product and customers, not pitch decks

### UK-specific funding instruments

In the UK, the instrument matters because of SEIS/EIS. US-style SAFEs generally do **not** qualify for SEIS/EIS relief (Bird & Bird, Oct 2025). UK angel investors overwhelmingly prefer structures that preserve their tax benefits.

| Instrument | SEIS/EIS eligible | Best for |
|------------|-------------------|----------|
| **ASA (Advance Subscription Agreement)** | Yes (if no repayment, no interest, converts within 6 months) | UK angel rounds |
| **SAFE** | No | US/international investors who don't need UK tax relief |
| **Convertible Loan Note (CLN)** | Generally no | Bridge rounds, institutional investors |
| **Priced equity round** | Yes | Larger rounds with a lead investor |

**Recommendation:** Use ASAs for UK angel tranches to preserve SEIS/EIS. Use SAFEs only for international investors who don't need UK tax relief. Get SEIS Advance Assurance from HMRC before raising.

### Tranche plan

#### Tranche 1 — Prove Therapist Wedge
| Item | Detail |
|------|--------|
| **Amount** | £75K–£150K |
| **Instrument** | ASA (SEIS-eligible) |
| **Valuation cap** | £1M–£1.5M pre-money |
| **Milestone to unlock Tranche 2** | 10+ paid therapists, 50+ active children, measurable adherence data |
| **Use of funds** | Clinical advisor, growth outreach, Azure costs, founder runway |
| **Timeline** | Month 0–3 |

#### Tranche 2 — Prove School Wedge
| Item | Detail |
|------|--------|
| **Amount** | £150K–£300K |
| **Instrument** | ASA (EIS-eligible) or priced seed round |
| **Valuation cap** | £2M–£3M pre-money (justified by therapist + school traction) |
| **Milestone to unlock Tranche 3** | 3+ school pilots, 1 case study, 100+ active children, procurement readiness |
| **Use of funds** | First hire (growth/partnerships), school pilots, governance pack, content |
| **Timeline** | Month 3–6 |

#### Tranche 3 — Prove Institutional Credibility
| Item | Detail |
|------|--------|
| **Amount** | £300K–£500K |
| **Instrument** | Priced seed round with lead |
| **Valuation** | £4M–£6M pre-money (justified by school renewals + LA pipeline) |
| **Milestone** | 1+ LA/NHS pilot, £100K+ ARR trajectory, strong retention |
| **Use of funds** | Team (2–3 hires), LA/NHS sales, product expansion, compliance |
| **Timeline** | Month 6–12 |

### Investor profile

| Tranche | Ideal investor type | Why |
|---------|---------------------|-----|
| 1 | UK angels, angel syndicates (SEIS) | Quick decisions, SEIS incentive, mission-aligned |
| 2 | EdTech/HealthTech angels, small funds (EIS) | Sector expertise, school/NHS network |
| 3 | Seed VC with EdTech or HealthTech thesis | Lead round, board seat, institutional credibility |

### Target UK investors & syndicates to approach

| Name | Type | Relevance |
|------|------|-----------|
| Zinc VC | Impact VC | Social impact, health/education thesis |
| Founders Factory | Accelerator + fund | EdTech vertical |
| Emerge Education | EdTech VC | Specialist EdTech seed fund |
| Ada Ventures | Seed fund | Underserved markets, impact |
| Bethnal Green Ventures | Impact accelerator | Tech for good |
| SFC Capital | SEIS fund | High-volume SEIS deals |
| Haatch | SEIS/EIS angel syndicate | Early-stage, UK-focused |
| Angel Academe | Angel network | Diverse founders, impact |
| Cambridge Angels | Angel network | Deep-tech, health |
| UK Business Angels Association (UKBAA) | Network | Access to syndicate deal flow |

### SEIS/EIS mechanics for Wulo

- **SEIS:** Investors get up to 50% income tax relief on up to £200K/yr. Company can raise up to £250K under SEIS (gross limit £350K).
- **EIS:** Investors get 30% income tax relief. Company can raise up to £5M/yr (up to £12M lifetime).
- **Capital Gains Tax exemption** on SEIS/EIS shares held 3+ years.
- **Loss relief** if the investment fails — investor can offset against income tax.
- **Advance Assurance:** Apply to HMRC before raising. Gives investors confidence. Takes 4–6 weeks.

> **Action item:** Apply for SEIS Advance Assurance in Month 1. This is a prerequisite for approaching UK angels.

---

## The Ask

### For Tranche 1 investors

> Wulo is raising £75K–£150K on SEIS-eligible ASAs to prove that therapists will adopt AI-guided speech practice for children. The product is live. The market is acute — 65,000 children on waiting lists, 21% SLT vacancy rate, and the NHS actively commissioning tools to reduce wait times. We need 3 months to put 50 children through guided practice with 10 therapists and prove adherence, engagement, and therapist efficiency gains. Your SEIS relief means a £50K investment costs you £25K after tax relief, with CGT exemption if Wulo succeeds.

---

## Summary

| Question | Answer |
|----------|--------|
| What is Wulo? | Therapist-supervised AI speech practice for children |
| Why now? | NHS waiting-list crisis, post-COVID speech delays, AI voice technology maturity |
| Who buys? | SLTs → schools → local authorities/NHS |
| How does it make money? | SaaS subscription (per-therapist, per-school, per-cohort) |
| What's the moat? | Therapist trust + product data + clinical workflow integration |
| How much are you raising? | £75K–£150K now (Tranche 1), up to £500K over 12 months |
| What instrument? | ASA (SEIS) for UK angels |
| What's the milestone? | 10 paid therapists, 50+ active children, measurable outcomes |
| When does the money run out? | It doesn't — agile tranches unlock as milestones hit |
