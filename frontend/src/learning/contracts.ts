/**
 * Pathfinder Learn — frontend mirror of the W2 grounding contract.
 *
 * Mirrors the Pydantic models in `backend/src/learning/models.py`:
 *   WikiAnchor, WikiNode, ExplanationResult, RefusalCard.
 *
 * Runtime validation is delegated to Zod so the schemas can be reused for
 * streaming JSON parsing in W3. The public API (`parseXxx`, `ContractError`,
 * `isRefusalCard`, `REFUSAL_REASONS`, `TAXONOMY_VERSION`, type exports) is
 * stable from the hand-rolled W2 version.
 *
 * MVP §4.1 — "no citation, no answer." `parseExplanationResult` fails closed
 * if `wiki_citations` is missing or empty, with that exact phrase in the error.
 */

import { z, ZodError } from "zod";

export const TAXONOMY_VERSION = "1.0.0" as const;

export const REFUSAL_REASONS = [
  "no_grounding",
  "safety_block",
  "out_of_scope",
  "rate_limited",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

const ProvenanceSchema = z
  .object({
    source: z.string().min(1),
    source_id: z.string().optional(),
    rule_id: z.string().optional(),
    recency: z.string().optional(),
    confidence: z.number().default(1.0),
    evidence_count: z.number().default(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const ProvenanceArraySchema = z.array(ProvenanceSchema).min(1);

export const WikiAnchorSchema = z
  .object({
    node_id: z.string().min(1),
    version: z.string().min(1),
    anchor: z.string().min(1),
  })
  .strict();

export const WikiNodeSchema = z
  .object({
    lang: z.string().min(1),
    provenance: ProvenanceArraySchema,
    node_id: z.string().min(1),
    version: z.string().min(1),
    title: z.string().min(1),
    subject: z.enum(["maths", "english"]),
    year_group: z.enum(["JSS3", "SS3"]).optional(),
    topic: z.string().min(1),
    subtopic: z.string().optional(),
    misconception_codes: z.array(z.string()),
    body_markdown: z.string().min(1),
    anchors: z.array(z.string().min(1)),
    status: z.enum(["draft", "review", "approved", "frozen", "archived"]),
  })
  .strict();

export const ExplanationResultSchema = z
  .object({
    lang: z.string().min(1),
    provenance: ProvenanceArraySchema,
    explanation_id: z.string().min(1),
    explanation_version: z.string().min(1),
    question_id: z.string().min(1),
    skill_id: z.string().min(1),
    misconception_code: z.string().optional(),
    body_markdown: z.string().min(1),
    wiki_citations: z.array(WikiAnchorSchema),
  })
  .strict();

export const RefusalCardSchema = z
  .object({
    lang: z.string().min(1),
    provenance: ProvenanceArraySchema,
    reason: z.enum(REFUSAL_REASONS),
    learner_message: z.string().min(1),
    detail: z.string().optional(),
    suggested_action: z.string().optional(),
  })
  .strict();

export type Provenance = z.infer<typeof ProvenanceSchema>;
export type WikiAnchor = z.infer<typeof WikiAnchorSchema>;
export type WikiNode = z.infer<typeof WikiNodeSchema>;
export type ExplanationResult = z.infer<typeof ExplanationResultSchema>;
export type RefusalCard = z.infer<typeof RefusalCardSchema>;

function lift<S extends z.ZodTypeAny>(schema: S, label: string, raw: unknown): z.output<S> {
  try {
    return schema.parse(raw) as z.output<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      const summary = err.issues
        .map((i) => `${label}${i.path.length ? "." + i.path.join(".") : ""}: ${i.message}`)
        .join("; ");
      throw new ContractError(summary);
    }
    throw err;
  }
}

export function parseWikiAnchor(raw: unknown): WikiAnchor {
  return lift(WikiAnchorSchema, "wiki_anchor", raw);
}

export function parseWikiNode(raw: unknown): WikiNode {
  return lift(WikiNodeSchema, "wiki_node", raw);
}

export function parseExplanationResult(raw: unknown): ExplanationResult {
  // Belt-and-braces: render MVP §4.1's exact phrase before Zod produces a
  // generic "Array must contain at least 1 element(s)" message.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ContractError("explanation_result must be an object");
  }
  const citations = (raw as { wiki_citations?: unknown }).wiki_citations;
  if (!Array.isArray(citations) || citations.length === 0) {
    throw new ContractError(
      "no citation, no answer: wiki_citations must be a non-empty array (MVP §4.1)",
    );
  }
  return lift(ExplanationResultSchema, "explanation_result", raw);
}

export function parseRefusalCard(raw: unknown): RefusalCard {
  return lift(RefusalCardSchema, "refusal_card", raw);
}

export function isRefusalCard(raw: unknown): raw is RefusalCard {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const reason = (raw as { reason?: unknown }).reason;
  return typeof reason === "string" && (REFUSAL_REASONS as ReadonlyArray<string>).includes(reason);
}
