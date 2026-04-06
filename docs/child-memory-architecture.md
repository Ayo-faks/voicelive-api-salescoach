# Child Memory Architecture

Date: 2026-04-05

## Purpose

This document captures the current memory architecture in the speech therapy platform, the main limitations of that design, and a proposed production-grade child memory architecture discussed during architecture review.

The central design shift is this:

- The current system mostly stores events and re-reads them.
- The proposed system stores events, synthesizes durable knowledge from them, and writes the useful parts back into an inspectable child knowledge layer.

This moves the platform from session-aware behavior toward durable, longitudinal, explainable personalization.

## Executive Summary

The current platform already persists meaningful raw history: child records, sessions, transcripts, AI assessments, pronunciation assessments, therapist feedback, and next-session plans. That is a solid event-memory foundation.

What it does not yet have is a first-class semantic memory layer for each child. There is no durable child-level knowledge artifact that captures things like effective cues, likely preferences, persistent blockers, progression patterns, or therapist-approved guidance in a form that future agents can read directly.

The recommended production direction is a layered memory architecture:

- Event memory for immutable session facts
- Semantic child memory for curated durable knowledge
- Retrieval summaries and indexes for planners and recommenders
- Review and governance workflows for safe write-back

This design is cheaper, more scalable, and more inspectable than relying on larger prompts or repeatedly loading raw history into shared agent context.

## Current Memory Architecture

### What exists today

The current system persists data in SQLite and supports restore/backup through blob storage bootstrapping.

Current durable records include:

- Child identities
- Exercises and exercise metadata
- Completed sessions
- Transcripts and reference text
- AI assessment results
- Pronunciation assessment results
- Therapist feedback on sessions
- Practice plans and plan revisions

### Architectural shape

The current architecture is best described as event persistence plus planner retrieval.

1. A live session runs with the practice agent.
2. The session is analyzed after completion.
3. The system stores the resulting session data.
4. The therapist planner reads one source session plus recent session history.
5. The planner proposes a next-session plan.

### Strengths of the current design

- Durable history already exists.
- Session review is possible.
- The planner can use recent history rather than only the current turn.
- Raw evidence is retained for audit and review.
- The current design is simple enough to operate and debug.

### Current limitations

The current system stores events, not durable child understanding.

Examples of what is missing as first-class memory:

- Stable child preferences
- Therapist-confirmed effective cueing strategies
- Repeatedly observed ineffective strategies
- Progression by target sound or exercise type
- Explicit distinction between observation and inference
- Confidence and freshness on remembered facts
- Durable explanation layer for why an exercise is recommended

### Current product consequence

The platform is session-aware but not truly memory-aware.

It can remember:

- The last exercise
- The last assessment
- Recent sessions
- Previously generated plans

But it does not yet maintain a living child knowledge base that compounds over time.

## Current Problems

### 1. Raw history is not the same as usable memory

Storing transcripts and assessment JSON is necessary, but raw records are expensive and noisy to reason over repeatedly. A planner or agent should not need to reconstruct the child model from scratch every time.

### 2. No durable semantic child model

There is no canonical place where the system can say:

- what it currently believes about this child
- why it believes it
- which beliefs are therapist-confirmed
- which beliefs are weak inferences

### 3. Limited inspectability for adaptive behavior

Without a child knowledge layer, recommendations are harder to audit. If a therapist asks why a specific exercise was recommended, the answer is derived indirectly from raw history instead of directly from maintained child knowledge.

### 4. Personalization does not compound cleanly

The current system can use recent sessions, but it does not turn repeated evidence into durable operational knowledge. That means personalization is more transient than it should be.

### 5. Shared context does not scale well

If the system leans too hard on prompt context instead of durable memory artifacts, it becomes more expensive, less inspectable, and harder to keep consistent as history grows.

## Design Insight

The key architectural insight is that the model should not be treated as the memory.

The durable memory should live in files, tables, summaries, and indexes that the model can read, refine, and update over time. In other words:

- The database stores event truth.
- The memory layer stores semantic understanding.
- The model acts as a compiler, editor, and retrieval consumer over that understanding.

This is the compounding loop:

1. Capture raw events
2. Synthesize useful knowledge
3. Write back durable summaries or memory items
4. Reuse those summaries in future planning and recommendation
5. Improve them again after each new session

## Proposed Production Memory Architecture

### Goals

The target architecture should:

- Preserve raw evidence
- Build durable child knowledge
- Support safe write-back
- Be inspectable by therapists
- Scale without requiring giant prompts
- Support longitudinal recommendation and explanation

### Layer 1: Event Memory

This is the immutable source of truth.

It should contain:

- Session events
- Assessment artifacts
- Pronunciation scoring artifacts
- Therapist feedback
- Generated plans
- Recommendation outputs
- Outcome data from later sessions

Properties:

- Append-only where practical
- Auditable
- Source-linked
- Never silently rewritten

### Layer 2: Semantic Child Memory

This is the core missing layer.

Each child should have durable memory items such as:

- Current targets
- Effective cues
- Ineffective cues
- Observed preferences
- Exercise response patterns
- Mastery signals
- Persistent blockers
- Therapist constraints
- Carryover notes
- Open questions for therapist confirmation

Every memory item should carry:

- Category
- Statement
- Memory type: fact, inference, recommendation, or constraint
- Confidence
- Status
- Provenance links
- Freshness or expiry rules
- Author type: system or therapist

### Layer 3: Review and Governance

Not all synthesized memory should become durable automatically.

The system should support proposals and review states such as:

- Pending
- Approved
- Rejected
- Superseded
- Expired
- Disputed

This layer keeps the system safe in a therapist-supervised environment.

### Layer 4: Summary and Retrieval Layer

Agents should read compact child summaries first, not full history.

The retrieval layer should maintain:

- Child summary markdown for human inspection
- Child summary JSON for machine consumption
- Fast indexes by child, category, target sound, recency, and review state
- Source links back to raw evidence

### Layer 5: Recommendation and Planning Layer

The recommender and planner should consume:

- Child profile
- Active child memory items
- Recent summaries
- Latest source session
- Therapist-authored constraints

They should not rely on loading the full session archive by default.

## Proposed Minimal V1

A minimal V1 does not need a full wiki system.

The smallest useful implementation is:

- Keep the existing session persistence
- Add a child memory summary artifact
- Add memory update proposals after each session
- Require review for higher-risk updates
- Make the planner read the child memory summary before raw history

This V1 is valuable because it immediately improves planning quality and explanation quality without introducing excessive complexity.

## Advantages of the Proposed Architecture

### 1. Better personalization

The system can use durable child knowledge rather than relying only on recent session retrieval.

### 2. Lower prompt cost

Agents read compact summaries and expand only when needed.

### 3. Better inspectability

Therapists can inspect what the system believes, where the belief came from, and whether it was therapist-confirmed.

### 4. Better safety

Separating observation, inference, recommendation, and therapist instruction reduces the risk of overclaiming or preserving bad assumptions.

### 5. Better longitudinal behavior

The system can compound useful knowledge over time rather than repeatedly reconstructing the child model from raw logs.

### 6. Better operational scalability

This design scales through storage, summaries, and indexes, not by stuffing more context into every inference.

## Tradeoffs

### 1. More architecture

The proposed system is materially more complex than plain session storage.

### 2. Governance overhead

Safe memory write-back requires review rules, approval states, and provenance handling.

### 3. Summary drift risk

If write-back is weakly governed, the child summary may drift away from the evidence.

### 4. Dual data model overhead

The system must maintain both raw evidence and summarized memory.

### 5. Additional product work

Therapist review and correction interfaces are needed if memory is going to be clinically meaningful and trusted.

## Write-Back Policy

### Principle

Raw events are always written. Durable semantic memory is written selectively.

### Safe to auto-write

Examples:

- Last completed exercise
- Last session time
- Latest target sound practiced
- Session digest
- Recommendation output record
- Low-risk operational summaries

### Should be proposed for review first

Examples:

- Child prefers a specific exercise style
- A cue appears effective across repeated sessions
- A strategy appears ineffective
- Difficulty should increase
- A mastery trend appears to be emerging

### Should not be autonomously written as durable memory

Examples:

- Diagnostic conclusions
- Developmental labels
- Strong personality claims
- Permanent preference claims from one session
- High-impact mastery claims without therapist confirmation

### Required metadata for durable memory

Every durable memory item should include:

- confidence
- provenance
- review state
- timestamps
- writer identity
- evidence references

## API and Data Model Direction

The implementation direction should support three main operations:

- Read memory
- Propose or write memory
- Review or govern memory

Recommended logical artifacts include:

- child profiles
- child memory items
- child memory proposals
- child memory evidence links
- child memory summaries
- recommendation logs

## Do We Need a Graph Database

Short answer: no, not initially.

The primary problem is not deep relationship traversal. The primary problem is safe synthesis, durable summaries, provenance, and explainable retrieval.

A relational database plus structured summaries is the right first production design.

### Why relational first

- Most queries are scoped by child, category, time, status, and evidence
- Approval and governance workflows are row-oriented
- Auditability is easier
- Operational complexity stays lower

### When a graph layer may become useful

Introduce a graph layer later only if the system grows into a dense institutional knowledge network requiring multi-hop reasoning across:

- children
- targets
- interventions
- exercise families
- therapists
- outcomes

That is a later-stage optimization, not a current requirement.

## Recommended Rollout

1. Add child memory summaries and memory proposals on top of the current session store.
2. Make the therapist planner read those summaries before reading raw session history.
3. Add therapist review and correction workflows.
4. Add deterministic recommendation ranking using approved child memory.
5. Add clinic-level de-identified institutional memory later.

## Decision Test

The new architecture is working if the system can answer these questions clearly:

- What do we currently believe about this child?
- Which beliefs are therapist-confirmed?
- Why was this exercise recommended?
- Which sessions support that recommendation?
- What new evidence would change the recommendation?

If the system cannot answer those questions cleanly, it is still relying too much on raw history or prompt context rather than a true knowledge layer.

## Conclusion

The existing architecture provides a solid event-memory foundation but not yet a production-grade child memory system.

The proposed architecture adds a semantic memory layer, safe write-back, provenance, and review. That is what enables durable personalization, compounding institutional knowledge, and explainable therapist-supervised recommendations.

The most important shift is conceptual:

- Current design: remember events and retrieve them
- Proposed design: remember events, distill them into knowledge, govern that knowledge, and reuse it intentionally

That shift is what turns the platform from a session-aware assistant into a longitudinal therapy memory system.