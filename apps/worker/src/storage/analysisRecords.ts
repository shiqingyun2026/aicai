import type { AnalyzeSuccessResponse } from "@acai/shared";
import type { Client } from "pg";
import type { PersistAnalysisBundleInput, PersistAnalysisRecordInput, WorkerEnv } from "./types";
import { withDatabaseClient } from "./client";

async function upsertClientSession(
  client: Client,
  sessionId: string,
  env: WorkerEnv,
): Promise<void> {
  await client.query(
    `
      insert into analysis.client_sessions (
        session_id,
        locale,
        source_channel
      )
      values ($1::uuid, $2, $3)
      on conflict (session_id)
      do update set
        last_seen_at = now(),
        updated_at = now(),
        locale = excluded.locale,
        source_channel = excluded.source_channel
    `,
    [sessionId, "zh-CN", env.SOURCE_CHANNEL ?? "web"],
  );
}

async function insertAnalysisRecord(
  client: Client,
  input: PersistAnalysisRecordInput,
): Promise<void> {
  await client.query(
    `
      insert into analysis.analysis_records (
        analysis_id,
        request_id,
        session_id,
        processing_state,
        status_code,
        status_label,
        rules_passed,
        rule_status_code,
        budget,
        target_return_reference,
        risk_tolerance,
        investment_cycle,
        volatility_acceptance,
        style_preference,
        industry_preference_json,
        normalized_request_json,
        rule_results_json,
        round_trace_json,
        final_response_json,
        search_rounds_used,
        duration_ms,
        model_call_count,
        error_code,
        error_message,
        completed_at
      )
      values (
        $1::uuid,
        $2,
        $3::uuid,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15::jsonb,
        $16::jsonb,
        $17::jsonb,
        $18::jsonb,
        $19::jsonb,
        $20,
        $21,
        0,
        $22,
        $23,
        now()
      )
    `,
    [
      input.analysisId,
      input.requestId,
      input.clientSessionId,
      input.processingState,
      input.statusCode,
      input.statusLabel,
      input.rulesPassed,
      input.ruleStatusCode,
      input.normalizedRequest.budget,
      input.normalizedRequest.target_return_reference,
      input.normalizedRequest.risk_tolerance,
      input.normalizedRequest.investment_cycle,
      input.normalizedRequest.volatility_acceptance,
      input.normalizedRequest.style_preference,
      JSON.stringify(input.normalizedRequest.industry_preference ?? []),
      JSON.stringify(input.normalizedRequest),
      JSON.stringify(input.ruleResults),
      JSON.stringify(input.roundTrace),
      JSON.stringify(input.finalResponse),
      input.searchRoundsUsed,
      input.durationMs,
      input.errorCode ?? null,
      input.errorMessage ?? null,
    ],
  );
}

async function insertAnalysisCandidates(
  client: Client,
  analysisId: string,
  response: AnalyzeSuccessResponse,
): Promise<void> {
  for (const [index, candidate] of response.candidates.entries()) {
    await client.query(
      `
        insert into analysis.analysis_candidates (
          candidate_id,
          analysis_id,
          display_order,
          stock_name,
          stock_code,
          industry,
          selection_reason,
          evidence_summary,
          major_risks,
          uncertainties,
          confidence_level,
          confidence_score
        )
        values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12
        )
      `,
      [
        candidate.candidate_id,
        analysisId,
        index + 1,
        candidate.stock_name,
        candidate.stock_code,
        candidate.industry,
        candidate.selection_reason,
        candidate.evidence_summary,
        candidate.major_risks,
        candidate.uncertainties,
        candidate.confidence_level,
        candidate.confidence_score,
      ],
    );
  }
}

async function insertCandidateEvidence(
  client: Client,
  analysisId: string,
  response: AnalyzeSuccessResponse,
): Promise<void> {
  for (const candidate of response.candidates) {
    for (const source of candidate.source_links) {
      await client.query(
        `
          insert into analysis.candidate_evidence (
            evidence_id,
            analysis_id,
            candidate_id,
            source_level,
            source_name,
            source_domain,
            title,
            url,
            publish_date,
            snippet,
            is_core_evidence,
            is_valid_after_gatekeeper
          )
          values (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9::date,
            $10,
            $11,
            $12
          )
        `,
        [
          source.evidence_id,
          analysisId,
          candidate.candidate_id,
          source.source_level,
          source.source_name,
          source.source_domain,
          source.title,
          source.url,
          source.publish_date,
          source.snippet,
          source.is_core_evidence,
          true,
        ],
      );
    }
  }
}

export async function persistAnalysisBundle(
  env: WorkerEnv,
  input: PersistAnalysisBundleInput,
): Promise<boolean> {
  const result = await withDatabaseClient(env, async (client) => {
    await client.query("begin");

    try {
      await upsertClientSession(client, input.clientSessionId, env);
      await insertAnalysisRecord(client, input);
      await insertAnalysisCandidates(client, input.analysisId, input.finalResponseTyped);
      await insertCandidateEvidence(client, input.analysisId, input.finalResponseTyped);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    return true;
  });

  return result === true;
}

export async function persistFailedAnalysisRecord(
  env: WorkerEnv,
  input: PersistAnalysisRecordInput,
): Promise<boolean> {
  const result = await withDatabaseClient(env, async (client) => {
    await client.query("begin");

    try {
      await upsertClientSession(client, input.clientSessionId, env);
      await insertAnalysisRecord(client, input);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    return true;
  });

  return result === true;
}
