import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
export const APP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const envFile = path.join(APP_ROOT, ".env");
if (existsSync(envFile)) loadEnvFile(envFile);
export type AiProvider = "openai" | "openrouter" | "anthropic";
export type Config = {
  port: number;
  songsDir: string;
  runTimeoutMs: number;
  /** Selected provider for composition, workers, and AI effects. */
  provider?: AiProvider;
  openaiKey?: string;
  openrouterKey?: string;
  anthropicKey?: string;
  /** Key for the selected composition provider, if configured. */
  providerKey?: string;
  orchestratorModel: string;
  composerModel: string;
  rootDir: string;
};
export function getConfig(): Config {
  const port = Number(process.env.PORT || 3001),
    runTimeoutMs = Number(process.env.RUN_TIMEOUT_MS || 180000);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isInteger(runTimeoutMs) ||
    runTimeoutMs < 1000 ||
    runTimeoutMs > 600000
  )
    throw new Error("INVALID_CONFIG: PORT or RUN_TIMEOUT_MS");
  const requestedProvider = (process.env.AI_PROVIDER?.trim().toLowerCase() || "openai") as AiProvider;
  if (!["openai", "openrouter", "anthropic"].includes(requestedProvider))
    throw new Error("INVALID_CONFIG: AI_PROVIDER must be openai, openrouter, or anthropic");
  const openaiKey = process.env.OPENAI_API_KEY?.trim() || undefined,
    openrouterKey = process.env.OPENROUTER_API_KEY?.trim() || undefined,
    anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    providerKey = requestedProvider === "openai"
      ? openaiKey
      : requestedProvider === "openrouter"
        ? openrouterKey
        : anthropicKey,
    providerPrefix = requestedProvider.toUpperCase(),
    defaults = {
      openai: { orchestrator: "gpt-6-luna", composer: "gpt-5-nano" },
      openrouter: { orchestrator: "openai/gpt-6-luna", composer: "openai/gpt-5-nano" },
      anthropic: { orchestrator: "claude-sonnet-4-5", composer: "claude-haiku-4-5" },
    }[requestedProvider];
  return {
    rootDir: APP_ROOT,
    port,
    runTimeoutMs,
    songsDir: path.resolve(APP_ROOT, process.env.SONGS_DIR?.trim() || "songs"),
    provider: requestedProvider,
    openaiKey,
    openrouterKey,
    anthropicKey,
    providerKey,
    orchestratorModel:
      process.env.AI_ORCHESTRATOR_MODEL?.trim() ||
      process.env[providerPrefix + "_ORCHESTRATOR_MODEL"]?.trim() ||
      defaults.orchestrator,
    composerModel:
      process.env.AI_COMPOSER_MODEL?.trim() ||
      process.env[providerPrefix + "_COMPOSER_MODEL"]?.trim() ||
      defaults.composer,
  };
}
