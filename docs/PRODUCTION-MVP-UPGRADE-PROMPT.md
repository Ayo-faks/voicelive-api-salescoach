# Production-Grade MVP Upgrade Prompt

Using the analysis of the `voicelive-api-salescoach` (SpeakBright) codebase established in this conversation as the baseline, generate a detailed **Production-Grade MVP Upgrade Plan** that explains how to evolve the app from its current prototype state into a secure, production-ready MVP.

The document must be grounded in the actual codebase and should cover both **functional maturity** and **security-by-design**, with the explicit principle that **security is shifted left**: security requirements, controls, testing, and verification must be introduced during design and development, not deferred until release.

For every section below, include:

1. **Current state / gap**
2. **Target production-grade MVP state**
3. **Concrete implementation steps**
4. **Security implications and controls**
5. **Verification / test strategy**
6. **Priority**: `P0` (blocks production), `P1` (required for MVP), `P2` (important but deferrable)

---

## 1. Product Scope and MVP Definition

- Define what a realistic production-grade MVP means for this application
- Separate what must be delivered now versus what can wait until post-MVP
- Identify the minimum viable set of capabilities for:
  - therapist-guided speech sessions
  - child profile support
  - exercise selection
  - session evaluation
  - therapist review
- Include non-functional MVP requirements:
  - availability
  - latency
  - privacy
  - auditability
  - recovery from failure

## 2. Agent Architecture and Research-Grade Patterns

- Assess the current agent model, which is primarily a prompt plus runtime config
- Propose a better production architecture using standard agent design patterns:
  - persona layer
  - teaching strategy layer
  - session-context layer
  - tool/memory access layer
- Distinguish clearly between:
  - real-time conversational agent
  - evaluator agent
  - pronunciation scoring service
- Recommend the right model per workload:
  - low-latency model for the real-time child-facing agent
  - reasoning-capable model for post-session evaluation
- Address durable agent identity, lifecycle, and registry design
- Replace or redesign the in-memory agent state pattern so it works across restarts and horizontal scaling

## 3. Memory Architecture

- Describe how to move from stateless sessions to a production-safe memory architecture
- Cover:
  - working memory for the current session
  - episodic memory from prior sessions
  - semantic memory for child profile and preferences
- Define what data should and should not be stored
- Explain how memory should be retrieved and injected into prompts safely
- Address privacy boundaries and retention rules for child-specific data
- Propose schemas or storage patterns for:
  - child profile
  - session summary memory
  - therapist notes
  - preference signals
- Explain how to avoid over-personalization, prompt bloat, and unsafe leakage of sensitive information

## 4. Evaluation, Harness, and Quality Gates

- Analyze the current evaluation flow:
  - LLM-based transcript scoring
  - Azure Speech pronunciation scoring
  - prompt YAML `testData` and `evaluators`
- Design a production evaluation system that includes:
  - prompt harness execution
  - automated regression tests for prompts
  - structured scoring validation
  - calibration against therapist feedback
  - longitudinal quality tracking per child
- Recommend whether evaluation should become a two-stage pipeline:
  - reasoning stage
  - structured scoring/output stage
- Explain how to test both:
  - child outcome quality
  - pedagogical quality of the conversational agent
- Define CI/CD quality gates so prompt, scoring, and model changes cannot silently degrade the app

## 5. Security-First MVP Design

- Treat security as a design-time and development-time concern, not a release checklist
- Produce a **shift-left security plan** covering:
  - threat modeling
  - secure defaults
  - dependency and supply chain controls
  - secret management
  - secure prompt and model usage
  - data minimization
  - logging and telemetry safety
  - abuse prevention
- Identify the highest-risk assets and trust boundaries in this app:
  - child data
  - therapist data
  - transcripts
  - audio
  - prompts
  - API keys and Azure credentials
  - session history
- Define concrete controls for:
  - secret storage using managed identity / Key Vault instead of static secrets where possible
  - encryption at rest and in transit
  - least-privilege access
  - secure handling of prompt inputs and user-generated data
  - secure WebSocket usage
  - rate limiting and abuse controls
  - replay resistance and session validation
  - audit logging
- Include application security testing recommendations:
  - SAST
  - dependency scanning
  - IaC scanning
  - secret scanning
  - DAST / API testing
  - prompt-injection and abuse-case testing
- Explain how these controls should be introduced early in local development, CI, staging, and production

## 6. Authentication, Authorization, and Identity

- Analyze the current `X-Therapist-Pin` approach and explain why it is insufficient for production
- Design a proper identity model for:
  - therapists
  - admins
  - system/service identities
- Recommend a production-grade auth strategy suitable for the Azure footprint, such as:
  - Microsoft Entra ID
  - JWT-based application auth
  - short-lived tokens with refresh flow
- Define authorization boundaries for:
  - child profile access
  - session history
  - feedback submission
  - admin functions
  - configuration endpoints
- Include least-privilege and role-based access design
- Explain how authn/authz should be enforced consistently at middleware, route, and service layers

## 7. API Hardening and Platform Configuration

- Analyze the current API surface and recommend production-safe improvements for:
  - CORS
  - API versioning
  - security headers
  - CSRF considerations where relevant
  - rate limiting
  - request size limits
  - timeout policy
  - input validation
  - error handling
  - logging hygiene
- Redesign RPC-like endpoints into a clearer production API shape where appropriate
- Cover both REST and WebSocket hardening requirements
- Explain how to secure configuration and environment management across local, staging, and production

## 8. Data Architecture and Persistence

- Evaluate the current SQLite-based design and explain its production limitations
- Recommend a production data architecture for:
  - transactional data
  - memory data
  - evaluation records
  - audit trails
- Include migration strategy:
  - schema versioning
  - migration tooling
  - backup and restore
  - retention and deletion policies
- Explicitly address privacy and compliance implications of storing:
  - transcripts
  - therapist notes
  - pronunciation results
  - child-related identifiers

## 9. Azure Production Architecture

- Explain how to move the app to production using Azure-native patterns
- Cover:
  - Azure AI Agent Service usage
  - managed identity
  - Key Vault
  - Azure Database / durable storage
  - App Service or Container Apps
  - Application Insights / Azure Monitor
  - network boundaries and private access where appropriate
- Address the gap between Azure-hosted agent state and the current in-memory backend state
- Recommend a deployable target architecture for MVP, not an overbuilt enterprise architecture

## 10. Delivery Pipeline and Shift-Left Controls

- Design a delivery workflow that enforces quality and security before production
- Include:
  - branch protections
  - PR checks
  - automated tests
  - prompt harness tests
  - security scans
  - IaC validation
  - environment promotion strategy
- Define what must pass before merge and before deploy
- Show how the team can catch:
  - auth regressions
  - prompt regressions
  - dependency vulnerabilities
  - insecure configuration
  - model/prompt drift

## 11. Execution Roadmap

- End with a phased implementation plan:
  - **Phase 0**: immediate production blockers
  - **Phase 1**: secure MVP foundations
  - **Phase 2**: agent and memory upgrades
  - **Phase 3**: evaluation maturity and operational hardening
- For each phase, list:
  - objectives
  - concrete deliverables
  - dependencies
  - measurable completion criteria
- Make clear which items are mandatory before any real user rollout

---

## Important Requirements for the Document

- Base all recommendations on the actual current codebase and issues identified in this conversation
- Do not produce generic SaaS advice detached from the app
- Explicitly call out where the current implementation is unsafe, non-scalable, or not production-ready
- Prioritize secure defaults and shift-left security practices throughout the architecture, developer workflow, and release process
- Optimize for a practical MVP path: enough rigor for real users, without turning the plan into a full enterprise transformation program