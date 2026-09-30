import { afterEach, expect, it } from "vitest";
import { getConfig } from "../src/config.js";

const names = [
  "AI_PROVIDER",
  "AI_ORCHESTRATOR_MODEL",
  "AI_COMPOSER_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_ORCHESTRATOR_MODEL",
  "OPENAI_COMPOSER_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_ORCHESTRATOR_MODEL",
  "OPENROUTER_COMPOSER_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_ORCHESTRATOR_MODEL",
  "ANTHROPIC_COMPOSER_MODEL",
] as const;
const original = new Map(names.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of names) {
    const value = original.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

it("selects OpenRouter and its provider-specific model defaults", () => {
  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "router-test-key";
  delete process.env.AI_ORCHESTRATOR_MODEL;
  delete process.env.AI_COMPOSER_MODEL;
  expect(getConfig()).toMatchObject({
    provider: "openrouter",
    providerKey: "router-test-key",
    orchestratorModel: "openai/gpt-6-luna",
    composerModel: "openai/gpt-5-nano",
  });
});

it("selects Anthropic and allows common model overrides", () => {
  process.env.AI_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
  process.env.AI_ORCHESTRATOR_MODEL = "claude-opus-5-5";
  process.env.AI_COMPOSER_MODEL = "claude-haiku-4-5";
  expect(getConfig()).toMatchObject({
    provider: "anthropic",
    providerKey: "anthropic-test-key",
    orchestratorModel: "claude-opus-5-5",
    composerModel: "claude-haiku-4-5",
  });
});
