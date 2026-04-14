import type { WorkerEnv } from "../../storage/types";
import type { ResponsesProvider } from "../types";
import { mockResponsesProvider } from "./mockProvider";
import { createOpenAIResponsesProvider } from "./openaiProvider";

export function resolveResponsesProvider(env: WorkerEnv): ResponsesProvider {
  if (env.OPENAI_API_KEY) {
    return createOpenAIResponsesProvider(env);
  }

  return mockResponsesProvider;
}
