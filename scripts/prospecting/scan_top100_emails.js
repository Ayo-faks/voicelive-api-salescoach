#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = '/home/ayoola/sen/voicelive-api-salescoach';
const PROSPECTING_DIR = path.join(ROOT, 'docs/prospecting');
const TOP_100_PATH = path.join(PROSPECTING_DIR, 'asltip-top-100.json');
const SHORTLIST_PATH = path.join(PROSPECTING_DIR, 'asltip-top-25-clean-shortlist.json');

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const HREF_RE = /href=["']([^"']+)["']/gi;
const EXCLUDED_EMAIL_RE =
  /office@asltip\.com|mail@example\.com|user@domain\.com|example\.com|domain\.com|sentry\.|wixpress\.com|@sentry\.io|noreply|no-reply|donotreply/i;
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'gmx.com',
  'gmx.co.uk',
  'protonmail.com',
  'btinternet.com',
  'yahoo.co.uk',
]);
const INVALID_EMAIL_TLDS = new Set(['gif', 'png', 'jpg', 'jpeg', 'svg', 'webp', 'ico', 'css', 'js', 'json', 'map', 'pdf']);
const HEADERS = { 'user-agent': 'Mozilla/5.0' };

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeEmail(email) {
  const value = clean(email).toLowerCase();
  if (!value || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) || EXCLUDED_EMAIL_RE.test(value)) {
    return '';
  }

  const domain = emailDomain(value);
  const tld = domain.split('.').pop() || '';
  if (!domain || INVALID_EMAIL_TLDS.has(tld) || /staging/i.test(domain)) {
    return '';
  }

  return value;
}

function extractEmails(text) {
  return unique((String(text || '').match(EMAIL_RE) || []).map(normalizeEmail)).filter(Boolean);
}

function extractMailtoEmails(text) {
  const mailtoRe = /mailto:([^"'?#\s>]+)/gi;
  const emails = [];
  for (const match of String(text || '').matchAll(mailtoRe)) {
    emails.push(normalizeEmail(decodeURIComponent(match[1])));
  }
  return unique(emails).filter(Boolean);
}

function emailDomain(email) {
  return email.split('@')[1] || '';
}

function businessEmail(email) {
  return !FREE_EMAIL_DOMAINS.has(emailDomain(email));
}

function likelyBusinessEmail(email) {
  return Boolean(email) && businessEmail(email) && !EXCLUDED_EMAIL_RE.test(email);
}

function likelyBusinessContact(profile) {
  if (!likelyBusinessEmail(profile.email || '')) {
    return false;
  }

  const websiteDomain = domainFromUrl(profile.website || '');
  if (!websiteDomain) {
    return true;
  }

  return emailDomain(profile.email).replace(/^www\./i, '') === websiteDomain;
}

function therapistFirstName(name) {
  return clean(name)
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .find((part) => !/^(mrs|mr|miss|ms|dr)$/i.test(part))
    ?.toLowerCase() || '';
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function websiteContactLinks(baseUrl, html) {
  const candidates = [];
  for (const match of String(html || '').matchAll(HREF_RE)) {
    try {
      const url = new URL(match[1], baseUrl).toString();
      if (/contact|about|team|get-in-touch|hello|clinic|practice/i.test(url)) {
        candidates.push(url);
      }
    } catch {
      // ignore invalid links
    }
  }
  return unique(candidates).slice(0, 4);
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    return { ok: true, url: response.url, status: response.status, text };
  } catch (error) {
    return { ok: false, url, error: String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function scoreEmail(email, profile) {
  let score = 0;
  const websiteDomain = domainFromUrl(profile.website || '');
  const firstName = therapistFirstName(profile.name);
  if (websiteDomain && email.endsWith(`@${websiteDomain}`)) score += 6;
  if (websiteDomain && !email.endsWith(`@${websiteDomain}`) && !FREE_EMAIL_DOMAINS.has(emailDomain(email))) {
    score -= 4;
  }
  if (firstName && email.includes(firstName)) score += 2;
  if (/info@|hello@|contact@|admin@/i.test(email)) score += 1;
  if (likelyBusinessEmail(email)) score += 3;
  return score;
}

function selectBestEmail(profile, profileEmails, websiteEmails) {
  const combined = unique([...websiteEmails, ...profileEmails]);
  const ranked = combined
    .map((email) => ({ email, score: scoreEmail(email, profile) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0]?.email || '';

  if (!best) {
    return { email: '', emailSource: '', allEmails: [] };
  }

  return {
    email: best,
    emailSource: websiteEmails.includes(best) ? 'website' : 'profile',
    allEmails: combined,
  };
}

function toContactCsv(rows) {
  const headers = [
    'rank',
    'name',
    'profileUrl',
    'website',
    'email',
    'emailSource',
    'allEmails',
    'icpScore',
    'shortlistScore',
    'primarySegment',
    'matchedSegments',
  ];

  const escapeCsv = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [headers.join(','), ...rows.map((row) => [
    row.rank,
    row.name,
    row.profileUrl,
    row.website || '',
    row.email || '',
    row.emailSource || '',
    (row.allEmails || []).join(' | '),
    row.icpScore ?? '',
    row.shortlistScore ?? '',
    row.primarySegment || '',
    (row.matchedSegments || []).join(' | '),
  ].map(escapeCsv).join(','))].join('\n');
}

function toProspectCsv(rows) {
  const headers = [
    'rank',
    'name',
    'profileUrl',
    'icpScore',
    'shortlistScore',
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
    'speechPracticeAligned',
    'medicallyComplex',
    'privatePracticeSignal',
    'ownerOperatorSignal',
    'consultancyHeavy',
    'ownWebsite',
    'ageRanges',
    'conditions',
    'buyerProblems',
  ];

  const escapeCsv = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [headers.join(','), ...rows.map((row) => {
    const traits = row.traits || {};
    return [
      row.rank,
      row.name,
      row.profileUrl,
      row.icpScore ?? '',
      row.shortlistScore ?? '',
      row.primarySegment || '',
      (row.matchedSegments || []).join(' | '),
      row.website || '',
      row.email || '',
      row.emailSource || '',
      row.memberSince || '',
      row.postcode || '',
      !!traits.childFocus,
      !!traits.adultOnly,
      !!traits.schoolFacing,
      !!traits.parentFacing,
      !!traits.trainingConsultancy,
      !!traits.telehealthSignal,
      !!traits.broadChildCaseload,
      !!traits.speechPracticeAligned,
      !!traits.medicallyComplex,
      !!traits.privatePracticeSignal,
      !!traits.ownerOperatorSignal,
      !!traits.consultancyHeavy,
      !!traits.ownWebsite,
      (row.ageRanges || []).join(' | '),
      (row.conditions || []).join(' | '),
      (row.buyerProblems || []).join(' | '),
    ].map(escapeCsv).join(',');
  })].join('\n');
}

async function enrichProfile(profile) {
  const profileResult = await fetchHtml(profile.profileUrl);
  const profileEmails = profileResult.ok
    ? unique([...extractEmails(profileResult.text), ...extractMailtoEmails(profileResult.text)])
    : [];

  let websiteEmails = [];
  const checkedUrls = [];
  let websiteError = '';

  if (profile.website) {
    const site = await fetchHtml(profile.website);
    checkedUrls.push(profile.website);

    if (site.ok) {
      websiteEmails.push(...extractEmails(site.text), ...extractMailtoEmails(site.text));
      const contactLinks = websiteContactLinks(site.url, site.text);

      for (const link of contactLinks) {
        const page = await fetchHtml(link);
        checkedUrls.push(link);
        if (page.ok) {
          websiteEmails.push(...extractEmails(page.text), ...extractMailtoEmails(page.text));
        }
      }
    } else {
      websiteError = site.error || '';
    }
  }

  websiteEmails = unique(websiteEmails).filter(Boolean);
  const selected = selectBestEmail(profile, profileEmails, websiteEmails);

  return {
    enrichedProfile: {
      ...profile,
      email: selected.email,
      emailSource: selected.emailSource,
    },
    contactRecord: {
      ...profile,
      email: selected.email,
      emailSource: selected.emailSource,
      allEmails: selected.allEmails,
      scanMeta: {
        profileEmails,
        websiteEmails,
        checkedUrls,
        websiteError,
      },
    },
  };
}

async function main() {
  const top100 = readJson(TOP_100_PATH);
  const shortlist = readJson(SHORTLIST_PATH);

  const enrichedTop100 = [];
  const contactRecordsTop100 = [];
  for (const profile of top100.prospects) {
    const result = await enrichProfile(profile);
    enrichedTop100.push(result.enrichedProfile);
    contactRecordsTop100.push(result.contactRecord);
  }

  const byUrl = new Map(contactRecordsTop100.map((profile) => [profile.profileUrl, profile]));
  const enrichedShortlist = shortlist.prospects.map((profile) => ({
    ...profile,
    email: byUrl.get(profile.profileUrl)?.email || '',
    emailSource: byUrl.get(profile.profileUrl)?.emailSource || '',
    shortlistScore: profile.shortlistScore,
    outreachSegment: profile.outreachSegment,
  }));
  const contactRecordsTop25 = shortlist.prospects.map((profile) => ({
    ...profile,
    ...(byUrl.get(profile.profileUrl) || {}),
    shortlistScore: profile.shortlistScore,
    outreachSegment: profile.outreachSegment,
  }));

  const businessContacts100 = contactRecordsTop100.filter((profile) => likelyBusinessContact(profile));
  const businessContacts25 = contactRecordsTop25.filter((profile) => likelyBusinessContact(profile));

  writeJson(TOP_100_PATH, {
    ...top100,
    generatedAt: new Date().toISOString(),
    emailScanApplied: true,
    prospects: enrichedTop100,
  });

  writeJson(SHORTLIST_PATH, {
    ...shortlist,
    generatedAt: new Date().toISOString(),
    emailScanApplied: true,
    prospects: enrichedShortlist,
  });

  fs.writeFileSync(path.join(PROSPECTING_DIR, 'asltip-email-contacts-top-100.csv'), `${toContactCsv(businessContacts100)}\n`);
  fs.writeFileSync(path.join(PROSPECTING_DIR, 'asltip-email-contacts-top-25.csv'), `${toContactCsv(businessContacts25)}\n`);
  writeJson(path.join(PROSPECTING_DIR, 'asltip-email-contacts-top-100.json'), {
    generatedAt: new Date().toISOString(),
    total: businessContacts100.length,
    contacts: businessContacts100,
  });
  writeJson(path.join(PROSPECTING_DIR, 'asltip-email-contacts-top-25.json'), {
    generatedAt: new Date().toISOString(),
    total: businessContacts25.length,
    contacts: businessContacts25,
  });

  fs.writeFileSync(path.join(PROSPECTING_DIR, 'asltip-top-100.csv'), `${toProspectCsv(enrichedTop100)}\n`);
  fs.writeFileSync(path.join(PROSPECTING_DIR, 'asltip-top-25-clean-shortlist.csv'), `${toProspectCsv(enrichedShortlist)}\n`);

  console.log('enrichedTop100', enrichedTop100.length);
  console.log('businessContacts100', businessContacts100.length);
  console.log('businessContacts25', businessContacts25.length);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});