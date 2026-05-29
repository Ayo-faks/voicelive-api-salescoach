"""Layer 1 — deterministic lexicon rules.

High-precision phrase / regex rules for unambiguous safeguarding
triggers. Designed to never be the sole gate but to catch the
obvious cases that no LLM should be relied upon to catch.

Rules are intentionally conservative and biased toward false
positives — anything matched here is queued for human review.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Pattern, Tuple

from .models import LayerScore, SafeguardingCategory, Severity


@dataclass(frozen=True)
class _Rule:
    category: SafeguardingCategory
    severity: Severity
    pattern: Pattern[str]


# Patterns are written for UK English first. Word boundaries used to
# avoid matching inside ordinary words ("killed it at football" must
# not trigger SUICIDE_IDEATION).
_RULES: Tuple[_Rule, ...] = (
    # Suicide ideation — explicit verbs of self-killing.
    _Rule(
        SafeguardingCategory.SUICIDE_IDEATION,
        Severity.CRITICAL,
        re.compile(
            r"\b("
            r"kill myself|killing myself|kill me|end my life|ending my life|"
            r"don'?t want to (be alive|live anymore|exist)|"
            r"want to die|wanna die|want to be dead|"
            r"suicid(e|al)|take my (own )?life|"
            r"no (point|reason) (in )?(living|being alive)"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    # Self-harm — direct verbs.
    _Rule(
        SafeguardingCategory.SELF_HARM,
        Severity.CRITICAL,
        re.compile(
            r"\b("
            r"cut(ting)? myself|hurt(ing)? myself|harm(ing)? myself|"
            r"burn(t|ed|ing)? myself|"
            r"self[-\s]?harm"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    # Abuse disclosure — adult-on-child verbs with possessive adult or
    # named role. We bias to over-trigger.
    _Rule(
        SafeguardingCategory.ABUSE_DISCLOSURE,
        Severity.CRITICAL,
        re.compile(
            r"\b("
            r"(my|step[-\s]?)?(dad|mum|mom|father|mother|uncle|aunt|cousin|"
            r"brother|sister|teacher|coach|babysitter|neighbour|neighbor)"
            r"\s+(hit|hits|hit me|hurts? me|beats? me|punched? me|kicked? me|"
            r"slapped? me|touched? me|touches? me|made me touch|"
            r"locked me|locks me|burns? me|chokes? me|strangled? me)"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    # Sexualised disclosure language from a child.
    _Rule(
        SafeguardingCategory.ABUSE_DISCLOSURE,
        Severity.CRITICAL,
        re.compile(
            r"\b("
            r"made me (touch|kiss|look at)|"
            r"touched my (private|privates|bottom|bum|chest|breast|genitals)|"
            r"showed me (his|her) (private|privates|willy|bits)|"
            r"told me not to tell"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    # Eating disorder hints.
    _Rule(
        SafeguardingCategory.EATING_DISORDER,
        Severity.HIGH,
        re.compile(
            r"\b("
            r"make myself (sick|throw up|vomit)|"
            r"haven'?t eaten (in|for) (days|a week)|"
            r"stop(ped)? eating|"
            r"too fat to eat|hate my body"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    # Substance use by a child.
    _Rule(
        SafeguardingCategory.SUBSTANCE_USE,
        Severity.HIGH,
        re.compile(
            r"\b("
            r"smoke(d|ing)? (weed|cannabis|crack|meth)|"
            r"took (some|a) (pills?|tabs?|mdma|coke|cocaine|ket(amine)?)|"
            r"got (drunk|wasted|high)|"
            r"drink(ing)? vodka"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    # Running away.
    _Rule(
        SafeguardingCategory.RUNNING_AWAY,
        Severity.HIGH,
        re.compile(
            r"\b("
            r"ran away from home|running away from home|"
            r"sleep(ing)? on the streets|sleeping rough|"
            r"haven'?t been home (in|for) (days|a week)"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    # Domestic violence — witnessed.
    _Rule(
        SafeguardingCategory.DOMESTIC_VIOLENCE,
        Severity.HIGH,
        re.compile(
            r"\b("
            r"(dad|mum|mom|stepdad|stepmum) (hits|hit|beats|punched) (mum|mom|dad)|"
            r"police came to (my )?(house|home)"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    # Grooming indicators.
    _Rule(
        SafeguardingCategory.GROOMING_INDICATORS,
        Severity.HIGH,
        re.compile(
            r"\b("
            r"(met|meet) (a guy|a man|someone) (online|on (snap|insta|tiktok|discord))|"
            r"he sent me (money|presents?|gifts?)|"
            r"asked me for (pictures?|pics?|nudes)|"
            r"sent (him|her) (a )?(picture|pic|nude)|"
            r"don'?t tell (my )?(mum|mom|dad|parents)"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    # Peer-on-peer harm / bullying.
    _Rule(
        SafeguardingCategory.PEER_ON_PEER_HARM,
        Severity.MEDIUM,
        re.compile(
            r"\b("
            r"bullied? at school|bullies? me|bully(ing)? me|"
            r"(kids|boys|girls) at school (hit|punch|kick|spit on)|"
            r"call(ed)? me (ugly|stupid|gay|fat|retarded?) every ?day"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    # Neglect disclosure.
    _Rule(
        SafeguardingCategory.NEGLECT_DISCLOSURE,
        Severity.HIGH,
        re.compile(
            r"\b("
            r"no food (at home|in the house)|"
            r"haven'?t had (a meal|dinner|breakfast) (in|for) (days|two days)|"
            r"no one to look after me|"
            r"home alone for (days|a week)"
            r")\b",
            re.IGNORECASE,
        ),
    ),
)


def run_lexicon(text: str) -> LayerScore:
    """Run all lexicon rules and return a merged ``LayerScore``.

    Returns a ``NONE`` score if no rules matched.
    """
    if not text or not text.strip():
        return LayerScore(layer="lexicon", severity=Severity.NONE)

    matched_categories: List[str] = []
    matched_spans: List[str] = []
    severity = Severity.NONE
    for rule in _RULES:
        match = rule.pattern.search(text)
        if match is None:
            continue
        if rule.category.value not in matched_categories:
            matched_categories.append(rule.category.value)
        matched_spans.append(match.group(0))
        if rule.severity.rank > severity.rank:
            severity = rule.severity

    return LayerScore(
        layer="lexicon",
        severity=severity,
        categories=tuple(matched_categories),
        raw={"matched_spans": matched_spans},
        model_version="lexicon-v1",
    )
