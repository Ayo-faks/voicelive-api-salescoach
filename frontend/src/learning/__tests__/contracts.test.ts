import { describe, expect, it } from "vitest";

import {
  ContractError,
  REFUSAL_REASONS,
  TAXONOMY_VERSION,
  isRefusalCard,
  parseExplanationResult,
  parseRefusalCard,
  parseWikiAnchor,
} from "../contracts";

const validAnchor = {
  node_id: "maths.fractions.simplify",
  version: "1.0.0",
  anchor: "sec-worked-example",
};

const validProvenance = [{ source: "agent:explanation", confidence: 0.9, evidence_count: 1 }];

const validExplanation = {
  lang: "en",
  provenance: validProvenance,
  explanation_id: "explanation-abc",
  explanation_version: "exp-fractions-1.0.0",
  question_id: "maths-v1-jss3-006",
  skill_id: "jss3.number.fractions",
  misconception_code: "FRACTION_PART_WHOLE",
  body_markdown: "Divide top and bottom by the GCD.",
  wiki_citations: [validAnchor],
};

describe("W2 grounding contract — frontend mirror", () => {
  it("pins taxonomy version to 1.0.0", () => {
    expect(TAXONOMY_VERSION).toBe("1.0.0");
  });

  it("parses a valid wiki anchor", () => {
    expect(parseWikiAnchor(validAnchor)).toEqual(validAnchor);
  });

  it("rejects a wiki anchor with a blank field", () => {
    expect(() => parseWikiAnchor({ ...validAnchor, anchor: "" })).toThrow(ContractError);
  });

  it("parses a valid explanation result", () => {
    const parsed = parseExplanationResult(validExplanation);
    expect(parsed.wiki_citations).toHaveLength(1);
    expect(parsed.wiki_citations[0].node_id).toBe(validAnchor.node_id);
  });

  it("rejects an explanation with empty wiki_citations (no citation, no answer)", () => {
    expect(() =>
      parseExplanationResult({ ...validExplanation, wiki_citations: [] }),
    ).toThrowError(/no citation, no answer/i);
  });

  it("rejects an explanation missing wiki_citations entirely", () => {
    const { wiki_citations: _drop, ...partial } = validExplanation;
    expect(() => parseExplanationResult(partial)).toThrow(ContractError);
  });

  it("rejects an explanation with empty provenance", () => {
    expect(() =>
      parseExplanationResult({ ...validExplanation, provenance: [] }),
    ).toThrow(ContractError);
  });

  it("parses a no_grounding refusal card", () => {
    const card = parseRefusalCard({
      lang: "en",
      provenance: validProvenance,
      reason: "no_grounding",
      learner_message: "I can't ground this one — try a different question.",
    });
    expect(card.reason).toBe("no_grounding");
  });

  it("rejects an unknown refusal reason", () => {
    expect(() =>
      parseRefusalCard({
        lang: "en",
        provenance: validProvenance,
        reason: "hallucinated",
        learner_message: "x",
      }),
    ).toThrow(ContractError);
  });

  it("isRefusalCard narrows a union payload", () => {
    expect(isRefusalCard({ reason: "safety_block" })).toBe(true);
    expect(isRefusalCard({ reason: "fine" })).toBe(false);
    expect(isRefusalCard(validExplanation)).toBe(false);
  });

  it("exposes the canonical refusal reasons list", () => {
    expect(REFUSAL_REASONS).toContain("no_grounding");
    expect(REFUSAL_REASONS).toContain("safety_block");
  });
});
