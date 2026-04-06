/*
Reusable browser-side extractor for ASLTIP member directory ICP prospecting.

How to use:
1. Open https://asltip.com/find-a-speech-therapist-old/member-directory/
2. Paste this file into the browser console, or inject it with Playwright/browser tools.
3. Run: ASLTIPICPExtractor.runTopProspects()

It returns a JSON payload with deduplicated prospects, segment summaries, and CSV rows.
*/

const ASLTIPICPExtractor = (() => {
  const DEFAULT_SEGMENTS = [
    {
      key: 'articulation',
      label: 'Pediatric articulation and phonology therapists',
      value: 'articulation-and-phonology',
      segmentBonus: 10,
    },
    {
      key: 'dld',
      label: 'Pediatric DLD therapists',
      value: 'developmental-language-disorder',
      segmentBonus: 10,
    },
    {
      key: 'telehealth',
      label: 'Telehealth-capable pediatric therapists',
      value: 'telehealth-provision-of-services-online',
      segmentBonus: 0,
    },
    {
      key: 'autism',
      label: 'Autism-support therapists using structured communication practice',
      value: 'autism-spectrum',
      segmentBonus: 5,
    },
    {
      key: 'school',
      label: 'School-facing or parent-facing private therapists',
      value: 'training-for-educational-settings',
      segmentBonus: 0,
    },
  ];

  const EXTERNAL_WEBSITE_RE = /^https?:\/\//i;
  const EXCLUDED_WEBSITE_RE =
    /twitter\.com|facebook\.com|instagram\.com|youtube\.com|youtu\.be|linkedin\.com|asltip\.com/i;
  const EXCLUDED_WEBSITE_DOMAINS = [
    'kobault.com',
    'canva.site',
    'mailchi.mp',
    'linktr.ee',
    'beacons.ai',
  ];
  const WEBSITE_HINT_RE = /website|visit|find out more|learn more|www\.|https?:\/\//i;
  const WEBSITE_NOISE_RE =
    /asltip|join|member directory|main menu|copyright|privacy|terms|cookie|powered by|site by|design by|web design|follow|instagram|facebook|twitter|youtube|linkedin/i;
  const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const EXCLUDED_EMAIL_RE =
    /office@asltip\.com|mail@example\.com|example\.com|sentry\.|wixpress\.com|@sentry\.io|noreply|no-reply|donotreply/i;
  const DEFAULT_SURNAME_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

  function clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function firstName(name) {
    return clean(name)
      .replace(/\([^)]*\)/g, ' ')
      .split(/\s+/)
      .find((part) => !/^(mrs|mr|miss|ms|dr)$/i.test(part)) || '';
  }

  function slugify(value) {
    return clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function extractEmails(text) {
    return unique((text.match(EMAIL_RE) || []).map((value) => value.toLowerCase()));
  }

  function normalizeEmail(email) {
    const value = clean(email).toLowerCase();
    if (!value || EXCLUDED_EMAIL_RE.test(value)) {
      return '';
    }
    return value;
  }

  function extractProfileEmail(doc, bodyText, profileWebsite, therapistName) {
    const mailtoEmails = [...doc.querySelectorAll('a[href^="mailto:"]')]
      .map((anchor) => anchor.getAttribute('href')?.replace(/^mailto:/i, '').split('?')[0] || '')
      .map((value) => normalizeEmail(value))
      .filter(Boolean);

    const textEmails = extractEmails(bodyText)
      .map((value) => normalizeEmail(value))
      .filter(Boolean);

    const candidates = unique([...mailtoEmails, ...textEmails]);
    const websiteDomain = domainFromUrl(profileWebsite);
    const givenName = firstName(therapistName).toLowerCase();

    const scored = candidates
      .map((email) => {
        let score = 0;
        if (websiteDomain && email.endsWith(`@${websiteDomain}`)) score += 4;
        if (givenName && email.includes(givenName)) score += 2;
        if (/info@|hello@|contact@|admin@/i.test(email)) score += 1;
        return { email, score };
      })
      .sort((left, right) => right.score - left.score);

    return scored[0]?.email || '';
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function domainFromUrl(href) {
    try {
      return new URL(href).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return '';
    }
  }

  function domainTokens(href) {
    return domainFromUrl(href)
      .split('.')
      .flatMap((part) => part.split(/[^a-z0-9]+/i))
      .map((part) => part.toLowerCase())
      .filter((part) => part.length >= 3);
  }

  function isExcludedWebsiteDomain(domain) {
    return EXCLUDED_WEBSITE_DOMAINS.some(
      (excludedDomain) => domain === excludedDomain || domain.endsWith(`.${excludedDomain}`),
    );
  }

  function normalizeWebsite(href) {
    const domain = domainFromUrl(href);
    if (
      !href ||
      !EXTERNAL_WEBSITE_RE.test(href) ||
      EXCLUDED_WEBSITE_RE.test(href) ||
      isExcludedWebsiteDomain(domain)
    ) {
      return '';
    }
    return href;
  }

  function scoreWebsiteCandidate(anchor, profileUrl) {
    const href = normalizeWebsite(anchor.href);
    if (!href) {
      return { href: '', score: -1 };
    }

    const domain = domainFromUrl(href);
    const profileDomain = domainFromUrl(profileUrl);
    if (!domain || domain === profileDomain) {
      return { href: '', score: -1 };
    }

    const text = clean(anchor.textContent).toLowerCase();
    const context = clean(
      anchor.closest('li, p, div, section, aside, article')?.textContent || anchor.textContent,
    ).toLowerCase();

    if (WEBSITE_NOISE_RE.test(text) || WEBSITE_NOISE_RE.test(context)) {
      return { href: '', score: -1 };
    }

    let score = 0;
    if (WEBSITE_HINT_RE.test(text)) score += 4;
    if (WEBSITE_HINT_RE.test(context)) score += 3;
    if (text.includes(domain)) score += 2;
    if (/^https?:\/\//i.test(text) || /^www\./i.test(text)) score += 2;
    if (/speech|language|therapy|clinic|practice|communication|talk|salt|slt/i.test(domain)) {
      score += 2;
    }
    if (anchor.closest('aside, section, article, li')) score += 1;

    return { href, score };
  }

  function extractWebsite(doc, profileUrl) {
    const anchors = [...doc.querySelectorAll('a[href]')];
    const scoredCandidates = anchors
      .map((anchor) => scoreWebsiteCandidate(anchor, profileUrl))
      .filter((candidate) => candidate.href && candidate.score > 0)
      .sort((left, right) => right.score - left.score);

    return scoredCandidates[0]?.href || '';
  }

  function personNameTokens(name) {
    return clean(name)
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .split(/[^a-z]+/)
      .filter((part) => part.length >= 3 && !['mrs', 'mr', 'miss', 'ms', 'dr'].includes(part));
  }

  function findSelect(selectors) {
    return selectors.map((selector) => document.querySelector(selector)).find(Boolean) || null;
  }

  function inferSurnameSelect() {
    return [...document.querySelectorAll('select')].find((select) => {
      const optionValues = [...select.options]
        .map((option) => option.value.toLowerCase())
        .filter(Boolean);
      return optionValues.includes('a') && optionValues.includes('z');
    }) || null;
  }

  function setSelectValue(selectElement, value) {
    if (!selectElement) {
      return false;
    }

    const normalizedValue = String(value ?? '').toLowerCase();
    const option = [...selectElement.options].find(
      (item) => item.value.toLowerCase() === normalizedValue,
    );

    if (!option) {
      return false;
    }

    selectElement.value = option.value;
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function currentMemberLinks() {
    return unique(
      [...document.querySelectorAll('#results a, .member-directory__results a')]
        .map((anchor) => anchor.href)
        .filter((href) => href.includes('/members/')),
    );
  }

  function sectionItems(doc, labelText) {
    const labels = [...doc.querySelectorAll('div, span, h2, h3, h4, strong')].filter(
      (element) => clean(element.textContent).toLowerCase() === labelText.toLowerCase(),
    );

    for (const label of labels) {
      const parent = label.parentElement;
      if (!parent) {
        continue;
      }

      const directItems = parent.querySelectorAll(':scope > ul li');
      if (directItems.length > 0 && directItems.length < 40) {
        return [...directItems].map((item) => clean(item.textContent)).filter(Boolean);
      }

      let next = label.nextElementSibling;
      while (next) {
        const listItems = next.querySelectorAll?.('li');
        if (listItems && listItems.length > 0 && listItems.length < 40) {
          return [...listItems].map((item) => clean(item.textContent)).filter(Boolean);
        }
        next = next.nextElementSibling;
      }
    }

    return [];
  }

  function inferTraits(profile, segment) {
    const bioLower = profile.bio.toLowerCase();
    const conditionsLower = profile.conditions.join(' | ').toLowerCase();
    const ageRangesLower = profile.ageRanges.join(' | ').toLowerCase();
    const websiteTokens = domainTokens(profile.website);
    const nameTokens = personNameTokens(profile.name);

    const childFocus =
      /newborn|preschool|primary|secondary|adolescent/.test(ageRangesLower) ||
      /child|children|young people|young person|family|families|parent|carer/.test(bioLower);

    const adultOnly =
      profile.ageRanges.length > 0 && profile.ageRanges.every((value) => /adult/i.test(value));

    const schoolFacing =
      /school|nurser|sen|education|teaching staff|school staff|classroom/.test(bioLower) ||
      /mainstream schools|training for educational settings/.test(conditionsLower);

    const parentFacing = /parent|family|families|carer|home practice|home programme|home program/.test(
      bioLower,
    );

    const trainingConsultancy =
      /training|consult|supervis|mentor/.test(bioLower) ||
      /training|consultancy|supervision|mentoring/.test(conditionsLower);

    const telehealthSignal =
      segment.key === 'telehealth' ||
      /online|telehealth|remote|virtual|zoom/.test(bioLower) ||
      /online therapy|telehealth/.test(conditionsLower);

    const broadChildCaseload =
      profile.conditions.filter((item) =>
        /articulation|phonology|developmental language|language disorder|autism|play skills|dyspraxia|down's syndrome|cerebral palsy|learning disability|early childhood/i.test(
          item,
        ),
      ).length >= 3;

    const speechPracticeAligned = profile.conditions.some((item) =>
      /articulation|phonology|developmental language|language disorder|play skills|early childhood/i.test(
        item,
      ),
    );

    const medicallyComplex = profile.conditions.some((item) =>
      /dysphagia|stroke|medico-legal|palliative|adult language|tracheostomy|progressive neurological/i.test(
        item,
      ),
    );

    const privatePracticeSignal =
      Boolean(profile.website) ||
      /private practice|independent|own clinic|my clinic|my practice|based in|specialist service/i.test(
        bioLower,
      );

    const ownerOperatorSignal =
      (privatePracticeSignal && /\bi\b|\bmy\b|\bme\b/.test(bioLower)) ||
      nameTokens.some((token) => websiteTokens.includes(token));

    const consultancyHeavy =
      trainingConsultancy &&
      !parentFacing &&
      !broadChildCaseload &&
      /consultancy|training|tribunal|case management|medico-legal|reports? for legal proceedings/i.test(
        `${bioLower} | ${conditionsLower}`,
      );

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
      ownWebsite: Boolean(profile.website),
    };
  }

  function scoreProfile(profile, segment) {
    const traits = inferTraits(profile, segment);
    let score = 0;

    if (traits.childFocus) score += 25;
    if (!traits.adultOnly) score += 10;
    if (traits.broadChildCaseload) score += 15;
    if (traits.parentFacing) score += 10;
    if (traits.schoolFacing) score += 10;
    if (traits.trainingConsultancy) score += 5;
    if (traits.ownWebsite) score += 5;
    if (traits.privatePracticeSignal) score += 10;
    if (traits.ownerOperatorSignal) score += 8;
    if (traits.telehealthSignal) score += 10;
    if (traits.speechPracticeAligned) score += 10;
    if (traits.medicallyComplex) score -= 15;
    if (traits.consultancyHeavy) score -= 8;
    score += segment.segmentBonus || 0;

    const buyerProblems = [];
    if (traits.childFocus) buyerProblems.push('I need engaging home practice');
    if (traits.broadChildCaseload) buyerProblems.push('I need to personalize exercises quickly');
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

  function buildPersona(profile, traits) {
    return {
      practiceType:
        traits.privatePracticeSignal
          ? 'private independent or small clinic'
          : 'unknown',
      ownWebsite: traits.ownWebsite,
      broadChildCaseload: traits.broadChildCaseload,
      telehealthAvailability: traits.telehealthSignal,
      schoolFacing: traits.schoolFacing,
      parentFacing: traits.parentFacing,
      trainingOrConsultancy: traits.trainingConsultancy,
      ownerOperatorLikely: traits.ownerOperatorSignal,
    };
  }

  function buildCsvRows(prospects) {
    const header = [
      'rank',
      'name',
      'profileUrl',
      'icpScore',
      'primarySegment',
      'matchedSegments',
      'website',
      'email',
      'emailSource',
      'memberSince',
      'postcode',
      'childFocus',
      'adultOnly',
      'schoolFacing',
      'parentFacing',
      'trainingConsultancy',
      'telehealthSignal',
      'broadChildCaseload',
      'privatePracticeSignal',
      'ownerOperatorSignal',
      'consultancyHeavy',
      'conditions',
      'ageRanges',
      'buyerProblems',
      'bio',
    ];

    const rows = prospects.map((prospect, index) => [
      index + 1,
      prospect.name,
      prospect.profileUrl,
      prospect.icpScore,
      prospect.primarySegment,
      prospect.matchedSegments.join(' | '),
      prospect.website,
      prospect.email,
      prospect.emailSource,
      prospect.memberSince,
      prospect.postcode,
      prospect.traits.childFocus,
      prospect.traits.adultOnly,
      prospect.traits.schoolFacing,
      prospect.traits.parentFacing,
      prospect.traits.trainingConsultancy,
      prospect.traits.telehealthSignal,
      prospect.traits.broadChildCaseload,
      prospect.traits.privatePracticeSignal,
      prospect.traits.ownerOperatorSignal,
      prospect.traits.consultancyHeavy,
      prospect.conditions.join(' | '),
      prospect.ageRanges.join(' | '),
      prospect.buyerProblems.join(' | '),
      prospect.bio,
    ]);

    return { header, rows };
  }

  async function fetchProfile(url, segment) {
    const html = await fetch(url, { credentials: 'include' }).then((response) => response.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const bodyText = clean(doc.body.innerText);

    const name = clean(doc.querySelector('h1')?.textContent || '');
    const bio =
      [...doc.querySelectorAll('p')]
        .map((paragraph) => clean(paragraph.textContent))
        .find((text) => text.length > 80 && !/^copyright|^join asltip|^main menu/i.test(text)) ||
      '';

    const website = extractWebsite(doc, url);
  const email = extractProfileEmail(doc, bodyText, website, name);

    const phone =
      [...doc.querySelectorAll('a[href^="tel:"]')]
        .map((anchor) => clean(anchor.textContent))
        .find(Boolean) || '';

    const postcode =
      [...doc.querySelectorAll('li, div, span')]
        .map((element) => clean(element.textContent))
        .find((text) => POSTCODE_RE.test(text)) || '';

    const memberSince = (bodyText.match(/Member since:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1] || '';
    const conditions = sectionItems(doc, 'Conditions treated');
    const ageRanges = sectionItems(doc, 'Age ranges treated');

    const baseProfile = {
      name,
      profileUrl: url,
      memberSince,
      postcode,
      website,
      email,
      emailSource: email ? 'profile' : '',
      hasPhone: Boolean(phone),
      bio,
      conditions,
      ageRanges,
    };

    const scored = scoreProfile(baseProfile, segment);

    return {
      ...baseProfile,
      ...scored,
      persona: buildPersona(baseProfile, scored.traits),
    };
  }

  async function collectSegmentProspects(segment, options = {}) {
    const perSegmentLimit = options.perSegmentLimit || 40;
    const perLetterLimit = options.perLetterLimit || perSegmentLimit;
    const letters = options.letters || [];
    const waitMs = options.waitMs || 1800;
    const specialitySelect = findSelect(['select.speciality', 'select[name*="speciality"]']);
    if (!specialitySelect) {
      throw new Error('Missing speciality filter on the current page.');
    }

    const surnameSelect = findSelect([
      'select.surname',
      'select[name*="surname"]',
      'select[name*="letter"]',
    ]) || inferSurnameSelect();

    const linkSet = new Set();
    const sampledLetters = [];

    const letterValues = letters.length > 0 ? letters : [null];
    for (const letter of letterValues) {
      setSelectValue(specialitySelect, segment.value);
      if (letter !== null && surnameSelect) {
        const applied = setSelectValue(surnameSelect, letter);
        if (!applied) {
          continue;
        }
        sampledLetters.push(letter);
      }

      await sleep(waitMs);

      const links = currentMemberLinks();
      const sliceLimit = letter !== null ? perLetterLimit : perSegmentLimit;
      for (const link of links.slice(0, sliceLimit)) {
        linkSet.add(link);
      }
    }

    const selectedLinks = [...linkSet].slice(0, perSegmentLimit);
    const profiles = [];
    for (const link of selectedLinks) {
      profiles.push(await fetchProfile(link, segment));
    }

    return {
      segmentKey: segment.key,
      segmentLabel: segment.label,
      directoryCount: linkSet.size,
      sampledLetters,
      profiles,
    };
  }

  function dedupeProfiles(segmentCollections) {
    const byUrl = new Map();

    for (const collection of segmentCollections) {
      for (const profile of collection.profiles) {
        const existing = byUrl.get(profile.profileUrl);
        if (!existing || profile.icpScore > existing.icpScore) {
          byUrl.set(profile.profileUrl, {
            ...profile,
            matchedSegments: unique([
              ...(existing?.matchedSegments || []),
              collection.segmentLabel,
            ]),
            primarySegment: collection.segmentLabel,
          });
        } else {
          existing.matchedSegments = unique([
            ...existing.matchedSegments,
            collection.segmentLabel,
          ]);
        }
      }
    }

    return [...byUrl.values()].sort((left, right) => right.icpScore - left.icpScore);
  }

  async function runTopProspects(options = {}) {
    const perSegmentLimit = options.perSegmentLimit || 40;
    const perLetterLimit = options.perLetterLimit || 3;
    const letters = options.letters || [];
    const topN = options.topN || 100;
    const segments = options.segments || DEFAULT_SEGMENTS;

    const segmentCollections = [];
    for (const segment of segments) {
      segmentCollections.push(
        await collectSegmentProspects(segment, {
          perSegmentLimit,
          perLetterLimit,
          letters,
          waitMs: options.waitMs,
        }),
      );
    }

    const deduped = dedupeProfiles(segmentCollections).slice(0, topN);
    const csv = buildCsvRows(deduped);

    return {
      generatedAt: new Date().toISOString(),
      source: window.location.href,
      perSegmentLimit,
      perLetterLimit,
      letters,
      totalDedupedProspects: deduped.length,
      segmentSummaries: segmentCollections.map((collection) => ({
        segmentKey: collection.segmentKey,
        segmentLabel: collection.segmentLabel,
        directoryCount: collection.directoryCount,
        sampledLetters: collection.sampledLetters,
        sampledProfiles: collection.profiles.length,
        averageScore: Math.round(
          collection.profiles.reduce((sum, profile) => sum + profile.icpScore, 0) /
            collection.profiles.length,
        ),
      })),
      prospects: deduped,
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
    DEFAULT_SEGMENTS,
    DEFAULT_SURNAME_LETTERS,
    runTopProspects,
    toCsvString,
  };
})();