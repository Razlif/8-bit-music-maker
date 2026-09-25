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
export type Config = {
  port: number;
  songsDir: string;
  runTimeoutMs: number;
  openaiKey?: string;
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
  return {
    rootDir: APP_ROOT,
    port,
    runTimeoutMs,
    songsDir: path.resolve(APP_ROOT, process.env.SONGS_DIR?.trim() || "songs"),
    openaiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    orchestratorModel: process.env.OPENAI_ORCHESTRATOR_MODEL || "gpt-6-luna",
    composerModel: process.env.OPENAI_COMPOSER_MODEL || "gpt-5-nano",
  };
}
