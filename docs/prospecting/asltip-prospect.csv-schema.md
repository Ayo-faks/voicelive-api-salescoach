# ASLTIP Prospect CSV Schema

Header order:

```csv
rank,name,profileUrl,icpScore,primarySegment,matchedSegments,website,email,emailSource,memberSince,postcode,childFocus,adultOnly,schoolFacing,parentFacing,trainingConsultancy,telehealthSignal,broadChildCaseload,privatePracticeSignal,ownerOperatorSignal,consultancyHeavy,conditions,ageRanges,buyerProblems,bio
```

Column meanings:

- `rank`: sort order after descending ICP score.
- `name`: therapist display name from the profile page.
- `profileUrl`: ASLTIP public profile URL.
- `icpScore`: integer 0-100 fit score.
- `primarySegment`: source segment producing the best score.
- `matchedSegments`: pipe-delimited list of all matching segments after deduplication.
- `website`: filtered external standalone website if present; excludes ASLTIP, social links, and known footer or site-builder links.
- `email`: best currently known contact email when a plausible public address is available.
- `emailSource`: where that email came from, for example `profile` or `website`.
- `memberSince`: ASLTIP member since date if present.
- `postcode`: extracted outward or full postcode where available.
- `childFocus`: boolean derived from age ranges and bio language.
- `adultOnly`: boolean flag for adult-only caseloads.
- `schoolFacing`: boolean derived from bio and conditions.
- `parentFacing`: boolean derived from family, carers, or home practice language.
- `trainingConsultancy`: boolean for training, supervision, mentoring, or consultancy signals.
- `telehealthSignal`: boolean from segment or profile evidence.
- `broadChildCaseload`: boolean derived from child-aligned condition breadth.
- `privatePracticeSignal`: boolean for likely independent private practice signals.
- `ownerOperatorSignal`: boolean for likely owner-led or named-practice signals.
- `consultancyHeavy`: boolean for broader advisory or consultancy-skewed profiles.
- `conditions`: pipe-delimited conditions treated.
- `ageRanges`: pipe-delimited age ranges treated.
- `buyerProblems`: pipe-delimited product pain statements.
- `bio`: first substantive descriptive paragraph from the profile.