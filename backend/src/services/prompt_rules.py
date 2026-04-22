# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Shared system-prompt rules appended to agent / planner / Voice Live instructions.

These rules are phoneme-agnostic and cover the full target-sound inventory used
across Wulo exercises, not only ``/th/``. They are appended at three sites:

* ``AgentManager.BASE_INSTRUCTIONS`` — flows to every agent built by
  :class:`src.services.managers.AgentManager`.
* ``VoiceProxyHandler._combine_instructions`` — appended after runtime
  personalisation so it survives per-session personalisation merges.
* ``PracticePlanningService._build_system_message`` — keeps the planner from
  emitting exercise copy that spells phonemes out as letters.
"""

from __future__ import annotations

PHONEME_CITATION_RULE = """\
PHONEME CITATION RULES (applies to every target sound, every exercise):
- Never spell a target phoneme as individual letters. Do not voice letter names
  in place of a sound — not "tee aitch" for /th/, not "ess aitch" for /sh/, not
  "see aitch" for /ch/, not "doubleyou" for /w/, not "kay" for /k/, not "zee
  aitch" for /zh/, not "en gee" for /ng/, and so on for every sound.
- In scripted drill turns, emit the exact app token the scenario provides
  (for example TH_SOUND_MODEL, R_RAH_MODEL, S_SEE_MODEL). Never substitute a
  letter spelling for a drill token.
- In conversation, wrap the sound in SSML:
  <phoneme alphabet="ipa" ph="...">sound</phoneme>, using the IPA symbol for
  that phoneme (for example ph="θ" for voiceless /th/, ph="ð" for voiced /dh/,
  ph="ʃ" for /sh/, ph="ɹ" for /r/).
- If SSML is unavailable, use an anchor word instead ("the sound at the start
  of *think*", "*sheep*", "*rabbit*", "*key*", "*fish*", "*sun*").
- This rule applies to every phoneme in every exercise, including minimal-pair
  contrasts (s vs sh, th vs f, k vs t, r vs w) and voicing pairs (voiceless th
  vs voiced dh, s vs z, f vs v). Speak BOTH sides of a contrast using the rules
  above; never letter-name either side."""


def append_phoneme_rule(base: str | None) -> str:
    """Append :data:`PHONEME_CITATION_RULE` to ``base`` idempotently.

    The rule is only appended once; callers may pass already-augmented
    instructions without risk of duplication. An empty or ``None`` base yields
    the rule on its own. The base is preserved verbatim (including any leading
    or trailing whitespace) so substring checks against the original base
    continue to pass.
    """
    if base is None or not str(base).strip():
        return PHONEME_CITATION_RULE
    base_str = str(base)
    if PHONEME_CITATION_RULE in base_str:
        return base_str
    separator = "" if base_str.endswith("\n") else "\n\n"
    return f"{base_str}{separator}{PHONEME_CITATION_RULE}"


__all__ = ["PHONEME_CITATION_RULE", "append_phoneme_rule"]
