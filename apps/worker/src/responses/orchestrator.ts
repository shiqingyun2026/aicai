import type { AnalyzeRequest } from "@acai/shared";
import { makeUuid } from "../lib/ids";
import { applyEvidenceGatekeeper } from "./gatekeeper";
import { responseRounds } from "./rounds";
import type { ResponsesPipelineResult, ResponsesProvider, RoundTraceEntry } from "./types";

function getHighestSourceLevel(candidates: ResponsesPipelineResult["candidates"]) {
  const levels = candidates.flatMap((candidate) => candidate.primary_source_levels);
  if (levels.includes("L3")) return "L3" as const;
  if (levels.includes("L2")) return "L2" as const;
  if (levels.includes("L1")) return "L1" as const;
  return null;
}

export async function runResponsesPipeline(
  request: AnalyzeRequest,
  provider: ResponsesProvider,
): Promise<ResponsesPipelineResult> {
  const roundTrace: RoundTraceEntry[] = [];

  for (const roundConfig of responseRounds) {
    const candidateNarrowing = await provider.runCandidateNarrowing({
      request,
      round: roundConfig.round,
      allowedSourceLevels: roundConfig.allowedSourceLevels,
    });

    const evidenceVerification = await provider.runEvidenceVerification({
      request,
      round: roundConfig.round,
      allowedSourceLevels: roundConfig.allowedSourceLevels,
      candidateNarrowing,
    });

    const structuredAssessment = await provider.runStructuredAssessment({
      request,
      round: roundConfig.round,
      allowedSourceLevels: roundConfig.allowedSourceLevels,
      candidateNarrowing,
      evidenceVerification,
    });

    const roundEntry: RoundTraceEntry = {
      round: roundConfig.round,
      allowed_source_levels: roundConfig.allowedSourceLevels,
      candidate_narrowing: candidateNarrowing,
      evidence_verification: evidenceVerification,
      structured_assessment: structuredAssessment,
    };

    const gatekeeperResult = applyEvidenceGatekeeper(roundEntry);
    roundEntry.gatekeeper = {
      evidence_sufficient: gatekeeperResult.evidenceSufficient,
      should_escalate_to_next_round: gatekeeperResult.shouldEscalateToNextRound,
      missing_evidence: gatekeeperResult.missingEvidence,
      rejected_candidates: gatekeeperResult.rejectedCandidates,
    };

    roundTrace.push(roundEntry);

    if (
      structuredAssessment.proposed_status === "HAS_CANDIDATES" &&
      gatekeeperResult.qualifiedCandidates.length > 0
    ) {
      const candidates = gatekeeperResult.qualifiedCandidates.map((candidate) => ({
        candidate_id: makeUuid(),
        stock_name: candidate.stock_name,
        stock_code: candidate.stock_code,
        industry: candidate.industry,
        selection_reason: candidate.selection_reason,
        evidence_summary: candidate.evidence_summary,
        major_risks: candidate.major_risks,
        uncertainties: candidate.uncertainties,
        confidence_level: candidate.confidence_level,
        confidence_score: candidate.confidence_score,
        primary_source_levels: candidate.primary_source_levels,
        source_links: candidate.source_links,
      }));
      return {
        statusCode: "HAS_CANDIDATES",
        reasons: gatekeeperResult.reasons,
        suggestions: gatekeeperResult.suggestions,
        overallNote: structuredAssessment.overall_note,
        missingEvidence: gatekeeperResult.missingEvidence,
        candidates,
        searchRoundsUsed: roundConfig.round,
        highestSourceLevelUsedForCoreConclusion: getHighestSourceLevel(candidates),
        roundTrace: { rounds: roundTrace },
      };
    }

    if (
      structuredAssessment.proposed_status === "NO_CLEAR_CANDIDATES" &&
      !gatekeeperResult.shouldEscalateToNextRound
    ) {
      return {
        statusCode: "NO_CLEAR_CANDIDATES",
        reasons: gatekeeperResult.reasons,
        suggestions: gatekeeperResult.suggestions,
        overallNote: structuredAssessment.overall_note,
        missingEvidence: gatekeeperResult.missingEvidence,
        candidates: [],
        searchRoundsUsed: roundConfig.round,
        highestSourceLevelUsedForCoreConclusion: null,
        roundTrace: { rounds: roundTrace },
      };
    }

    if (!gatekeeperResult.shouldEscalateToNextRound) {
      return {
        statusCode: "NO_CLEAR_CANDIDATES",
        reasons: gatekeeperResult.reasons,
        suggestions: gatekeeperResult.suggestions,
        overallNote: structuredAssessment.overall_note,
        missingEvidence: gatekeeperResult.missingEvidence,
        candidates: [],
        searchRoundsUsed: roundConfig.round,
        highestSourceLevelUsedForCoreConclusion: null,
        roundTrace: { rounds: roundTrace },
      };
    }
  }

  const lastRound = roundTrace.at(-1);
  return {
    statusCode: "NO_CLEAR_CANDIDATES",
    reasons:
      lastRound?.gatekeeper?.evidence_sufficient === false
        ? ["Worker 后置仲裁后，当前未形成明确候选。", ...(lastRound?.structured_assessment.reasons ?? [])]
        : lastRound?.structured_assessment.reasons ?? ["当前未形成明确候选。"],
    suggestions:
      lastRound?.structured_assessment.suggestions ?? ["建议缩窄条件后继续补充公开信息证据。"],
    overallNote: lastRound?.structured_assessment.overall_note ?? "结果仅用于继续研读方向，不构成投资建议",
    missingEvidence: lastRound?.gatekeeper?.missing_evidence ?? lastRound?.structured_assessment.missing_evidence ?? [],
    candidates: [],
    searchRoundsUsed: lastRound?.round ?? 0,
    highestSourceLevelUsedForCoreConclusion: null,
    roundTrace: { rounds: roundTrace },
  };
}
