"""Chunk raw source blocks into subtopic-sized candidate nodes.

One chunk becomes one candidate :class:`WikiNode`. Chunks are kept in the
~80–200 word band so a learner gets a focused, single-subtopic explanation.

Clean-room notes authored at subtopic granularity usually pass through as a
single chunk. Longer source blocks (e.g. a future Siyavula section) are split on
paragraph boundaries, greedily packing paragraphs up to the max word budget.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, Iterator, List

from .sources import CurriculumKey, LicenseInfo, RawBlock

MIN_WORDS = 40
TARGET_MIN_WORDS = 80
MAX_WORDS = 200


def _word_count(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text))


def _split_paragraphs(text: str) -> List[str]:
    parts = re.split(r"\n\s*\n", text.strip())
    return [p.strip() for p in parts if p.strip()]


@dataclass(frozen=True)
class Chunk:
    """A subtopic-sized unit ready for safety review and emission."""

    key: CurriculumKey
    title: str
    text: str
    license: LicenseInfo
    word_count: int
    metadata: Dict[str, str] = field(default_factory=dict)


def chunk_block(block: RawBlock) -> Iterator[Chunk]:
    """Yield one or more chunks for a raw block.

    A block whose body already fits the word band yields a single chunk. Longer
    bodies are greedily packed paragraph-by-paragraph up to ``MAX_WORDS``.
    """
    paragraphs = _split_paragraphs(block.text)
    if not paragraphs:
        return

    buffer: List[str] = []
    buffer_words = 0
    part_index = 0

    def flush() -> Iterator[Chunk]:
        nonlocal buffer, buffer_words, part_index
        if not buffer:
            return
        text = "\n\n".join(buffer).strip()
        wc = _word_count(text)
        title = block.title if part_index == 0 else f"{block.title} (part {part_index + 1})"
        meta = dict(block.metadata)
        yield Chunk(
            key=block.key,
            title=title,
            text=text,
            license=block.license,
            word_count=wc,
            metadata=meta,
        )
        part_index += 1
        buffer = []
        buffer_words = 0

    for para in paragraphs:
        pwords = _word_count(para)
        if buffer and buffer_words + pwords > MAX_WORDS:
            yield from flush()
        buffer.append(para)
        buffer_words += pwords

    yield from flush()


def chunk_blocks(blocks: Iterable[RawBlock]) -> Iterator[Chunk]:
    for block in blocks:
        yield from chunk_block(block)
