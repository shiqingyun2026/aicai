import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(workerDir, "..", "..");
const migrationPath = path.join(
  projectRoot,
  "supabase",
  "migrations",
  "20260413_230000_analysis_schema.sql",
);
const devVarsPath = path.join(workerDir, ".dev.vars");

function parseDevVars(raw) {
  const result = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    result[key] = value.replace(/^['"]|['"]$/g, "");
  }

  return result;
}

async function resolveConnectionString() {
  if (process.env.SUPABASE_CONNECTION_STRING) {
    return process.env.SUPABASE_CONNECTION_STRING;
  }

  try {
    const file = await readFile(devVarsPath, "utf8");
    const envFromFile = parseDevVars(file);
    return envFromFile.SUPABASE_CONNECTION_STRING || null;
  } catch {
    return null;
  }
}

async function ensureTablesExist(client) {
  const expectedTables = [
    "analysis.client_sessions",
    "analysis.analysis_records",
    "analysis.analysis_candidates",
    "analysis.candidate_evidence",
  ];

  for (const tableName of expectedTables) {
    const result = await client.query("select to_regclass($1) as regclass", [tableName]);
    if (!result.rows[0]?.regclass) {
      throw new Error(`missing_table:${tableName}`);
    }
  }
}

async function runProbeWrites(client) {
  const suffix = `${Date.now()}`;
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const analysisId = "22222222-2222-4222-8222-222222222222";
  const candidateId = "33333333-3333-4333-8333-333333333333";
  const evidenceId = "44444444-4444-4444-8444-444444444444";
  const requestId = `db-smoke-${suffix}`;

  await client.query("begin");

  try {
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
          updated_at = now()
      `,
      [sessionId, "zh-CN", "db-smoke"],
    );

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
          completed_at
        )
        values (
          $1::uuid,
          $2,
          $3::uuid,
          'completed',
          'HAS_CANDIDATES',
          '已有候选',
          true,
          'HAS_CANDIDATES',
          50000,
          12,
          'MAX_DRAWDOWN_10',
          'ONE_YEAR',
          false,
          'DIVIDEND',
          $4::jsonb,
          $5::jsonb,
          $6::jsonb,
          $7::jsonb,
          $8::jsonb,
          2,
          480,
          0,
          now()
        )
      `,
      [
        analysisId,
        requestId,
        sessionId,
        JSON.stringify(["高股息", "家电"]),
        JSON.stringify({
          budget: 50000,
          target_return_reference: 12,
          risk_tolerance: "MAX_DRAWDOWN_10",
          investment_cycle: "ONE_YEAR",
          volatility_acceptance: false,
          industry_preference: ["高股息", "家电"],
          style_preference: "DIVIDEND",
        }),
        JSON.stringify({
          initial_rule_result: { passed: true },
          pipeline_result: { stage: "db_smoke" },
        }),
        JSON.stringify({
          rounds: [{ round: 1, stage: "db_smoke" }],
          stage: "db_smoke",
        }),
        JSON.stringify({
          status_code: "HAS_CANDIDATES",
          candidates: [{ candidate_id: candidateId }],
        }),
      ],
    );

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
          1,
          '美的集团',
          '000333',
          '家电',
          '用于验证候选写入链路',
          '用于验证证据摘要字段',
          '用于验证风险字段',
          '用于验证不确定性字段',
          'HIGH',
          80
        )
      `,
      [candidateId, analysisId],
    );

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
          'L1',
          '巨潮资讯',
          'cninfo.com.cn',
          '数据库 smoke 验证公告',
          'https://www.cninfo.com.cn/',
          '2026-04-14',
          '用于验证证据写入链路',
          true,
          true
        )
      `,
      [evidenceId, analysisId, candidateId],
    );

    const counts = await client.query(
      `
        select
          (select count(*) from analysis.analysis_records where analysis_id = $1::uuid) as record_count,
          (select count(*) from analysis.analysis_candidates where analysis_id = $1::uuid) as candidate_count,
          (select count(*) from analysis.candidate_evidence where analysis_id = $1::uuid) as evidence_count
      `,
      [analysisId],
    );

    await client.query("rollback");
    return counts.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  const connectionString = await resolveConnectionString();

  if (!connectionString) {
    console.error(
      [
        "缺少 SUPABASE_CONNECTION_STRING。",
        "请在环境变量或 apps/worker/.dev.vars 中配置后重试。",
      ].join(" "),
    );
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();

    const migrationSql = await readFile(migrationPath, "utf8");
    await client.query(migrationSql);
    await ensureTablesExist(client);
    const counts = await runProbeWrites(client);

    console.log("db_smoke_ok");
    console.log(JSON.stringify({
      migrationPath,
      verifiedTables: [
        "analysis.client_sessions",
        "analysis.analysis_records",
        "analysis.analysis_candidates",
        "analysis.candidate_evidence",
      ],
      probeWriteCounts: counts,
    }, null, 2));
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("db_smoke_failed");
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
