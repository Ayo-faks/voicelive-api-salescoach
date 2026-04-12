# Superprof Nigeria Prospecting Notes

Generated: 2026-04-11

## Why this flow differs from ASLTIP

The Superprof Nigeria speech therapy listing is accessible in the browser session, but plain fetches from the workspace return `403`. Because of that, the extractor for this source is browser-side only.

## Current first-pass extractor

Script:

- `scripts/prospecting/superprof_ng_icp_browser_extractor.js`

Purpose:

- collect visible tutor cards from the listing page;
- optionally click `see more tutors` to load additional cards;
- fetch individual tutor profile pages from the live browser session;
- score them using a Wulo-oriented ICP model adapted to a tutoring marketplace rather than a professional therapist directory.

## Main signals used in the first pass

1. explicit speech or language therapy wording;
2. child or school-focused language;
3. autism, SEN, speech delay, communication, or learning disability signals;
4. online availability and in-person reach;
5. rating, reviews, response time, and Superprof trust badges;
6. parent or caregiver follow-through language.

## Known limitations

1. Superprof is a marketplace, not a verified clinician directory.
2. Not every tutor on this page will be a licensed speech-language therapist.
3. Website and direct email capture are likely sparse.
4. The first pass is intentionally heuristic and should be validated against the top-ranked results before outreach.

## Suggested next step

Run the browser extractor on the live listing page, inspect the top 25 manually, then decide whether to add a second-pass shortlist script and contact-enrichment flow similar to ASLTIP.