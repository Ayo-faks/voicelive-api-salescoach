/*
Reusable browser-side extractor for Superprof Nigeria speech therapy ICP prospecting.

How to use:
1. Open https://www.superprof.ng/lessons/speech-therapy/nigeria/
2. Paste this file into the browser console, or inject it with Playwright/browser tools.
3. Run: SuperprofNGICPExtractor.runTopProspects()

The extractor is intentionally browser-side because Superprof blocks standard
server-side fetches in this workspace. It relies on the live page session.
*/

const SuperprofNGICPExtractor = (() => {
  const DEFAULT_SOURCE_URLS = [
    'https://www.superprof.ng/lessons/speech-therapy/nigeria/',
    'https://www.superprof.ng/lessons/speech-therapy/lagos/',
    'https://www.superprof.ng/lessons/speech-therapy/abuja-municipal/',
    'https://www.superprof.ng/lessons/speech-therapy/port-harcourt/',
    'https://www.superprof.ng/lessons/speech-therapy/online/',
    'https://www.superprof.ng/lessons/speech-therapy/nigeria/primary/',
  ];

  const DEFAULT_SEGMENTS = [
    {
      key: 'child-speech',
      label: 'Child speech and language specialists',
      segmentBonus: 12,
      matchers: [/speech therapist/i, /speech and language/i, /speech delay/i, /language delay/i],
    },
    {
      key: 'autism-sen',
      label: 'Autism and SEN communication specialists',
      segmentBonus: 10,
      matchers: [/autism/i, /neurodivergent/i, /special needs/i, /learning disabilit/i, /aba/i],
    },
    {
      key: 'school-home',
      label: 'School and home follow-through tutors',
      segmentBonus: 8,
      matchers: [/school/i, /home/i, /caregiver/i, /parent/i, /follow-up/i],
    },
    {
      key: 'teletherapy',
      label: 'Online speech therapy providers',
      segmentBonus: 7,
      matchers: [/webcam/i, /online/i, /virtual/i, /remote/i],
    },
  ];

  const EXCLUDED_EMAIL_RE =
    /office@superprof\.|noreply|no-reply|donotreply|example\.com|domain\.com|@sentry\.io/i;
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const PROFILE_LINK_RE = /^https:\/\/www\.superprof\.ng\//i;

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function firstName(name) {
    return clean(name).split(/\s+/).find(Boolean) || '';
  }

  function toAbsoluteUrl(url) {
    try {
      return new URL(url, window.location.origin).toString();
    } catch {
      return '';
    }
  }

  function extractEmails(text) {
    return unique(
      (String(text || '').match(EMAIL_RE) || [])
        .map((value) => clean(value).toLowerCase())
        .filter((value) => value && !EXCLUDED_EMAIL_RE.test(value)),
    );
  }

  function parseMoneyNgn(text) {
    const match = clean(text).match(/₦\s*([\d,]+)/i);
    if (!match) return null;
    return Number(match[1].replace(/,/g, '')) || null;
  }

  function parseRating(text) {
    const match = clean(text).match(/^(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : null;
  }

  function parseReviewCount(text) {
    const match = clean(text).match(/\((\d+)\s+reviews?\)/i);
    return match ? Number(match[1]) : 0;
  }

  function parseStudents(text) {
    const match = clean(text).match(/(\d+)\+/);
    return match ? Number(match[1]) : null;
  }

  function parseResponseHours(text) {
    const match = clean(text).match(/(\d+)h/i);
    return match ? Number(match[1]) : null;
  }

  function listingCards(doc = document) {
    return [...doc.querySelectorAll('a[href^="/"]')]
      .filter((anchor) => {
        const href = anchor.getAttribute('href') || '';
        const title = clean(anchor.textContent);
        return href.includes('.html') && /₦\d+\/h/i.test(title);
      });
  }

  function inferModalities(text) {
    const lower = clean(text).toLowerCase();
    return {
      webcam: /webcam|online/i.test(lower),
      inPerson: /face to face|at home|public place/i.test(lower),
    };
  }

  function extractListingCard(anchor) {
    const href = toAbsoluteUrl(anchor.getAttribute('href'));
    const text = clean(anchor.textContent);
    const paragraphs = [...anchor.querySelectorAll('p')].map((node) => clean(node.textContent));
    const headings = [...anchor.querySelectorAll('h1,h2,h3,h4')].map((node) => clean(node.textContent));
    const name = paragraphs[0] || text.split(' ')[0] || '';
    const location = paragraphs[1] || '';
    const title = headings[0] || '';
    const rating = parseRating(text);
    const reviewCount = parseReviewCount(text);
    const pricePerHourNgn = parseMoneyNgn(text);
    const modalities = inferModalities(location);
    const superprofBadge = /super tutor/i.test(text)
      ? 'super_tutor'
      : /confirmed/i.test(text)
        ? 'confirmed'
        : '';
    const firstLessonFree = /1st lesson free/i.test(text);

    return {
      name,
      firstName: firstName(name),
      profileUrl: href,
      title,
      location,
      bioSnippet: title,
      rating,
      reviewCount,
      pricePerHourNgn,
      superprofBadge,
      firstLessonFree,
      modalities,
    };
  }

  async function fetchDocument(url) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    const html = await response.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function sectionText(doc, headingText) {
    const headings = [...doc.querySelectorAll('h1,h2,h3,h4')].filter(
      (node) => clean(node.textContent).toLowerCase() === headingText.toLowerCase(),
    );

    for (const heading of headings) {
      const parts = [];
      let next = heading.nextElementSibling;
      while (next && !/^H[1-4]$/.test(next.tagName)) {
        parts.push(clean(next.textContent));
        next = next.nextElementSibling;
      }
      const text = clean(parts.join(' '));
      if (text) return text;
    }

    return '';
  }

  function extractProfile(doc, listingData) {
    const bodyText = clean(doc.body.innerText);
    const heroHeading = clean(doc.querySelector('h1')?.textContent || listingData.title || '');
    const profileName = clean(doc.querySelector('p')?.textContent || listingData.name || '');
    const badgeText = clean(sectionText(doc, 'Super tutor'));
    const aboutText = clean(sectionText(doc, 'About the lesson'));
    const aboutTutor = clean(sectionText(doc, `About ${listingData.firstName || listingData.name}`));
    const lessonLocation = clean(sectionText(doc, 'Lesson location'));
    const reviewHeading = clean(doc.querySelector('h2,h3,h4')?.textContent || '');
    const responseValues = [...doc.querySelectorAll('li,div,p')].map((node) => clean(node.textContent));

    const rateIndex = responseValues.findIndex((value) => /^rate$/i.test(value));
    const responseIndex = responseValues.findIndex((value) => /^response$/i.test(value));
    const studentsIndex = responseValues.findIndex((value) => /^students$/i.test(value));

    const pricePerHourNgn = listingData.pricePerHourNgn || parseMoneyNgn(responseValues[rateIndex + 1] || '');
    const responseTimeHours = parseResponseHours(responseValues[responseIndex + 1] || '');
    const studentsHelped = parseStudents(responseValues[studentsIndex + 1] || '');
    const allLevels = /all levels/i.test(bodyText);
    const englishLanguage = /english/i.test(bodyText);
    const emails = extractEmails(bodyText);
    const modalities = inferModalities(`${listingData.location} ${lessonLocation}`);

    return {
      name: profileName || listingData.name,
      firstName: firstName(profileName || listingData.name),
      profileUrl: listingData.profileUrl,
      website: '',
      email: emails[0] || '',
      emailSource: emails[0] ? 'profile' : '',
      hasPhone: /\b\+?\d{7,}\b/.test(bodyText),
      title: heroHeading,
      bio: aboutTutor || listingData.bioSnippet || heroHeading,
      lessonApproach: aboutText,
      lessonLocation,
      location: listingData.location,
      rating: listingData.rating,
      reviewCount: listingData.reviewCount,
      pricePerHourNgn,
      responseTimeHours,
      studentsHelped,
      superprofBadge: listingData.superprofBadge || (/super tutor/i.test(badgeText) ? 'super_tutor' : ''),
      firstLessonFree: listingData.firstLessonFree,
      modalities,
      allLevels,
      englishLanguage,
      specialisms: unique(
        [
          ...(listingData.title.match(/autism|speech and language|speech delay|language delay|learning disabilit|aba|behavior|behaviour|special needs|dysarthria|articul/i) || []),
          ...(aboutTutor.match(/autism|speech and language|speech delay|language delay|learning disabilit|aba|behavior|behaviour|special needs|dysarthria|articul/i) || []),
          ...(aboutText.match(/autism|speech and language|speech delay|language delay|learning disabilit|aba|behavior|behaviour|special needs|dysarthria|articul/i) || []),
        ].map((item) => clean(item.toLowerCase())),
      ),
    };
  }

  function inferTraits(profile) {
    const combined = clean(
      [
        profile.title,
        profile.bio,
        profile.lessonApproach,
        profile.lessonLocation,
        profile.location,
        profile.specialisms.join(' | '),
      ].join(' | '),
    ).toLowerCase();

    const childFocus =
      /child|children|kids|pre-primary|primary|secondary|school|young adult|young people|preschool|learner/i.test(
        combined,
      ) && !/adult education/i.test(combined);
    const adultOnly = /adults only|adult education/i.test(combined) && !/child|children|kids/i.test(combined);
    const schoolFacing = /school|pre-primary|primary|secondary|mainstream/i.test(combined);
    const parentFacing = /parent|caregiver|homecare|at home|follow-up|communication with parents/i.test(combined);
    const trainingConsultancy = /assessment|program|treatment program|documentation|supervisor|specialist/i.test(combined);
    const telehealthSignal = Boolean(profile.modalities.webcam) || /online|webcam|virtual|remote/i.test(combined);
    const broadChildCaseload =
      /autism|speech delay|language delay|learning disabilit|special needs|communication|articul|dysarthria|cerebral palsy/i.test(
        combined,
      );
    const speechPracticeAligned = /speech|language|communication|articul|oral muscles|speech therapist/i.test(combined);
    const medicallyComplex = /stroke|chronic pain|arthritis|adults with/i.test(combined);
    const privatePracticeSignal = true;
    const ownerOperatorSignal = /\bi\b|\bmy\b|\boffer\b|\bteach\b|\bhelp\b/.test(combined);
    const consultancyHeavy = /consult|documentation|assessment/.test(combined) && !/child|children|kids/.test(combined);
    const highTrustSignal = (profile.reviewCount || 0) >= 5 || profile.superprofBadge === 'super_tutor';
    const explicitSpeechCredential =
      /speech therapist|speech and language therapist|speech-language patholog|audiology and speech pathology|speech therapy practitioner/i.test(
        combined,
      );
    const behaviorOnly =
      /behavior analyst|behavior technician|behavioural specialist|aba specialist/i.test(combined) &&
      !explicitSpeechCredential;
    const educatorOnly =
      /teacher|educator|special educator|early years educator/i.test(combined) &&
      !explicitSpeechCredential;
    const nonSpeechAdjacency =
      /occupational therapist|physiotherapy|stroke rehab|chronic pain|arthritis/i.test(combined);

    return {
      childFocus,
      adultOnly,
      schoolFacing,
      parentFacing,
      trainingConsultancy,
      telehealthSignal,
      broadChildCaseload,
      speechPracticeAligned,
      medicallyComplex,
      privatePracticeSignal,
      ownerOperatorSignal,
      consultancyHeavy,
      ownWebsite: false,
      highTrustSignal,
      explicitSpeechCredential,
      behaviorOnly,
      educatorOnly,
      nonSpeechAdjacency,
    };
  }

  function scoreProfile(profile, segmentLabels) {
    const traits = inferTraits(profile);
    let score = 0;

    if (traits.childFocus) score += 22;
    if (!traits.adultOnly) score += 8;
    if (traits.schoolFacing) score += 8;
    if (traits.parentFacing) score += 8;
    if (traits.trainingConsultancy) score += 4;
    if (traits.telehealthSignal) score += 10;
    if (traits.broadChildCaseload) score += 12;
    if (traits.speechPracticeAligned) score += 10;
    if (traits.explicitSpeechCredential) score += 18;
    if (traits.ownerOperatorSignal) score += 6;
    if (traits.highTrustSignal) score += 8;
    if ((profile.reviewCount || 0) >= 10) score += 5;
    if ((profile.studentsHelped || 0) >= 10) score += 3;
    if (profile.firstLessonFree) score += 2;
    if (traits.medicallyComplex) score -= 6;
    if (traits.consultancyHeavy) score -= 5;
    if (traits.behaviorOnly) score -= 10;
    if (traits.educatorOnly) score -= 8;
    if (traits.nonSpeechAdjacency) score -= 18;

    const segmentBonus = DEFAULT_SEGMENTS
      .filter((segment) => segmentLabels.includes(segment.label))
      .reduce((sum, segment) => sum + (segment.segmentBonus || 0), 0);
    score += segmentBonus;

    const buyerProblems = [];
    if (traits.childFocus) buyerProblems.push('I need engaging home practice');
    if (traits.speechPracticeAligned) buyerProblems.push('I need to personalize exercises quickly');
    if (traits.parentFacing || traits.schoolFacing) {
      buyerProblems.push('I need visible progress for parents');
    }
    if (traits.telehealthSignal) {
      buyerProblems.push('I need continuity between weekly sessions');
    }
    if (traits.trainingConsultancy || traits.parentFacing) {
      buyerProblems.push('I need to review sessions without doing everything manually');
    }

    return {
      icpScore: Math.max(0, Math.min(100, score)),
      traits,
      buyerProblems: unique(buyerProblems),
    };
  }

  function matchedSegments(profile) {
    const combined = clean(
      [profile.title, profile.bio, profile.lessonApproach, profile.lessonLocation, profile.location].join(' | '),
    );

    const labels = DEFAULT_SEGMENTS.filter((segment) =>
      segment.matchers.some((matcher) => matcher.test(combined)),
    ).map((segment) => segment.label);

    return labels.length > 0 ? labels : ['General speech therapy tutors'];
  }

  function buildPersona(profile, traits) {
    return {
      practiceType: 'independent tutor or therapy provider',
      ownWebsite: false,
      broadChildCaseload: traits.broadChildCaseload,
      telehealthAvailability: traits.telehealthSignal,
      schoolFacing: traits.schoolFacing,
      parentFacing: traits.parentFacing,
      trainingOrConsultancy: traits.trainingConsultancy,
      ownerOperatorLikely: traits.ownerOperatorSignal,
    };
  }

  async function collectVisibleCards(options = {}) {
    const sourceUrls = options.sourceUrls || [window.location.href];
    const maxClicks = options.maxClicks || 0;
    const waitMs = options.waitMs || 1200;
    const seen = new Map();

    for (const sourceUrl of sourceUrls) {
      if (window.location.href !== sourceUrl) {
        window.location.href = sourceUrl;
        await new Promise((resolve) => setTimeout(resolve, waitMs + 1000));
      }

      for (let clickIndex = 0; clickIndex <= maxClicks; clickIndex += 1) {
        for (const anchor of listingCards(document)) {
          const card = extractListingCard(anchor);
          if (card.profileUrl && PROFILE_LINK_RE.test(card.profileUrl)) {
            seen.set(card.profileUrl, card);
          }
        }

        if (clickIndex === maxClicks) break;

        const moreButton = [...document.querySelectorAll('button, div, a')].find((node) =>
          /see more tutors/i.test(clean(node.textContent)),
        );
        if (!moreButton) break;

        moreButton.click();
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    return [...seen.values()];
  }

  async function fetchProfiles(cards, options = {}) {
    const limit = options.limit || cards.length;
    const prospects = [];

    for (const card of cards.slice(0, limit)) {
      try {
        const doc = await fetchDocument(card.profileUrl);
        const profile = extractProfile(doc, card);
        const segments = matchedSegments(profile);
        const scored = scoreProfile(profile, segments);
        prospects.push({
          ...profile,
          ...scored,
          matchedSegments: segments,
          primarySegment: segments[0],
          persona: buildPersona(profile, scored.traits),
        });
      } catch (error) {
        prospects.push({
          ...card,
          website: '',
          email: '',
          emailSource: '',
          hasPhone: false,
          bio: card.bioSnippet,
          lessonApproach: '',
          lessonLocation: card.location,
          studentsHelped: null,
          responseTimeHours: null,
          specialisms: [],
          matchedSegments: ['General speech therapy tutors'],
          primarySegment: 'General speech therapy tutors',
          persona: {
            practiceType: 'independent tutor or therapy provider',
            ownWebsite: false,
            broadChildCaseload: false,
            telehealthAvailability: card.modalities.webcam,
            schoolFacing: false,
            parentFacing: false,
            trainingOrConsultancy: false,
            ownerOperatorLikely: true,
          },
          traits: {
            childFocus: false,
            adultOnly: false,
            schoolFacing: false,
            parentFacing: false,
            trainingConsultancy: false,
            telehealthSignal: card.modalities.webcam,
            broadChildCaseload: false,
            speechPracticeAligned: true,
            medicallyComplex: false,
            privatePracticeSignal: true,
            ownerOperatorSignal: true,
            consultancyHeavy: false,
            ownWebsite: false,
            highTrustSignal: false,
          },
          buyerProblems: [],
          fetchError: String(error),
          icpScore: 20,
        });
      }
    }

    return prospects
      .sort((left, right) => right.icpScore - left.icpScore || (right.reviewCount || 0) - (left.reviewCount || 0));
  }

  function buildCsvRows(prospects) {
    const header = [
      'rank',
      'name',
      'profileUrl',
      'icpScore',
      'primarySegment',
      'matchedSegments',
      'location',
      'pricePerHourNgn',
      'rating',
      'reviewCount',
      'responseTimeHours',
      'studentsHelped',
      'superprofBadge',
      'firstLessonFree',
      'webcam',
      'inPerson',
      'email',
      'emailSource',
      'childFocus',
      'adultOnly',
      'schoolFacing',
      'parentFacing',
      'trainingConsultancy',
      'telehealthSignal',
      'broadChildCaseload',
      'speechPracticeAligned',
      'medicallyComplex',
      'buyerProblems',
      'bio',
      'lessonApproach',
    ];

    const rows = prospects.map((prospect, index) => [
      index + 1,
      prospect.name,
      prospect.profileUrl,
      prospect.icpScore,
      prospect.primarySegment,
      prospect.matchedSegments.join(' | '),
      prospect.location,
      prospect.pricePerHourNgn ?? '',
      prospect.rating ?? '',
      prospect.reviewCount ?? '',
      prospect.responseTimeHours ?? '',
      prospect.studentsHelped ?? '',
      prospect.superprofBadge,
      prospect.firstLessonFree,
      prospect.modalities.webcam,
      prospect.modalities.inPerson,
      prospect.email,
      prospect.emailSource,
      prospect.traits.childFocus,
      prospect.traits.adultOnly,
      prospect.traits.schoolFacing,
      prospect.traits.parentFacing,
      prospect.traits.trainingConsultancy,
      prospect.traits.telehealthSignal,
      prospect.traits.broadChildCaseload,
      prospect.traits.speechPracticeAligned,
      prospect.traits.medicallyComplex,
      prospect.buyerProblems.join(' | '),
      prospect.bio,
      prospect.lessonApproach,
    ]);

    return { header, rows };
  }

  async function runTopProspects(options = {}) {
    const sourceUrls = options.sourceUrls || DEFAULT_SOURCE_URLS;
    const maxClicks = options.maxClicks || 0;
    const topN = options.topN || 100;
    const waitMs = options.waitMs || 1200;

    const cards = await collectVisibleCards({ sourceUrls, maxClicks, waitMs });
    const prospects = await fetchProfiles(cards, { limit: topN });
    const csv = buildCsvRows(prospects);

    return {
      generatedAt: new Date().toISOString(),
      source: window.location.href,
      sourceUrls,
      maxClicks,
      totalVisibleCards: cards.length,
      totalDedupedProspects: prospects.length,
      segmentSummaries: DEFAULT_SEGMENTS.map((segment) => {
        const segmentProspects = prospects.filter((prospect) => prospect.matchedSegments.includes(segment.label));
        return {
          segmentKey: segment.key,
          segmentLabel: segment.label,
          sampledProfiles: segmentProspects.length,
          averageScore: segmentProspects.length
            ? Math.round(segmentProspects.reduce((sum, prospect) => sum + prospect.icpScore, 0) / segmentProspects.length)
            : 0,
        };
      }).filter((item) => item.sampledProfiles > 0),
      prospects,
      csv,
    };
  }

  function toCsvString(csv) {
    const escapeCsvValue = (value) => {
      const text = String(value ?? '');
      return `"${text.replace(/"/g, '""')}"`;
    };

    return [csv.header, ...csv.rows]
      .map((row) => row.map(escapeCsvValue).join(','))
      .join('\n');
  }

  return {
    DEFAULT_SOURCE_URLS,
    DEFAULT_SEGMENTS,
    runTopProspects,
    toCsvString,
  };
})();