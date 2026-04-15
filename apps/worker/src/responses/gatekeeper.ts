import type { ConfidenceLevel, SourceLevel } from "@acai/shared";
import { makeUuid } from "../lib/ids";
import { getAllowedDomainsForLevels } from "./sourcePolicy";
import type {
  EvidenceVerificationOutput,
  PipelineCandidate,
  RoundTraceEntry,
  StructuredAssessmentOutput,
} from "./types";

type EvidenceItem = EvidenceVerificationOutput["candidate_evaluations"][number]["evidence_items"][number];
type CandidateEvaluation = EvidenceVerificationOutput["candidate_evaluations"][number];
type QualifiedCandidate = StructuredAssessmentOutput["qualified_candidates"][number];

type NormalizedEvidenceItem = EvidenceItem & {
  normalized_source_domain: string;
  is_valid_after_gatekeeper: boolean;
  invalid_reasons: string[];
  counts_for_core_conclusion: boolean;
  dedupe_key: string;
};

type GatekeptCandidate = {
  stock_name: string;
  stock_code: string;
  industry: string;
  selection_reason: string;
  evidence_summary: string;
  major_risks: string;
  uncertainties: string;
  confidence_level: ConfidenceLevel;
  confidence_score: number;
  primary_source_levels: SourceLevel[];
  source_links: PipelineCandidate["source_links"];
  disqualify_reasons: string[];
  missing_evidence: string[];
};

type GatekeeperResult = {
  qualifiedCandidates: GatekeptCandidate[];
  rejectedCandidates: Array<{
    stock_name: string;
    stock_code: string;
    reason: string;
  }>;
  missingEvidence: string[];
  reasons: string[];
  suggestions: string[];
  evidenceSufficient: boolean;
  shouldEscalateToNextRound: boolean;
};

const sourceLevelPriority: Record<SourceLevel, number> = {
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  const raw = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;

  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^www\./, "");
  }
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function scoreLevel(level: SourceLevel): number {
  return sourceLevelPriority[level];
}

function sortLevels(levels: SourceLevel[]): SourceLevel[] {
  return [...levels].sort((left, right) => scoreLevel(left) - scoreLevel(right));
}

function getConfidenceRequirements(level: ConfidenceLevel) {
  if (level === "HIGH") {
    return {
      minCoreEvidenceCount: 2,
      requiresLevelOneCoreEvidence: true,
      maxHighestCoreSourceLevel: "L2" as const,
    };
  }

  if (level === "MEDIUM") {
    return {
      minCoreEvidenceCount: 1,
      requiresLevelOneCoreEvidence: false,
      maxHighestCoreSourceLevel: "L3" as const,
    };
  }

  return {
    minCoreEvidenceCount: 1,
    requiresLevelOneCoreEvidence: false,
    maxHighestCoreSourceLevel: "L4" as const,
  };
}

function mergeEvidenceItems(
  items: NormalizedEvidenceItem[],
  allowedLevels: SourceLevel[],
): NormalizedEvidenceItem[] {
  const byKey = new Map<string, NormalizedEvidenceItem>();

  for (const item of items) {
    const existing = byKey.get(item.dedupe_key);
    if (!existing) {
      byKey.set(item.dedupe_key, item);
      continue;
    }

    const keepCurrent =
      Number(item.is_valid_after_gatekeeper) > Number(existing.is_valid_after_gatekeeper) ||
      (item.is_valid_after_gatekeeper === existing.is_valid_after_gatekeeper &&
        scoreLevel(item.source_level) < scoreLevel(existing.source_level)) ||
      (item.is_valid_after_gatekeeper === existing.is_valid_after_gatekeeper &&
        item.counts_for_core_conclusion &&
        !existing.counts_for_core_conclusion);

    const merged: NormalizedEvidenceItem = keepCurrent
      ? {
          ...item,
          supports_core_conclusion:
            item.supports_core_conclusion || existing.supports_core_conclusion,
          is_valid_after_gatekeeper:
            item.is_valid_after_gatekeeper || existing.is_valid_after_gatekeeper,
          invalid_reasons: dedupeStrings([
            ...item.invalid_reasons,
            ...existing.invalid_reasons,
          ]),
          counts_for_core_conclusion:
            item.counts_for_core_conclusion || existing.counts_for_core_conclusion,
        }
      : {
          ...existing,
          supports_core_conclusion:
            item.supports_core_conclusion || existing.supports_core_conclusion,
          is_valid_after_gatekeeper:
            item.is_valid_after_gatekeeper || existing.is_valid_after_gatekeeper,
          invalid_reasons: dedupeStrings([
            ...existing.invalid_reasons,
            ...item.invalid_reasons,
          ]),
          counts_for_core_conclusion:
            item.counts_for_core_conclusion || existing.counts_for_core_conclusion,
        };

    byKey.set(item.dedupe_key, merged);
  }

  return [...byKey.values()]
    .filter((item) => allowedLevels.includes(item.source_level))
    .sort((left, right) => {
      if (left.is_valid_after_gatekeeper !== right.is_valid_after_gatekeeper) {
        return Number(right.is_valid_after_gatekeeper) - Number(left.is_valid_after_gatekeeper);
      }
      if (left.counts_for_core_conclusion !== right.counts_for_core_conclusion) {
        return Number(right.counts_for_core_conclusion) - Number(left.counts_for_core_conclusion);
      }
      return scoreLevel(left.source_level) - scoreLevel(right.source_level);
    })
    .slice(0, 10);
}

function normalizeEvidenceItems(
  evaluation: CandidateEvaluation,
  roundEntry: RoundTraceEntry,
): NormalizedEvidenceItem[] {
  const allowedDomainSet = new Set(
    getAllowedDomainsForLevels(roundEntry.allowed_source_levels).map((domain) => normalizeDomain(domain)),
  );

  return mergeEvidenceItems(
    evaluation.evidence_items.map((item) => {
      const normalizedSourceDomain = normalizeDomain(item.source_domain);
      let normalizedUrlDomain = "";
      try {
        normalizedUrlDomain = new URL(item.url).hostname.toLowerCase();
      } catch {
        normalizedUrlDomain = "";
      }

      const invalidReasons: string[] = [];
      const sourceDomain = normalizedSourceDomain || normalizedUrlDomain;

      if (!sourceDomain) {
        invalidReasons.push("证据链接缺少可解析域名。");
      }

      if (!roundEntry.allowed_source_levels.includes(item.source_level)) {
        invalidReasons.push(`来源等级 ${item.source_level} 不在当前轮次允许范围内。`);
      }

      if (sourceDomain && !allowedDomainSet.has(sourceDomain)) {
        invalidReasons.push(`来源域名 ${sourceDomain} 不在当前轮次白名单内。`);
      }

      if (roundEntry.round === 4 && item.source_level === "L4" && item.supports_core_conclusion) {
        invalidReasons.push("Round 4 的 L4 来源只允许补背景，不能支撑核心结论。");
      }

      const isValidAfterGatekeeper = invalidReasons.length === 0;
      const countsForCoreConclusion =
        isValidAfterGatekeeper &&
        item.supports_core_conclusion &&
        !(roundEntry.round === 4 && item.source_level === "L4");

      return {
        ...item,
        source_domain: sourceDomain || item.source_domain,
        normalized_source_domain: sourceDomain,
        is_valid_after_gatekeeper: isValidAfterGatekeeper,
        invalid_reasons: invalidReasons,
        counts_for_core_conclusion: countsForCoreConclusion,
        dedupe_key: `${evaluation.stock_code}:${item.url.trim().toLowerCase()}`,
      };
    }),
    roundEntry.allowed_source_levels,
  );
}

function buildQualifiedCandidate(
  candidate: QualifiedCandidate,
  evaluation: CandidateEvaluation,
  roundEntry: RoundTraceEntry,
): GatekeptCandidate {
  const normalizedEvidence = normalizeEvidenceItems(evaluation, roundEntry);
  const validEvidence = normalizedEvidence.filter((item) => item.is_valid_after_gatekeeper);
  const validCoreEvidence = validEvidence.filter((item) => item.counts_for_core_conclusion);
  const primarySourceLevels = sortLevels(
    dedupeStrings(validCoreEvidence.map((item) => item.source_level)) as SourceLevel[],
  );
  const disqualifyReasons = dedupeStrings([
    ...evaluation.disqualify_reasons,
    ...normalizedEvidence.flatMap((item) => item.invalid_reasons),
  ]);
  const missingEvidence = dedupeStrings(evaluation.missing_evidence);

  return {
    stock_name: candidate.stock_name,
    stock_code: candidate.stock_code,
    industry: candidate.industry,
    selection_reason: candidate.selection_reason,
    evidence_summary: candidate.evidence_summary,
    major_risks: candidate.major_risks,
    uncertainties: candidate.uncertainties,
    confidence_level: candidate.confidence_level,
    confidence_score: candidate.confidence_score,
    primary_source_levels: primarySourceLevels,
    source_links: validEvidence.map((item) => ({
      evidence_id: makeUuid(),
      source_level: item.source_level,
      source_name: item.source_name,
      source_domain: item.source_domain,
      title: item.title,
      url: item.url,
      publish_date: item.publish_date,
      snippet: item.snippet,
      is_core_evidence: item.counts_for_core_conclusion,
    })),
    disqualify_reasons: [...disqualifyReasons],
    missing_evidence: [...missingEvidence],
  };
}

function validateCandidate(candidate: GatekeptCandidate, roundEntry: RoundTraceEntry): string[] {
  const reasons = [...candidate.disqualify_reasons];
  const coreEvidence = candidate.source_links.filter((item) => item.is_core_evidence);
  const confidenceRequirements = getConfidenceRequirements(candidate.confidence_level);
  const coreLevels = sortLevels(candidate.primary_source_levels);

  if (candidate.source_links.length === 0) {
    reasons.push("没有通过 gatekeeper 的有效证据条目。");
  }

  if (coreEvidence.length < confidenceRequirements.minCoreEvidenceCount) {
    reasons.push("核心证据数量不足，无法支撑当前置信度。");
  }

  if (
    confidenceRequirements.requiresLevelOneCoreEvidence &&
    !coreLevels.includes("L1")
  ) {
    reasons.push("高置信度候选必须包含一级来源核心证据。");
  }

  const highestCoreLevel = coreLevels.at(-1);
  if (
    highestCoreLevel &&
    scoreLevel(highestCoreLevel) > scoreLevel(confidenceRequirements.maxHighestCoreSourceLevel)
  ) {
    reasons.push("当前核心证据等级与置信度不匹配。");
  }

  if (roundEntry.round === 1 && !coreLevels.includes("L1")) {
    reasons.push("Round 1 至少需要一级来源支撑核心结论。");
  }

  if (roundEntry.round === 2 && coreEvidence.length < 2) {
    reasons.push("Round 2 至少需要两条有效核心证据。");
  }

  if (roundEntry.round >= 3 && coreEvidence.length < 2) {
    reasons.push("多轮检索后仍需要至少两条有效核心证据。");
  }

  if (roundEntry.round === 4 && coreLevels.includes("L4")) {
    reasons.push("Round 4 的四级来源不能进入核心来源集合。");
  }

  return dedupeStrings(reasons);
}

export function applyEvidenceGatekeeper(roundEntry: RoundTraceEntry): GatekeeperResult {
  const evaluationByStockCode = new Map(
    roundEntry.evidence_verification.candidate_evaluations.map((evaluation) => [
      evaluation.stock_code,
      evaluation,
    ]),
  );

  const qualifiedCandidates: GatekeptCandidate[] = [];
  const rejectedCandidates: GatekeeperResult["rejectedCandidates"] = [];
  const aggregatedMissingEvidence = new Set<string>([
    ...roundEntry.evidence_verification.missing_evidence,
    ...roundEntry.structured_assessment.missing_evidence,
  ]);

  for (const candidate of roundEntry.structured_assessment.qualified_candidates) {
    const evaluation = evaluationByStockCode.get(candidate.stock_code);
    if (!evaluation) {
      rejectedCandidates.push({
        stock_name: candidate.stock_name,
        stock_code: candidate.stock_code,
        reason: "缺少对应的证据核验结果，无法进入最终候选。",
      });
      aggregatedMissingEvidence.add(`${candidate.stock_name} 缺少可核验的证据结果。`);
      continue;
    }

    const gatekeptCandidate = buildQualifiedCandidate(candidate, evaluation, roundEntry);
    const validationReasons = validateCandidate(gatekeptCandidate, roundEntry);

    if (validationReasons.length > 0 || !evaluation.is_qualified_in_current_round) {
      rejectedCandidates.push({
        stock_name: candidate.stock_name,
        stock_code: candidate.stock_code,
        reason:
          dedupeStrings([
            ...validationReasons,
            ...evaluation.disqualify_reasons,
          ])[0] ?? "当前轮次证据门槛未达标。",
      });
      for (const item of gatekeptCandidate.missing_evidence) {
        aggregatedMissingEvidence.add(item);
      }
      continue;
    }

    qualifiedCandidates.push(gatekeptCandidate);
  }

  for (const rejected of roundEntry.structured_assessment.rejected_candidates) {
    rejectedCandidates.push(rejected);
  }

  const evidenceSufficient = qualifiedCandidates.length > 0;
  const reasons = evidenceSufficient
    ? dedupeStrings([
        ...roundEntry.structured_assessment.reasons,
        "候选已通过 Worker 侧证据门槛校验。",
      ])
    : dedupeStrings([
        ...roundEntry.structured_assessment.reasons,
        "Worker 后置仲裁后，当前轮次没有候选通过证据门槛。",
      ]);

  const suggestions = evidenceSufficient
    ? dedupeStrings(roundEntry.structured_assessment.suggestions)
    : dedupeStrings([
        ...roundEntry.structured_assessment.suggestions,
        "优先补充一级或二级来源中的经营、公告和现金流证据。",
      ]);

  const missingEvidence = [...aggregatedMissingEvidence];
  const shouldEscalateToNextRound =
    !evidenceSufficient &&
    roundEntry.round < 4 &&
    missingEvidence.length > 0 &&
    (
      roundEntry.evidence_verification.should_escalate_to_next_round ||
      roundEntry.structured_assessment.should_escalate_to_next_round
    );

  return {
    qualifiedCandidates,
    rejectedCandidates: rejectedCandidates.slice(0, 12),
    missingEvidence,
    reasons,
    suggestions,
    evidenceSufficient,
    shouldEscalateToNextRound,
  };
}
