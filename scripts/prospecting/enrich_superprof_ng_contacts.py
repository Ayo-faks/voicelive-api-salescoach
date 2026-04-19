#!/usr/bin/env python3

import html
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/home/ayoola/sen/voicelive-api-salescoach')
PROSPECTING_DIR = ROOT / 'docs' / 'prospecting'
SHORTLIST_PATH = PROSPECTING_DIR / 'superprof-ng-top-25-clean-shortlist.json'
OUT_JSON = PROSPECTING_DIR / 'superprof-ng-contact-enrichment.json'
OUT_CSV = PROSPECTING_DIR / 'superprof-ng-contact-enrichment.csv'
ENRICHED_OUTREACH_CSV = PROSPECTING_DIR / 'superprof-ng-top-25-founder-outreach-enriched.csv'
MANUAL_CONTACTS_PATH = PROSPECTING_DIR / 'superprof-ng-manual-contacts.json'

HEADERS = {
    'User-Agent': 'Mozilla/5.0',
}

SOCIAL_DOMAINS = {
    'facebook.com', 'www.facebook.com',
    'instagram.com', 'www.instagram.com',
    'linkedin.com', 'www.linkedin.com', 'ng.linkedin.com',
    'x.com', 'www.x.com',
    'twitter.com', 'www.twitter.com',
    'tiktok.com', 'www.tiktok.com',
}

EXCLUDED_DOMAINS = {
    'duckduckgo.com', 'www.duckduckgo.com',
    'superprof.ng', 'www.superprof.ng',
    'superprof.com', 'www.superprof.com',
    'superprof.co.in', 'www.superprof.co.in',
    'superprof.com.au', 'www.superprof.com.au',
    'superprof.co.za', 'www.superprof.co.za',
    'superprof.co.uk', 'www.superprof.co.uk',
    'careersngr.com', 'www.careersngr.com',
    'msn.com', 'www.msn.com',
    'telegraph.co.uk', 'www.telegraph.co.uk',
    'psychologytoday.com', 'www.psychologytoday.com',
}

DIRECTORY_DOMAINS = {
    'upskillstutor.com.ng', 'www.upskillstutor.com.ng',
    'jiji.ng', 'www.jiji.ng',
    'classes.ng', 'www.classes.ng',
    'cybo.com', 'www.cybo.com',
    'africabz.com', 'www.africabz.com', 'ng.africabz.com',
    'medpages.info', 'www.medpages.info',
    'findhealthclinics.com', 'www.findhealthclinics.com',
    'nigeria24.me', 'www.nigeria24.me',
    'poidata.io', 'www.poidata.io',
    'infoisinfo.ng', 'www.infoisinfo.ng', 'lagos.infoisinfo.ng',
}

EXCLUDED_EMAIL_RE = re.compile(
    r'gmail\.com$|yahoo\.com$|hotmail\.com$|outlook\.com$|buki\.com|example\.com|noreply|no-reply|donotreply',
    re.I,
)
EMAIL_RE = re.compile(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', re.I)
HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)


def clean(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def first_name(name):
    return clean(name).split()[0] if clean(name) else ''


def last_name(name):
    parts = clean(name).split()
    return parts[-1] if len(parts) > 1 else ''


def domain_from_url(url):
    try:
        return urllib.parse.urlparse(url).netloc.lower()
    except Exception:
        return ''


def display_location(profile):
    direct = clean(profile.get('location'))
    if direct:
        return direct

    lesson_location = clean(profile.get('lessonLocation'))
    house_match = re.search(r'house:\s*([^:]+?)(?:\s+webcam|\s+at home|$)', lesson_location, re.I)
    if house_match:
        return clean(house_match.group(1))

    travel_match = re.search(r'from\s+([^,]+)$', lesson_location, re.I)
    if travel_match:
        return clean(travel_match.group(1))

    for label in ['Lagos', 'Ikeja', 'Abuja Municipal', 'Port Harcourt', 'Ife', 'Durumi']:
        if label.lower() in lesson_location.lower():
            return label

    return ''


def search_name_variants(profile):
    variants = [clean(profile.get('name'))]
    bio = clean(profile.get('bio'))
    patterns = [
        r"(?:I['’]?m|I am|Hello!?\s*I['’]?m)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})",
        r"My name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})",
        r"^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+[—-]",
    ]
    for pattern in patterns:
        match = re.search(pattern, bio)
        if match:
            variants.append(clean(match.group(1)))
    deduped = []
    seen = set()
    for variant in variants:
        key = variant.lower()
        if variant and key not in seen:
            seen.add(key)
            deduped.append(variant)
    return deduped


def fetch_text(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read().decode('utf-8', 'ignore')


def decode_ddg_url(url):
    normalized = f'https:{url}' if url.startswith('//') else url
    parsed = urllib.parse.urlparse(normalized)
    query = urllib.parse.parse_qs(parsed.query)
    uddg = query.get('uddg', [''])[-1]
    return urllib.parse.unquote(uddg) if uddg else normalized


def result_type(url):
    domain = domain_from_url(url)
    if domain in SOCIAL_DOMAINS:
        return 'social'
    if domain in DIRECTORY_DOMAINS:
        return 'directory'
    return 'website'


def is_excluded_domain(domain):
    normalized = clean(domain).lower()
    return bool(
        normalized in EXCLUDED_DOMAINS
        or normalized.startswith('superprof.')
        or '.superprof.' in normalized
    )


def has_strong_speech_relevance(text):
    normalized = clean(text).lower()
    return bool(re.search(
        r'speech(?:\s|&|/|-)*(?:and\s+language|language)?|speech\s+therap(?:y|ist)|language\s+therap(?:y|ist)|speech[- ]language|articulation|audiolog|communication\s+(?:needs|delay|difficult|disorder)|slt\b',
        normalized,
        re.I,
    ))


def score_candidate(url, title, profile):
    domain = domain_from_url(url)
    if not domain or is_excluded_domain(domain):
        return -999

    text = f'{clean(title)} {url}'.lower()
    first = first_name(profile['name']).lower()
    last = last_name(profile['name']).lower()
    city = display_location(profile).lower()

    score = 18 if result_type(url) == 'website' else 12 if result_type(url) == 'social' else 4
    if first and first in text:
        score += 10
    if last and last in text:
        score += 12
    if re.search(r'speech|language|therapy|therapist|patholog|audiology|communication|clinic', text, re.I):
        score += 12
    if city and city in text:
        score += 6
    if result_type(url) == 'directory':
        score -= 10
    if re.search(r'upskill|jiji|cybo|africabz|medpages', domain, re.I):
        score -= 6
    if not has_strong_speech_relevance(text):
        score -= 12
    return score


def candidate_name_match(url, title, profile):
    text = f'{clean(title)} {clean(url)}'.lower()
    tokens = set()
    full_variants = []
    for variant in search_name_variants(profile):
        normalized = variant.lower()
        if ' ' in normalized:
            full_variants.append(normalized)
        for token in re.split(r'[^a-z0-9]+', variant.lower()):
            if len(token) >= 4:
                tokens.add(token)
    if any(variant in text for variant in full_variants):
        return True

    matched_tokens = [token for token in tokens if token in text]
    if len(tokens) >= 2:
        return len(matched_tokens) >= 2

    if len(tokens) == 1:
        return bool(matched_tokens) and has_strong_speech_relevance(text)

    return False


def parse_bing_results(search_html, profile):
    results = []
    result_re = re.compile(r'<li[^>]+class="b_algo"[\s\S]*?<h2><a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.I)
    for href, title_html in result_re.findall(search_html):
        url = html.unescape(href)
        title = clean(re.sub(r'<[^>]+>', ' ', html.unescape(title_html)))
        score = score_candidate(url, title, profile)
        if score < 0:
            continue
        results.append({
            'url': url,
            'title': title,
            'domain': domain_from_url(url),
            'type': result_type(url),
            'score': score,
            'nameMatch': candidate_name_match(url, title, profile),
        })
    deduped = {}
    for result in results:
        existing = deduped.get(result['url'])
        if not existing or result['score'] > existing['score']:
            deduped[result['url']] = result
    return sorted(deduped.values(), key=lambda item: item['score'], reverse=True)


def parse_ddg_results(search_html, profile):
    results = []
    result_re = re.compile(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.I | re.S)
    for href, title_html in result_re.findall(search_html):
        url = decode_ddg_url(html.unescape(href))
        title = clean(re.sub(r'<[^>]+>', ' ', html.unescape(title_html)))
        score = score_candidate(url, title, profile)
        if score < 0:
            continue
        results.append({
            'url': url,
            'title': title,
            'domain': domain_from_url(url),
            'type': result_type(url),
            'score': score,
            'nameMatch': candidate_name_match(url, title, profile),
        })
    deduped = {}
    for result in results:
        existing = deduped.get(result['url'])
        if not existing or result['score'] > existing['score']:
            deduped[result['url']] = result
    return sorted(deduped.values(), key=lambda item: item['score'], reverse=True)


def extract_emails(page_text, candidate_url=''):
    candidate_domain = domain_from_url(candidate_url).replace('www.', '')
    emails = []
    seen = set()
    for match in EMAIL_RE.findall(page_text or ''):
        email = clean(match).lower()
        if not email or email in seen or EXCLUDED_EMAIL_RE.search(email):
            continue
        if '/' in email or '\\' in email or email.startswith('u00'):
            continue
        local_part, _, domain_part = email.partition('@')
        if not local_part or not domain_part:
            continue
        if re.search(r'\.(png|jpg|jpeg|gif|svg|webp|ico)$', local_part, re.I):
            continue
        if re.search(r'^(?:\d+x\.)?(png|jpg|jpeg|gif|svg|webp|ico)$', domain_part, re.I):
            continue
        if candidate_domain and domain_from_url(f'https://{email.split("@")[-1]}').replace('www.', '') and domain_from_url(candidate_url) in DIRECTORY_DOMAINS:
            if not email.endswith(f'@{candidate_domain}'):
                continue
        seen.add(email)
        emails.append(email)
    return emails


def contact_links(base_url, page_html):
    links = []
    for href in HREF_RE.findall(page_html or ''):
        try:
            url = urllib.parse.urljoin(base_url, href)
            if re.search(r'contact|about|team|get-in-touch|hello|practice|clinic', url, re.I):
                links.append(url)
        except Exception:
            continue
    deduped = []
    seen = set()
    for link in links:
        if link not in seen:
            seen.add(link)
            deduped.append(link)
    return deduped[:4]


def search_candidates(profile):
    city = display_location(profile)
    deduped = {}
    name_variants = search_name_variants(profile)

    ddg_queries = []
    for variant in name_variants:
        ddg_queries.extend([
            f'{variant} speech therapist {city}',
            f'{variant} speech therapy {city or "Nigeria"}',
            f'{variant} speech and language therapist Nigeria',
        ])

    for query in ddg_queries[:6]:
        url = 'https://html.duckduckgo.com/html/?q=' + urllib.parse.quote(query)
        try:
            page = fetch_text(url)
        except Exception:
            continue
        if 'anomaly-modal' in page:
            continue
        for result in parse_ddg_results(page, profile):
            existing = deduped.get(result['url'])
            if not existing or result['score'] > existing['score']:
                deduped[result['url']] = result

    if not deduped:
        bing_queries = [
            f'{name_variants[0]} speech therapist {city} Nigeria',
            f'{name_variants[0]} speech therapy {city or "Nigeria"}',
        ]
        for query in bing_queries:
            url = 'https://www.bing.com/search?q=' + urllib.parse.quote(query)
            try:
                page = fetch_text(url)
            except Exception:
                continue
            for result in parse_bing_results(page, profile):
                existing = deduped.get(result['url'])
                if not existing or result['score'] > existing['score']:
                    deduped[result['url']] = result
    return sorted(deduped.values(), key=lambda item: item['score'], reverse=True)[:8]


def enrich_candidate(candidate):
    if candidate['type'] == 'social':
        candidate['emails'] = []
        candidate['fetchedPages'] = []
        return candidate

    fetched_pages = []
    emails = []
    seen_emails = set()
    try:
        html_text = fetch_text(candidate['url'])
        fetched_pages.append(candidate['url'])
        for email in extract_emails(html_text, candidate['url']):
            if email not in seen_emails:
                seen_emails.add(email)
                emails.append(email)
        for link in contact_links(candidate['url'], html_text):
            try:
                page_text = fetch_text(link)
                fetched_pages.append(link)
                for email in extract_emails(page_text, candidate['url']):
                    if email not in seen_emails:
                        seen_emails.add(email)
                        emails.append(email)
            except Exception:
                continue
    except Exception:
        pass

    candidate['emails'] = emails
    candidate['fetchedPages'] = fetched_pages
    return candidate


def confidence(record):
    if record.get('publicEmail'):
        return 'high'
    if record.get('website') or record.get('socials'):
        return 'medium'
    return 'low'


def to_csv(rows):
    return '\n'.join(','.join('"' + str(value or '').replace('"', '""') + '"' for value in row) for row in rows)


def load_manual_contacts():
    if not MANUAL_CONTACTS_PATH.exists():
        return {}
    payload = json.loads(MANUAL_CONTACTS_PATH.read_text())
    contacts = payload.get('contacts', [])
    return {clean(contact.get('name')): contact for contact in contacts if clean(contact.get('name'))}


def main():
    shortlist = json.loads(SHORTLIST_PATH.read_text())['prospects']
    manual_contacts = load_manual_contacts()
    enriched = []

    for profile in shortlist:
        override = manual_contacts.get(clean(profile.get('name')))
        if override:
            website_url = clean(override.get('website'))
            socials = [clean(item) for item in override.get('socials', []) if clean(item)][:3]
            public_email = clean(override.get('publicEmail'))
            public_email_source = clean(override.get('publicEmailSource'))
            best_contact_url = clean(override.get('bestContactUrl')) or website_url or (socials[0] if socials else '')
            best_contact_type = clean(override.get('bestContactType')) or ('website' if website_url else 'social' if socials else '')
            detailed = override.get('contactCandidates', [])
            enrichment_confidence = clean(override.get('enrichmentConfidence')) or confidence({
                'publicEmail': public_email,
                'website': website_url,
                'socials': socials,
            })
            website = {'url': website_url} if website_url else None
        else:
            candidates = search_candidates(profile)
            detailed = [enrich_candidate(candidate) for candidate in candidates[:5]]
            website = next((candidate for candidate in detailed if candidate['type'] == 'website' and candidate.get('nameMatch')), None)
            socials = [candidate['url'] for candidate in detailed if candidate['type'] == 'social' and candidate.get('nameMatch')][:3]
            directories = [candidate for candidate in detailed if candidate['type'] == 'directory']
            public_email = website['emails'][0] if website and website.get('emails') else ''
            public_email_source = 'website-search' if public_email else ''
            if not public_email:
                for candidate in directories:
                    if candidate.get('emails') and candidate.get('nameMatch'):
                        public_email = candidate['emails'][0]
                        public_email_source = 'directory-search'
                        break
            best_contact = website or next((candidate for candidate in detailed if candidate['type'] == 'social' and candidate.get('nameMatch')), None) or next((candidate for candidate in directories if candidate.get('emails') and candidate.get('nameMatch')), None)
            best_contact_url = best_contact['url'] if best_contact else ''
            best_contact_type = best_contact['type'] if best_contact else ''
            enrichment_confidence = confidence({
                'publicEmail': public_email,
                'website': website['url'] if website else '',
                'socials': socials,
            })

        enriched.append({
            **profile,
            'displayLocation': display_location(profile),
            'website': website['url'] if website else '',
            'websiteDomain': domain_from_url(website['url']) if website else '',
            'publicEmail': public_email,
            'publicEmailSource': public_email_source,
            'socials': socials,
            'bestContactUrl': best_contact_url,
            'bestContactType': best_contact_type,
            'enrichmentConfidence': enrichment_confidence,
            'contactCandidates': detailed,
        })

    OUT_JSON.write_text(json.dumps({
        'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'source': str(SHORTLIST_PATH),
        'total': len(enriched),
        'contacts': enriched,
    }, indent=2) + '\n')

    csv_rows = [[
        'rank', 'name', 'displayLocation', 'shortlistScore', 'website', 'publicEmail', 'publicEmailSource',
        'bestContactUrl', 'bestContactType', 'socials', 'enrichmentConfidence', 'profileUrl',
    ]]
    outreach_rows = [[
        'rank', 'sendStatus', 'firstName', 'fullName', 'displayLocation', 'publicEmail', 'publicEmailSource',
        'bestContactUrl', 'bestContactType', 'socials', 'shortlistScore', 'profileUrl',
    ]]
    for index, profile in enumerate(enriched, start=1):
        csv_rows.append([
            index,
            profile['name'],
            profile['displayLocation'],
            profile.get('shortlistScore', ''),
            profile.get('website', ''),
            profile.get('publicEmail', ''),
            profile.get('publicEmailSource', ''),
            profile.get('bestContactUrl', ''),
            profile.get('bestContactType', ''),
            ' | '.join(profile.get('socials', [])),
            profile.get('enrichmentConfidence', ''),
            profile['profileUrl'],
        ])
        outreach_rows.append([
            index,
            'ready-to-send' if profile.get('publicEmail') else 'needs-manual-route' if profile.get('bestContactUrl') else 'no-contact-found',
            first_name(profile['name']),
            profile['name'],
            profile['displayLocation'],
            profile.get('publicEmail', ''),
            profile.get('publicEmailSource', ''),
            profile.get('bestContactUrl', ''),
            profile.get('bestContactType', ''),
            ' | '.join(profile.get('socials', [])),
            profile.get('shortlistScore', ''),
            profile['profileUrl'],
        ])

    OUT_CSV.write_text(to_csv(csv_rows) + '\n')
    ENRICHED_OUTREACH_CSV.write_text(to_csv(outreach_rows) + '\n')


if __name__ == '__main__':
    main()