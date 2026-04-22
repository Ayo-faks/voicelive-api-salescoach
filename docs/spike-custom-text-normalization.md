# Spike: `customTextNormalizationUrl` for Azure Speech / Voice Live

Status: **spike** — documentation only. Implementation deferred until the
listening-eval data gate (P2.7) clears and we can measure whether
edge-side text normalisation is actually additive over the in-process
`tts_normalizer` + custom PLS.

## Problem

`backend/src/services/tts_normalizer.py` rewrites graphemic phoneme
citations (e.g. `/th/`) into SSML `<phoneme>` tags before we hand text
to Azure Speech. This works but:

* Every hop that produces user-visible text (the LLM streaming via Voice
  Live, our `/api/tts` endpoint, client-originated `conversation.item.create`
  frames) must remember to call the normaliser.
* Frame-by-frame normalisation of realtime streams costs ~1–2 ms/1 KB;
  negligible individually but additive across a session.

Azure Speech supports a custom **text normalisation URL** that runs
server-side before the acoustic model; the Azure edge fetches the
normalisation ruleset once and applies it to every TTS request that
references it.

## Evaluation plan

1. **Author a ruleset** (`data/lexicons/text-normalization.xml`) that
   mirrors `PHONEME_MAP` and the letter-name sweep. Host it next to
   `wulo.pls` with the same SAS/rotation strategy.
2. **A/B inside listening-eval**: add a third variant label `edge-norm`
   that relies exclusively on `customTextNormalizationUrl` (no local
   normalisation). Therapists score A/B/C via the existing tool; the
   reward service learns which is cleanest.
3. **Measure cold-start** on Voice Live (ruleset is fetched lazily; first
   turn may stall).
4. **Measure residual leakage**: re-run `scripts/check_th_voicing.py` on
   a 24h sample of streamed transcripts with each variant.

## Open questions (do not implement until answered)

- Does Voice Live Realtime honour `customTextNormalizationUrl`, or only
  the classic REST synthesiser? (Voice Live preview docs are silent.)
- Is the ruleset file hot-reloaded when the PLS cache rotates?
- What is the max ruleset size? Our `PHONEME_MAP` is ~20 entries; the
  letter-name sweep adds ~10. Fits comfortably if the cap is ≥1 KiB.

## Decision

Proceed with the in-process normaliser for production; schedule the spike
for week +8 (after we have ≥200 listening-eval votes and can quantify
the A/B delta). Tracking issue: _file one when the gate clears_.
