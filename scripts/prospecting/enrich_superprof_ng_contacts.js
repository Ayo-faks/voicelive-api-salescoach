#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = '/home/ayoola/sen/voicelive-api-salescoach';
const PROSPECTING_DIR = path.join(ROOT, 'docs/prospecting');
const SHORTLIST_PATH = path.join(PROSPECTING_DIR, 'superprof-ng-top-25-clean-shortlist.json');
const OUT_JSON = path.join(PROSPECTING_DIR, 'superprof-ng-contact-enrichment.json');
const OUT_CSV = path.join(PROSPECTING_DIR, 'superprof-ng-contact-enrichment.csv');
const ENRICHED_OUTREACH_CSV = path.join(PROSPECTING_DIR, 'superprof-ng-top-25-founder-outreach-enriched.csv');

const SEARCH_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

const SOCIAL_DOMAINS = new Set([
  'facebook.com',
  'www.facebook.com',
  'instagram.com',
  'www.instagram.com',
  'linkedin.com',
  'www.linkedin.com',
  'ng.linkedin.com',
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'tiktok.com',
  'www.tiktok.com',
]);

const EXCLUDED_DOMAINS = new Set([
  'duckduckgo.com',
  'www.duckduckgo.com',
  'superprof.ng',
  'www.superprof.ng',
  'superprof.com',
  'www.superprof.com',
  'superprof.co.in',
  'www.superprof.co.in',
  'superprof.com.au',
  'www.superprof.com.au',
  'superprof.co.za',
  'www.superprof.co.za',
]);

const DIRECTORY_DOMAINS = new Set([
  'upskillstutor.com.ng',
  'www.upskillstutor.com.ng',
  'jiji.ng',
  'www.jiji.ng',
  'cybo.com',
  'www.cybo.com',
  'ng.africabz.com',
  'africabz.com',
  'www.africabz.com',
  'medpages.info',
  'www.medpages.info',
]);

const EXCLUDED_EMAIL_RE =
  /gmail\.com$|yahoo\.com$|hotmail\.com$|outlook\.com$|buki\.com|example\.com|noreply|no-reply|donotreply/i;

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

function lastName(name) {
  const parts = clean(name).split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function slugTokens(value) {
  return clean(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
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

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function decodeDuckDuckGoUrl(url) {
  try {
    const normalized = url.startsWith('//') ? `https:${url}` : url;
    const parsed = new URL(normalized);
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : normalized;
  } catch {
    return url;
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: SEARCH_HEADERS,
    redirect: 'follow',
  });
  return await response.text();
}

function stripTags(html) {
  return clean(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

function extractEmails(text, candidateUrl = '') {
  const candidateDomain = domainFromUrl(candidateUrl);
  const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const seen = new Set();
  const valid = [];
  for (const raw of matches) {
    const email = clean(raw).toLowerCase();
    if (!email || seen.has(email) || EXCLUDED_EMAIL_RE.test(email)) continue;
    if (candidateDomain && !email.endsWith(`@${candidateDomain.replace(/^www\./, '')}`) && DIRECTORY_DOMAINS.has(candidateDomain)) {
      continue;
    }
    seen.add(email);
    valid.push(email);
  }
  return valid;
}

function contactLinks(baseUrl, html) {
  const links = [];
  const hrefRe = /href=["']([^"']+)["']/gi;
  for (const match of html.matchAll(hrefRe)) {
    try {
      const url = new URL(match[1], baseUrl).toString();
      if (/contact|about|team|get-in-touch|hello|practice|clinic/i.test(url)) {
        links.push(url);
      }
    } catch {
      // ignore
    }
  }
  return [...new Set(links)].slice(0, 4);
}

function resultType(url) {
  const domain = domainFromUrl(url);
  if (SOCIAL_DOMAINS.has(domain)) return 'social';
  if (DIRECTORY_DOMAINS.has(domain)) return 'directory';
  return 'website';
}

function scoreCandidate(url, title, profile) {
  const domain = domainFromUrl(url);
  if (!domain || EXCLUDED_DOMAINS.has(domain)) return -999;

  const fullText = `${clean(title)} ${url}`.toLowerCase();
  const type = resultType(url);
  const first = firstName(profile.name).toLowerCase();
  const last = lastName(profile.name).toLowerCase();
  const city = displayLocation(profile).toLowerCase();

  let score = type === 'website' ? 18 : type === 'social' ? 12 : 4;
  if (first && fullText.includes(first)) score += 10;
  if (last && fullText.includes(last)) score += 12;
  if (/speech|language|therapy|therapist|patholog|audiology|communication|clinic/i.test(fullText)) score += 12;
  if (city && fullText.includes(city)) score += 6;
  if (type === 'social' && /facebook|instagram|linkedin/i.test(domain)) score += 4;
  if (type === 'directory') score -= 10;
  if (/upskill|jiji|cybo|africabz|medpages/i.test(domain)) score -= 6;

  return score;
}

function parseSearchResults(html, profile) {
  const results = [];
  const resultRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(resultRe)) {
    const rawUrl = clean(match[1]);
    const url = decodeDuckDuckGoUrl(rawUrl);
    const title = stripTags(match[2]);
    const score = scoreCandidate(url, title, profile);
    if (score < 0) continue;
    results.push({
      url,
      title,
      domain: domainFromUrl(url),
      type: resultType(url),
      score,
    });
  }
  return results;
}

async function searchCandidates(profile) {
  const city = displayLocation(profile);
  const queries = [
    `"${profile.name}" speech therapist ${city} Nigeria`,
    `"${profile.name}" speech therapy ${city || 'Nigeria'}`,
    `"${profile.name}" speech and language therapist Nigeria`,
  ];

  const deduped = new Map();
  for (const query of queries) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    try {
      const html = await fetchText(url);
      const results = parseSearchResults(html, profile);
      for (const result of results) {
        const existing = deduped.get(result.url);
        if (!existing || result.score > existing.score) {
          deduped.set(result.url, result);
        }
      }
    } catch {
      // ignore failed search pass
    }
  }

  return [...deduped.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

async function enrichCandidate(candidate) {
  if (candidate.type === 'social') {
    return {
      ...candidate,
      emails: [],
      fetchedPages: [],
    };
  }

  const fetchedPages = [];
  const emails = new Set();
  try {
    const html = await fetchText(candidate.url);
    fetchedPages.push(candidate.url);
    for (const email of extractEmails(html, candidate.url)) emails.add(email);
    for (const link of contactLinks(candidate.url, html)) {
      try {
        const pageHtml = await fetchText(link);
        fetchedPages.push(link);
        for (const email of extractEmails(pageHtml, candidate.url)) emails.add(email);
      } catch {
        // ignore subpage failures
      }
    }
  } catch {
    // ignore fetch failures
  }

  return {
    ...candidate,
    emails: [...emails],
    fetchedPages,
  };
}

function enrichmentConfidence(record) {
  if (record.publicEmail) return 'high';
  if (record.website || (record.socials || []).length > 0) return 'medium';
  return 'low';
}

function toCsv(rows) {
  return rows
    .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

async function main() {
  const shortlist = readJson(SHORTLIST_PATH).prospects || [];
  const enriched = [];

  for (const profile of shortlist) {
    const candidates = await searchCandidates(profile);
    const detailedCandidates = [];
    for (const candidate of candidates.slice(0, 5)) {
      detailedCandidates.push(await enrichCandidate(candidate));
    }

    const website = detailedCandidates.find((candidate) => candidate.type === 'website');
    const socials = detailedCandidates.filter((candidate) => candidate.type === 'social').map((candidate) => candidate.url).slice(0, 3);
    const directories = detailedCandidates.filter((candidate) => candidate.type === 'directory');
    const publicEmail = website?.emails?.[0] || directories.flatMap((candidate) => candidate.emails || [])[0] || '';
    const bestContact = website || detailedCandidates.find((candidate) => candidate.type === 'social') || directories[0] || null;

    enriched.push({
      ...profile,
      displayLocation: displayLocation(profile),
      website: website?.url || '',
      websiteDomain: website ? domainFromUrl(website.url) : '',
      publicEmail,
      publicEmailSource: publicEmail ? (website?.emails?.[0] ? 'website-search' : 'directory-search') : '',
      socials,
      bestContactUrl: bestContact?.url || '',
      bestContactType: bestContact?.type || '',
      enrichmentConfidence: enrichmentConfidence({ publicEmail, website: website?.url, socials }),
      contactCandidates: detailedCandidates,
    });
  }

  writeJson(OUT_JSON, {
    generatedAt: new Date().toISOString(),
    source: SHORTLIST_PATH,
    total: enriched.length,
    contacts: enriched,
  });

  const csvRows = [
    [
      'rank',
      'name',
      'displayLocation',
      'shortlistScore',
      'website',
      'publicEmail',
      'publicEmailSource',
      'bestContactUrl',
      'bestContactType',
      'socials',
      'enrichmentConfidence',
      'profileUrl',
    ],
    ...enriched.map((profile, index) => [
      index + 1,
      profile.name,
      profile.displayLocation,
      profile.shortlistScore,
      profile.website,
      profile.publicEmail,
      profile.publicEmailSource,
      profile.bestContactUrl,
      profile.bestContactType,
      profile.socials.join(' | '),
      profile.enrichmentConfidence,
      profile.profileUrl,
    ]),
  ];
  fs.writeFileSync(OUT_CSV, `${toCsv(csvRows)}\n`);

  const outreachRows = [
    [
      'rank',
      'sendStatus',
      'firstName',
      'fullName',
      'displayLocation',
      'publicEmail',
      'publicEmailSource',
      'bestContactUrl',
      'bestContactType',
      'socials',
      'shortlistScore',
      'profileUrl',
    ],
    ...enriched.map((profile, index) => [
      index + 1,
      profile.publicEmail ? 'ready-to-send' : profile.bestContactUrl ? 'needs-manual-route' : 'no-contact-found',
      firstName(profile.name),
      profile.name,
      profile.displayLocation,
      profile.publicEmail,
      profile.publicEmailSource,
      profile.bestContactUrl,
      profile.bestContactType,
      profile.socials.join(' | '),
      profile.shortlistScore,
      profile.profileUrl,
    ]),
  ];
  fs.writeFileSync(ENRICHED_OUTREACH_CSV, `${toCsv(outreachRows)}\n`);
}

main();