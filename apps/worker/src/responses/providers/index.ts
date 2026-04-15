import type { WorkerEnv } from "../../storage/types";
import type { ResponsesProvider } from "../types";
import { mockResponsesProvider } from "./mockProvider";
import { createKimiResponsesProvider } from "./kimiProvider";
import { createOpenAIResponsesProvider } from "./openaiProvider";

type ResponsesProviderMode = "auto" | "mock" | "openai" | "kimi";

export class ResponsesProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponsesProviderConfigurationError";
  }
}

function resolveProviderMode(env: WorkerEnv): ResponsesProviderMode {
  const value = env.RESPONSES_PROVIDER?.trim().toLowerCase();

  if (!value || value === "auto") {
    return "auto";
  }

  if (value === "mock" || value === "openai" || value === "kimi") {
    return value;
  }

  throw new ResponsesProviderConfigurationError(
    `unsupported_responses_provider:${env.RESPONSES_PROVIDER}`,
  );
}

export function resolveResponsesProvider(env: WorkerEnv): ResponsesProvider {
  const providerMode = resolveProviderMode(env);
  const hasOpenAIKey = Boolean(env.OPENAI_API_KEY?.trim());
  const hasKimiKey = Boolean(env.KIMI_API_KEY?.trim());

  if (providerMode === "mock") {
    return mockResponsesProvider;
  }

  if (providerMode === "kimi") {
    if (!hasKimiKey) {
      throw new ResponsesProviderConfigurationError(
        "missing_kimi_api_key_for_kimi_provider",
      );
    }
    return createKimiResponsesProvider(env);
  }

  if (hasOpenAIKey) {
    return createOpenAIResponsesProvider(env);
  }

  if (hasKimiKey) {
    return createKimiResponsesProvider(env);
  }

  if (providerMode === "openai") {
    throw new ResponsesProviderConfigurationError(
      "missing_openai_api_key_for_openai_provider",
    );
  }

  return mockResponsesProvider;
}
