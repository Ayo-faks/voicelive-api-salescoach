#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = '/home/ayoola/sen/voicelive-api-salescoach';
const PROSPECTING_DIR = path.join(ROOT, 'docs/prospecting');
const SHORTLIST_PATH = path.join(PROSPECTING_DIR, 'superprof-ng-top-25-clean-shortlist.json');
const CONTACTS_PATH = path.join(PROSPECTING_DIR, 'superprof-ng-contact-enrichment.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function displayLocation(profile) {
  const direct = clean(profile.displayLocation || profile.location);
  if (direct) return direct;
  const lessonLocation = clean(profile.lessonLocation);
  const houseMatch = lessonLocation.match(/house:\s*([^:]+?)(?:\s+webcam|\s+at home|$)/i);
  if (houseMatch) return clean(houseMatch[1]);
  return '';
}

const MANUAL_NOTES = {
  'Funke Omonkhegbe': {
    whyNow: 'Founder-led pediatric speech practice with UK and Nigeria experience, direct intervention, parent and teacher training, and a clear inclusion-driven clinic story outside the marketplace layer.',
    caution: 'This is a curated external addition rather than a Superprof-native profile, so validate current intake capacity and preferred contact route before deeper founder time.',
    angle: 'Lead with home-school carryover, therapist visibility between sessions, and structured support for parents and educators.',
  },
  Peter: {
    whyNow: 'Best blend of explicit speech-language positioning, high review count, and strong child-facing carryover language in the current Nigerian list.',
    caution: 'Behavior and educational therapy language is still present, so keep the outreach centered on speech carryover rather than a generic SEN tool.',
    angle: 'Lead with between-session continuity for child speech targets and visible parent follow-through.',
  },
  Miracle: {
    whyNow: 'Clear speech-therapy identity with strong child communication language and enough marketplace proof to justify immediate founder outreach.',
    caution: 'Broad challenge coverage may mean a wider caseload than pure articulation or language-delay work.',
    angle: 'Lead with therapist-controlled home practice and communication gains between sessions.',
  },
  Kemily: {
    whyNow: 'Strongest clean speech-language positioning in the shortlist outside the high-review Lagos profiles, with modern service framing and parent coaching language.',
    caution: 'No review proof or external contact recovered yet, so this is high-fit but lower-confidence commercially.',
    angle: 'Lead with structured home carryover, progress tracking, and parent coaching support.',
  },
  Rhodiyat: {
    whyNow: 'Very clean child speech-therapy positioning with explicit parent guidance and home support language.',
    caution: 'Marketplace proof is still thin, so treat as a promising early-adopter rather than a guaranteed high-volume practice.',
    angle: 'Lead with parent-facing follow-through and lightweight therapist review between sessions.',
  },
  Adewunmi: {
    whyNow: 'Explicit speech pathology and audiology framing with clear articulation, fluency, and autism-related communication scope.',
    caution: 'The profile spans children and adults, so position Wulo on the child and caregiver side of the caseload.',
    angle: 'Lead with child speech practice, articulation carryover, and therapy visibility outside live sessions.',
  },
  Anawanti: {
    whyNow: 'Explicit speech therapist wording and a clear special-needs child focus make this a good Wulo-fit despite lower marketplace proof.',
    caution: 'The profile is light on differentiated method detail, so outreach should stay practical rather than visionary.',
    angle: 'Lead with school-home carryover and simpler therapist-supervised practice for children with communication needs.',
  },
  Akinbobloa: {
    whyNow: 'Strong explicit speech identity with a school-based Abuja footprint and meaningful overlap with learning-disability and speech-delay work.',
    caution: 'There is educator crossover in the profile, so keep the framing anchored on speech therapy outcomes rather than classroom support.',
    angle: 'Lead with school-linked carryover, therapist review visibility, and child practice between sessions.',
  },
  Prince: {
    whyNow: 'Explicit speech-language therapist identity and respectable review proof put this profile above most speech-adjacent alternatives.',
    caution: 'The method copy leans toward music and vocal intervention language, so validate clinical fit during outreach.',
    angle: 'Lead with structured speech practice rather than broad therapy administration.',
  },
  Kehinde: {
    whyNow: 'Explicit audiology and speech pathology background with broad clinical coverage and strong child-speech relevance.',
    caution: 'The listed `₦10/h` price looks like a marketplace anomaly, so confirm seriousness and current practice before investing too much outreach effort.',
    angle: 'Lead with high-structure child speech carryover and therapist-controlled goal tracking.',
  },
  'Funmilola Christiana': {
    whyNow: 'Not a pure speech-language profile, but the parent/home carryover language and strong review volume make it the best controlled adjacency for founder learning.',
    caution: 'This is behavior-therapy-heavy and should be treated as a secondary experiment, not the core wedge.',
    angle: 'Lead with parent follow-through and practical between-session support rather than clinical speech specialization.',
  },
};

const FOUNDER_ORDER = [
  'Funke Omonkhegbe',
  'Peter',
  'Miracle',
  'Kemily',
  'Rhodiyat',
  'Adewunmi',
  'Anawanti',
  'Akinbobloa',
  'Prince',
  'Kehinde',
];

function main() {
  const shortlist = readJson(SHORTLIST_PATH).prospects || [];
  const contacts = new Map((readJson(CONTACTS_PATH).contacts || []).map((profile) => [profile.name, profile]));
  const byName = new Map(shortlist.map((profile) => [profile.name, profile]));

  const top10 = FOUNDER_ORDER
    .map((name, index) => {
      const base = byName.get(name);
      if (!base) return null;
      const contact = contacts.get(name) || {};
      const notes = MANUAL_NOTES[name];
      return {
        founderPriorityRank: index + 1,
        founderPriorityTier: index < 4 ? 'tier-1' : index < 8 ? 'tier-2' : 'tier-3',
        name,
        displayLocation: displayLocation(contact) || displayLocation(base),
        shortlistScore: base.shortlistScore,
        icpScore: base.icpScore,
        reviewCount: base.reviewCount,
        explicitSpeechCredential: Boolean(base.traits?.explicitSpeechCredential),
        website: contact.website || '',
        publicEmail: contact.publicEmail || '',
        bestContactUrl: contact.bestContactUrl || '',
        enrichmentConfidence: contact.enrichmentConfidence || 'low',
        profileUrl: base.profileUrl,
        whyNow: notes.whyNow,
        caution: notes.caution,
        angle: notes.angle,
      };
    })
    .filter(Boolean);

  writeJson(path.join(PROSPECTING_DIR, 'superprof-ng-founder-priority-top-10.json'), {
    generatedAt: new Date().toISOString(),
    source: SHORTLIST_PATH,
    note: 'Manual founder-priority cut favoring explicit speech-language profiles over behavior-therapy-heavy adjacency.',
    total: top10.length,
    prospects: top10,
  });

  const csvHeader = [
    'rank',
    'tier',
    'name',
    'displayLocation',
    'shortlistScore',
    'icpScore',
    'reviewCount',
    'explicitSpeechCredential',
    'website',
    'publicEmail',
    'bestContactUrl',
    'enrichmentConfidence',
    'whyNow',
    'caution',
    'angle',
    'profileUrl',
  ];
  const csvRows = top10.map((profile) => [
    profile.founderPriorityRank,
    profile.founderPriorityTier,
    profile.name,
    profile.displayLocation,
    profile.shortlistScore,
    profile.icpScore,
    profile.reviewCount,
    profile.explicitSpeechCredential,
    profile.website,
    profile.publicEmail,
    profile.bestContactUrl,
    profile.enrichmentConfidence,
    profile.whyNow,
    profile.caution,
    profile.angle,
    profile.profileUrl,
  ]);
  const csv = [csvHeader, ...csvRows]
    .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  fs.writeFileSync(path.join(PROSPECTING_DIR, 'superprof-ng-founder-priority-top-10.csv'), `${csv}\n`);

  const mdRows = top10
    .map(
      (profile) => `## ${profile.founderPriorityRank}. ${profile.name}\n\nPriority tier: ${profile.founderPriorityTier}\n\nWhy now: ${profile.whyNow}\n\nCaution: ${profile.caution}\n\nSuggested angle: ${profile.angle}\n\nContact route: ${profile.publicEmail || profile.bestContactUrl || 'No public route recovered yet'}\n\nLocation: ${profile.displayLocation || 'n/a'}\n\nProfile: ${profile.profileUrl}\n`,
    )
    .join('\n');
  fs.writeFileSync(
    path.join(PROSPECTING_DIR, 'superprof-ng-founder-priority-top-10.md'),
    `# Superprof Nigeria Founder-Priority Top 10\n\nGenerated: ${new Date().toISOString()}\n\nThis is a manual founder cut built from the clean shortlist, with stronger preference for explicit speech-language profiles and room for curated external Nigerian speech-practice operators when the marketplace crawl misses known high-fit clinics.\n\n${mdRows}`,
  );
}

main();