import type { AnalyzeRequest, AnalyzeSuccessResponse } from "@acai/shared";

type HyperdriveBinding = {
  connectionString?: string;
};

export type WorkerEnv = {
  HYPERDRIVE?: HyperdriveBinding;
  OPENAI_API_KEY?: string;
  OPENAI_RESPONSES_MODEL?: string;
  KIMI_API_KEY?: string;
  KIMI_BASE_URL?: string;
  KIMI_MODEL?: string;
  RESPONSES_PROVIDER?: string;
  SUPABASE_CONNECTION_STRING?: string;
  SOURCE_CHANNEL?: string;
};

export type PersistAnalysisRecordInput = {
  analysisId: string;
  requestId: string;
  clientSessionId: string;
  processingState: "completed" | "failed" | "received";
  statusCode: string | null;
  statusLabel: string | null;
  rulesPassed: boolean;
  ruleStatusCode: string;
  normalizedRequest: AnalyzeRequest;
  ruleResults: Record<string, unknown>;
  roundTrace: Record<string, unknown>;
  finalResponse: Record<string, unknown>;
  searchRoundsUsed: number;
  durationMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type PersistAnalysisBundleInput = PersistAnalysisRecordInput & {
  finalResponseTyped: AnalyzeSuccessResponse;
};
