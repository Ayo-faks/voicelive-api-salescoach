# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Python mirror of ``frontend/src/utils/drillTokens.ts``.

The frontend owns the canonical scripted drill-token display map; this module
exists so backend consumers (TTS normaliser, scenario loaders, tests) can
reason about the same token namespace without forking the values.

When a token is added on the frontend it must be added here too; the pairing
is enforced by ``tests/unit/test_drill_tokens.py`` (which asserts the two
collections stay in sync).
"""

from __future__ import annotations

from typing import Mapping

DRILL_TOKEN_DISPLAY_MAP: Mapping[str, str] = {
    "R_RAH_MODEL": "rrr-ah, rah",
    "R_ROO_MODEL": "rrr-oo, roo",
    "R_ROW_MODEL": "rrr-oh, row",
    "R_REE_MODEL": "rrr-ee, ree",
    "K_KEY_MODEL": "k-ee, key",
    "K_COW_MODEL": "k-ow, cow",
    "K_COO_MODEL": "k-oo, coo",
    "K_KAY_MODEL": "k-ay, kay",
    "S_SEE_MODEL": "sss-ee, see",
    "S_SIGH_MODEL": "sss-eye, sigh",
    "S_SEW_MODEL": "sss-oh, sew",
    "S_SUE_MODEL": "sss-oo, sue",
    "SH_SHE_MODEL": "sh-ee, she",
    "SH_SHY_MODEL": "sh-eye, shy",
    "SH_SHOW_MODEL": "sh-oh, show",
    "SH_SHOE_MODEL": "sh-oo, shoe",
    "TH_THEE_MODEL": "th-ee, thee",
    "TH_THIGH_MODEL": "th-eye, thigh",
    "TH_THOUGH_MODEL": "th-oh, though",
    "TH_THOO_MODEL": "th-oo, thoo",
    "TH_THIN_MODEL": "th-in, thin",
    "TH_THREE_MODEL": "th-ree, three",
    "TH_THORN_MODEL": "th-orn, thorn",
    "TH_THUMB_MODEL": "th-umb, thumb",
    "F_FIN_MODEL": "fff-in, fin",
    "F_FREE_MODEL": "fff-ree, free",
    "F_FAWN_MODEL": "fff-awn, fawn",
}


def resolve_drill_token(token: str) -> str:
    """Return the display text for ``token``, or ``token`` itself if unknown."""
    return DRILL_TOKEN_DISPLAY_MAP.get(token, token)


__all__ = ["DRILL_TOKEN_DISPLAY_MAP", "resolve_drill_token"]
