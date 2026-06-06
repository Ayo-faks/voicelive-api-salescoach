# Safeguarding escalation runbook (learner + therapist paths)

Operational runbook for responding to safeguarding alerts raised by the layered
detection pipeline (L1 deterministic lexicon → L2 Azure Content Safety → L3 LLM
classifier). It covers **both** the therapist/coach realtime path and the
**learner voice path** (`/ws/learning-voice`), which now screens every inbound
learner utterance and outbound tutor reply.

This runbook is for the **on-call operator / Designated Safeguarding Lead (DSL)**.
It does not change product behaviour — it tells a human what to do when an alert
fires.

---

## 1. How an alert reaches you

Both paths call `SafeguardingService.process_utterance(...)` fire-and-forget, so
detection never blocks or crashes a child's session. When an utterance trips the
pipeline, an event is written to `safeguarding_events` and the notifier fans out
per the severity matrix below.

| Severity | In-app banner | Admin email | Admin SMS | Parent / guardian email |
| -------- | :-----------: | :---------: | :-------: | :---------------------: |
| critical | ✅ | ✅ | ✅ | ✅ |
| high     | ✅ | ✅ |    | ✅ |
| medium   | ✅ |    |    |    |
| low      | ✅ |    |    |    |

- **Learner path specifics.** The learner is their own `parent_user_id`. The
  parent-email resolver redirects **minors** (and unknown-age self-learners, fail
  safe) to the **registered guardian email**, never to the child's own inbox. If
  no guardian email is on file, the parent channel is skipped but the **admin
  backstop still fires** so nothing is silently dropped.
- **Therapist path specifics.** A `critical` verdict (either direction) also
  halts the live session server-side and shows the avatar handoff line.

---

## 2. Triage (first 15 minutes)

1. **Open the admin safeguarding queue** (in-app banner → safeguarding list).
2. **Read the event**: severity, KCSIE categories, evidence quote, direction
   (inbound = the child disclosed; outbound = the model produced unsafe content),
   and the short context window.
3. **Classify the real-world risk**:
   - *Acute risk to life / immediate danger* → treat as **critical** regardless of
     the model's severity. Escalate externally now (section 3).
   - *Disclosure of harm / abuse / unsafe home* → DSL safeguarding process.
   - *Outbound model harm* → contain (section 4) and file an engineering incident.
4. **Acknowledge the event** in the admin UI with the action taken and notes so the
   audit trail records who handled it and when.

---

## 3. Escalation paths

> Fill in the bracketed destinations for your deployment before go-live.

- **Acute / life-threatening** (self-harm with intent/plan, ongoing abuse):
  follow local emergency procedure — **[emergency services / 999]** and the
  organisation's **[DSL name + phone]**.
- **Child protection disclosure** (non-acute): notify the **[DSL / safeguarding
  officer]** within **[X hours]** and record per the organisation's child
  protection policy.
- **Account guardian**: the guardian email is sent automatically for `high` /
  `critical`. If it was skipped (no guardian on file), contact the guardian via
  **[fallback contact channel]** and add a guardian email to the learner profile.
- **Engineering** (for outbound model harm or detector faults): raise an incident
  in **[tracker]** tagged `safeguarding`.

---

## 4. Containment levers (environment flags)

| Flag | Effect | When to use |
| ---- | ------ | ----------- |
| `LEARNER_VOICE_SAFEGUARDING_ENABLED` | Learner-path screening (default **on**) | Leave on. Only set `0` for a controlled diagnostic, with DSL sign-off. |
| `SAFEGUARDING_SHADOW_MODE=1` | In-app only; no outbound email/SMS — operator reviews the queue first | New deployment / tuning the lexicon; reduces false-positive parent emails while still capturing events. |
| `SAFEGUARDING_NOTIFICATIONS_DISABLED=1` | Suppresses **all** outbound notifications | Emergency stop on a notifier misfire only. Events are still recorded. |

Notification destinations: `ADMIN_EMAIL`, `ADMIN_SMS_TO` (+ `TWILIO_ACCOUNT_SID` /
`TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`), and the per-account guardian email
resolved from the learner profile.

---

## 5. After action

- Confirm the event is **acknowledged** with action + notes (audit requirement).
- If it was a **false positive**, note the phrase so the lexicon / classifier can
  be tuned (see `docs/lexicon-rotation.md`).
- If it was a **true positive**, confirm the external escalation was completed and
  the guardian was reached.
- For any **missed** disclosure (a harm the pipeline did not catch), file an
  engineering incident with the transcript so detection can be improved.

---

## 6. Verifying the learner path is live

- `LEARNER_VOICE_SAFEGUARDING_ENABLED` is unset or truthy (default on).
- The safeguarding service initialised at boot (`Safeguarding service: initialised`).
- A test inbound phrase on `/ws/learning-voice` produces a `safeguarding_events`
  row and an in-app alert (use `SAFEGUARDING_SHADOW_MODE=1` so no real emails go
  out during the test).
