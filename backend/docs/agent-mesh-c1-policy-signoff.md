# Agent-mesh C1 policy — reviewer sign-off

> Gate 4 (Track-C learned next-best-question) is **dark** until a human reviewer
> signs off both the labeled corpus and the trained policy artifact, and the
> batch-score precondition is met. This document is the sign-off record. Filling
> the signature rows is a **human action** — the agent never forges sign-offs.

## 1. Scope

| Item | Path |
| --- | --- |
| Training harness | [backend/src/learning/eval/c1_training.py](../src/learning/eval/c1_training.py) |
| Labeled corpus | [backend/data/c1/next_best_question_corpus.json](../data/c1/next_best_question_corpus.json) |
| Trained artifact | [backend/data/c1/next_best_question_policy.json](../data/c1/next_best_question_policy.json) |
| Selection seam (consumer) | [backend/src/learning/eval/c1_policy.py](../src/learning/eval/c1_policy.py) |
| Unit tests | [backend/tests/unit/test_c1_training.py](../tests/unit/test_c1_training.py) |

The artifact is loaded into `LearnedItemSelector` as a **shadow only**. It is never
acted on until a human calls `promote()` behind `AGENT_MESH_ENABLED` +
`LEARNING_C1_POLICY_V1`. Promotion is the gate-4 go-live action and is out of
scope for the agent.

## 2. Corpus provenance

- **Origin:** synthetic. No live learner data is used. Each example is a
  decision point — a learner's prior skill mastery plus a candidate list of
  diagnostic items — with one item labeled as the best next question.
- **Subjects:** JSS3/SS3 slice — `maths.{fractions,algebra,geometry}` and
  `english.{comprehension,grammar,essay}`.
- **Size:** 60 examples, 4–6 candidates each.
- **Determinism:** generated with a fixed seed (`20260604`); regenerating
  reproduces the file byte-for-byte.

## 3. Labeling protocol

Each example's label is the candidate maximising the **adaptive-testing rule**:

```
score(item) = 2·mastery_gap + 1·uncertainty + 1.5·difficulty_match
```

- `mastery_gap = 1 − P(mastery)` of the item's skill — **weakest skill first**.
- `uncertainty` — evidence uncertainty for that skill — more to learn.
- `difficulty_match = 1 / (1 + |difficulty − ability|)` — item difficulty nearest
  the learner's ability boundary carries the **most information**.

Candidate order is shuffled so the round-robin baseline (pick the first
candidate) is a fair, frequently-wrong control rather than the label itself.

> The reviewer's job is to confirm this rule is pedagogically sound for the
> target cohort and that a sample of labels match expert judgement. Disagreements
> are recorded in §6 and block promotion until resolved.

## 4. Training method

- **Offline only.** `train_next_best_question_policy` fits a 3-feature linear
  policy with an **averaged perceptron** over the pairwise preferences implied by
  each label (the labeled item must outscore every rival by a margin). There is
  no online training and no live weight update.
- The trained weights are interpretable and must stay positive (all three
  features should push toward, not against, the labeled choice).

## 5. Batch-score result (Track-A precondition)

Gate 4 may not open unless the policy **beats the round-robin baseline** on a
held-out split. Reproduce:

```bash
cd backend
python - <<'PY'
from src.learning.eval.c1_training import load_corpus, train_next_best_question_policy, batch_score_policy
c = load_corpus('data/c1/next_best_question_corpus.json')
s = int(len(c)*0.7)
p, r = train_next_best_question_policy(c[:s])
print('train  ', r.as_dict())
print('heldout', batch_score_policy(p, c[s:]).as_dict())
PY
```

Latest run (70/30 split):

| Metric | Policy | Round-robin baseline |
| --- | --- | --- |
| Train top-1 | 0.976 | 0.262 |
| Held-out top-1 | 0.944 | 0.222 |
| Full-corpus top-1 | 0.967 | 0.250 |
| Learned weights | `[mastery_gap≈6.12, uncertainty≈3.02, difficulty_match≈5.36]` | — |

Beats baseline: **yes** on all splits. ✅ (precondition met; promotion still requires §7.)

## 6. Reviewer findings

_Record sampled-label agreement, disagreements, and required corpus changes here._

| # | Finding | Severity | Resolution | Resolved? |
| --- | --- | --- | --- | --- |
| | | | | |

## 7. Sign-off

Promotion of the C1 policy to live selection requires **both** signatures below
**and** a green §5 result on the corpus at the committed SHA. Leave blank until
signed by the named humans.

| Role | Name | Responsibility | Signature / approval ref | Date |
| --- | --- | --- | --- | --- |
| Policy reviewer (pedagogy) | _pending_ | Validates labeling rule + sampled labels | | |
| Learning eng. owner | _pending_ | Validates harness, artifact, batch-score | | |

**Promotion action (human, after sign-off):** set `AGENT_MESH_ENABLED` +
`LEARNING_C1_POLICY_V1`, load the artifact into `LearnedItemSelector`, and call
`promote()`. **Rollback (any one, instant dark):** clear `LEARNING_C1_POLICY_V1`
or `AGENT_MESH_ENABLED`, or revert to the baseline selector — the policy returns
to shadow with no learner-visible effect.
