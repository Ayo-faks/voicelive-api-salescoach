#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = '/home/ayoola/sen/voicelive-api-salescoach';
const PROSPECTING_DIR = path.join(ROOT, 'docs/prospecting');
const TOP_PATH = path.join(PROSPECTING_DIR, 'superprof-ng-top-100.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstName(name) {
  return clean(name).split(/\s+/)[0] || '';
}

function practiceName(profile) {
  if (profile.name) {
    return `${profile.name} Speech Therapy`;
  }
  return 'Speech Therapy Practice';
}

function displayLocation(profile) {
  const direct = clean(profile.location);
  if (direct) return direct;

  const lessonLocation = clean(profile.lessonLocation);
  const houseMatch = lessonLocation.match(/house:\s*([^:]+?)(?:\s+webcam|\s+at home|$)/i);
  if (houseMatch) return clean(houseMatch[1]);

  const travelMatch = lessonLocation.match(/from\s+([^,]+)$/i);
  if (travelMatch) return clean(travelMatch[1]);

  if (/lagos/i.test(lessonLocation)) return 'Lagos';
  if (/ikeja/i.test(lessonLocation)) return 'Ikeja';
  if (/abuja/i.test(lessonLocation)) return 'Abuja Municipal';
  if (/port harcourt/i.test(lessonLocation)) return 'Port Harcourt';
  if (/ife/i.test(lessonLocation)) return 'Ife';
  if (/durumi/i.test(lessonLocation)) return 'Durumi';

  return '';
}

function shortlistScore(profile) {
  let score = profile.icpScore || 0;
  if (profile.traits?.explicitSpeechCredential) score += 24;
  if (profile.traits?.childFocus) score += 12;
  if (profile.traits?.parentFacing) score += 8;
  if (profile.traits?.schoolFacing) score += 6;
  if (profile.traits?.telehealthSignal) score += 4;
  if (profile.primarySegment === 'Child speech and language specialists') score += 6;
  if ((profile.reviewCount || 0) >= 10) score += 6;
  if ((profile.reviewCount || 0) >= 5) score += 3;
  if ((profile.reviewCount || 0) >= 20) score += 4;
  if (profile.superprofBadge === 'super_tutor') score += 4;
  if (profile.pricePerHourNgn && profile.pricePerHourNgn < 1000) score -= 20;
  if (profile.traits?.behaviorOnly) score -= 18;
  if (profile.traits?.educatorOnly) score -= 14;
  if (profile.traits?.nonSpeechAdjacency) score -= 20;
  if (!profile.traits?.explicitSpeechCredential && profile.primarySegment !== 'Child speech and language specialists') {
    score -= 6;
  }
  return Math.max(0, score);
}

function outreachSegment(profile) {
  const segments = profile.matchedSegments || [];
  if (segments.includes('Online speech therapy providers')) {
    return 'teletherapy-continuity';
  }
  if (segments.includes('School and home follow-through tutors')) {
    return 'school-home-followthrough';
  }
  if (segments.includes('Autism and SEN communication specialists')) {
    return 'autism-sen-carryover';
  }
  return 'child-speech-practice';
}

function passesShortlist(profile) {
  if (!profile.traits?.speechPracticeAligned) return false;
  if (profile.traits?.adultOnly) return false;
  if (profile.traits?.nonSpeechAdjacency) return false;
  if ((profile.icpScore || 0) < 75) return false;
  return true;
}

function toCsv(rows) {
  return rows
    .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function topCsv(prospects) {
  const header = [
    'rank',
    'name',
    'profileUrl',
    'icpScore',
    'primarySegment',
    'matchedSegments',
    'location',
    'pricePerHourNgn',
    'reviewCount',
    'superprofBadge',
    'email',
    'emailSource',
    'childFocus',
    'schoolFacing',
    'parentFacing',
    'telehealthSignal',
    'explicitSpeechCredential',
    'behaviorOnly',
    'educatorOnly',
    'nonSpeechAdjacency',
    'buyerProblems',
    'bio',
  ];

  const rows = prospects.map((profile, index) => [
    index + 1,
    profile.name,
    profile.profileUrl,
    profile.icpScore,
    profile.primarySegment,
    (profile.matchedSegments || []).join(' | '),
    displayLocation(profile),
    profile.pricePerHourNgn,
    profile.reviewCount,
    profile.superprofBadge,
    profile.email,
    profile.emailSource,
    profile.traits?.childFocus,
    profile.traits?.schoolFacing,
    profile.traits?.parentFacing,
    profile.traits?.telehealthSignal,
    profile.traits?.explicitSpeechCredential,
    profile.traits?.behaviorOnly,
    profile.traits?.educatorOnly,
    profile.traits?.nonSpeechAdjacency,
    (profile.buyerProblems || []).join(' | '),
    profile.bio,
  ]);

  return `${toCsv([header, ...rows])}\n`;
}

function shortlistCsv(prospects) {
  const header = [
    'rank',
    'name',
    'profileUrl',
    'icpScore',
    'shortlistScore',
    'primarySegment',
    'matchedSegments',
    'location',
    'pricePerHourNgn',
    'reviewCount',
    'superprofBadge',
    'email',
    'emailSource',
    'outreachSegment',
    'explicitSpeechCredential',
    'behaviorOnly',
    'educatorOnly',
    'buyerProblems',
    'bio',
  ];

  const rows = prospects.map((profile, index) => [
    index + 1,
    profile.name,
    profile.profileUrl,
    profile.icpScore,
    profile.shortlistScore,
    profile.primarySegment,
    (profile.matchedSegments || []).join(' | '),
    displayLocation(profile),
    profile.pricePerHourNgn,
    profile.reviewCount,
    profile.superprofBadge,
    profile.email,
    profile.emailSource,
    profile.outreachSegment,
    profile.traits?.explicitSpeechCredential,
    profile.traits?.behaviorOnly,
    profile.traits?.educatorOnly,
    (profile.buyerProblems || []).join(' | '),
    profile.bio,
  ]);

  return `${toCsv([header, ...rows])}\n`;
}

function founderCsv(prospects) {
  const header = [
    'rank',
    'sendStatus',
    'firstName',
    'fullName',
    'practiceName',
    'email',
    'emailSource',
    'outreachSegment',
    'subjectLine',
    'introLine',
    'shortlistScore',
    'location',
    'profileUrl',
  ];

  const segmentContent = {
    'child-speech-practice': {
      subject: 'Structured speech practice between sessions for children',
      intro: () => 'I found your Superprof speech therapy profile while reviewing child speech providers in Nigeria, and your background looks aligned with the between-session practice problem we are solving.',
    },
    'teletherapy-continuity': {
      subject: 'Keeping speech therapy momentum between online sessions',
      intro: () => 'I came across your Superprof profile while reviewing online speech therapy providers in Nigeria, and your setup looks closely aligned with the continuity gap we are solving between live sessions.',
    },
    'school-home-followthrough': {
      subject: 'Turning school and home therapy plans into visible follow-through',
      intro: () => 'I found your Superprof profile while reviewing therapists working across school and home settings, and your background looks relevant to the follow-through gap we are solving for therapists and caregivers.',
    },
    'autism-sen-carryover': {
      subject: 'A clearer carryover loop for autism and SEN speech practice',
      intro: () => 'I came across your Superprof profile while reviewing autism and SEN communication specialists in Nigeria, and your work looks very close to the structured carryover problem we are trying to solve.',
    },
  };

  const rows = prospects.map((profile, index) => {
    const segment = segmentContent[profile.outreachSegment] || segmentContent['child-speech-practice'];
    return [
      index + 1,
      profile.email ? 'ready-to-send' : 'no-email',
      firstName(profile.name),
      profile.name,
      practiceName(profile),
      profile.email,
      profile.emailSource,
      profile.outreachSegment,
      segment.subject,
      segment.intro(profile),
      profile.shortlistScore,
      displayLocation(profile),
      profile.profileUrl,
    ];
  });

  return `${toCsv([header, ...rows])}\n`;
}

function writeMarkdownSummary(top, shortlist) {
  const shortlistTable = shortlist
    .map(
      (profile, index) =>
        `| ${index + 1} | ${profile.name} | ${profile.icpScore} | ${profile.shortlistScore} | ${profile.primarySegment} | ${displayLocation(profile) || 'n/a'} |`,
    )
    .join('\n');

  fs.writeFileSync(
    path.join(PROSPECTING_DIR, 'superprof-ng-top-25-clean-shortlist.md'),
    `# Superprof Nigeria Clean Shortlist\n\nGenerated: ${new Date().toISOString()}\n\nCriteria: multi-route Superprof crawl, child speech relevance, explicit speech or strong speech-practice alignment, and shortlist ranking that rewards parent follow-through, teletherapy continuity, trust signals, and explicit speech credentials while penalizing generic non-speech adjacency.\n\n| Rank | Name | Score | Shortlist Score | Segment | Location |\n| --- | --- | --- | --- | --- | --- |\n${shortlistTable}\n`,
  );

  fs.writeFileSync(
    path.join(PROSPECTING_DIR, 'superprof-ng-outreach-segments.md'),
    `# Superprof Nigeria Outreach Segments\n\nGenerated: ${new Date().toISOString()}\n\nTop-list coverage: ${top.length} deduped public profiles.\n\n## Child speech practice\n\nMessage angle: Hi {{firstName}}, I found your Superprof speech therapy profile while reviewing child speech providers in Nigeria. We are building Wulo as a therapist-controlled practice layer that helps children continue structured speech work between sessions while giving the therapist clearer visibility into what happened outside the live appointment. If between-session follow-through is a real problem in your work, I would be happy to show you what we are testing.\n\n## Teletherapy continuity\n\nMessage angle: Hi {{firstName}}, I came across your Superprof profile while reviewing online speech therapy providers in Nigeria. One pattern we keep hearing is that weekly online therapy still loses momentum between appointments unless there is a clear practice loop outside the call. Wulo is designed to help therapists keep speech targets moving between sessions while giving families structure and the therapist something concrete to review.\n\n## School and home follow-through\n\nMessage angle: Hi {{firstName}}, I found your Superprof profile while reviewing therapists working across school and home settings. A gap we are focused on is what happens after recommendations are given: families need a clearer practice routine and therapists need a lightweight way to see whether anything actually happened between reviews. Wulo is designed as a structured carryover layer for that exact follow-through problem.\n\n## Autism and SEN carryover\n\nMessage angle: Hi {{firstName}}, I came across your Superprof profile while reviewing autism and SEN communication specialists in Nigeria. We are building Wulo as a therapist-supervised practice layer for children who need more consistent, structured communication practice between live sessions, with better visibility for therapists and caregivers.\n`,
  );

  fs.writeFileSync(
    path.join(PROSPECTING_DIR, 'superprof-ng-top-25-outreach-copy.md'),
    `# Superprof Nigeria First-Contact Outreach\n\nGenerated: ${new Date().toISOString()}\n\nUse the founder outreach sheet together with these segment messages.\n\n## Child speech practice\n\nSubject: Structured speech practice between sessions for children\n\nHi {{firstName}}, I found your Superprof speech therapy profile while reviewing child speech providers in Nigeria. We are building Wulo as a therapist-controlled practice layer that helps children continue structured speech work between sessions while giving the therapist clearer visibility into what happened outside the live appointment. If between-session follow-through is a real problem in your work, I would be happy to show you what we are testing.\n\n## Teletherapy continuity\n\nSubject: Keeping speech therapy momentum between online sessions\n\nHi {{firstName}}, I came across your Superprof profile while reviewing online speech therapy providers in Nigeria. One pattern we keep hearing is that weekly online therapy still loses momentum between appointments unless there is a clear practice loop outside the call. Wulo is designed to help therapists keep speech targets moving between sessions while giving families structure and the therapist something concrete to review. If that is relevant in your practice, I would be happy to send a short walkthrough.\n\n## School and home follow-through\n\nSubject: Turning school and home therapy plans into visible follow-through\n\nHi {{firstName}}, I found your Superprof profile while reviewing therapists working across school and home settings. A gap we are focused on is what happens after recommendations are given: families need a clearer practice routine and therapists need a lightweight way to see whether anything actually happened between reviews. Wulo is designed as a structured carryover layer for that exact follow-through problem.\n\n## Autism and SEN carryover\n\nSubject: A clearer carryover loop for autism and SEN speech practice\n\nHi {{firstName}}, I came across your Superprof profile while reviewing autism and SEN communication specialists in Nigeria. We are building Wulo as a therapist-supervised practice layer for children who need more consistent, structured communication practice between live sessions, with better visibility for therapists and caregivers. If that problem is live in your work, I would be glad to show you what we are testing.\n`,
  );

  fs.writeFileSync(
    path.join(PROSPECTING_DIR, 'superprof-ng-top-25-founder-outreach.md'),
    `# Superprof Nigeria Founder Outreach Sheet\n\nGenerated: ${new Date().toISOString()}\n\nPrimary export: docs/prospecting/superprof-ng-top-25-founder-outreach.csv\n\nCurrent counts:\n- ${shortlist.length} shortlisted targets total.\n- ${shortlist.filter((profile) => profile.email).length} marked ready-to-send.\n- ${shortlist.filter((profile) => !profile.email).length} marked no-email and still require manual contact discovery.\n\nThis Superprof founder sheet is profile-first and should be used with manual contact enrichment where direct email is absent.\n`,
  );
}

function main() {
  const top = readJson(TOP_PATH).prospects || [];

  const ranked = top
    .map((profile) => ({
      ...profile,
      outreachSegment: outreachSegment(profile),
      shortlistScore: shortlistScore(profile),
    }))
    .sort((left, right) => right.shortlistScore - left.shortlistScore || right.reviewCount - left.reviewCount);

  const shortlist = ranked.filter(passesShortlist).slice(0, 25);

  writeJson(path.join(PROSPECTING_DIR, 'superprof-ng-top-25-clean-shortlist.json'), {
    generatedAt: new Date().toISOString(),
    source: 'live Superprof NG multi-route browser crawl',
    sourceArtifact: TOP_PATH,
    criteria: {
      requiresSpeechPracticeAlignment: true,
      excludesAdultOnly: true,
      excludesNonSpeechAdjacency: true,
      ranking: 'icpScore plus explicit-speech, review, parent-facing, school-facing, and teletherapy weighting with penalties for behavior-only, educator-only, and suspiciously low pricing',
    },
    total: shortlist.length,
    prospects: shortlist,
  });

  fs.writeFileSync(path.join(PROSPECTING_DIR, 'superprof-ng-top-100.csv'), topCsv(ranked));
  fs.writeFileSync(path.join(PROSPECTING_DIR, 'superprof-ng-top-25-clean-shortlist.csv'), shortlistCsv(shortlist));
  fs.writeFileSync(path.join(PROSPECTING_DIR, 'superprof-ng-top-25-founder-outreach.csv'), founderCsv(shortlist));

  writeMarkdownSummary(ranked, shortlist);
}

main();