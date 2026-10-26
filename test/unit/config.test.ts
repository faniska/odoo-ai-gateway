import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { describe, expect, it } from "vitest";

import { loadConfigFromEnv } from "../../src/config/env.js";
import { interpolateEnv, loadConfigFile, parseConfig } from "../../src/config/load.js";
import { baseConfig } from "../helpers/gateway.js";

describe("config", () => {
  it("interpolates ${VAR} and ${VAR:-default}", () => {
    const env = { KEY: "sk-test" };
    expect(interpolateEnv({ a: "${KEY}", b: ["x-${KEY}"], c: "${MISSING:-fallback}", d: 3 }, env)).toEqual({ a: "sk-test", b: ["x-sk-test"], c: "fallback", d: 3 });
    expect(() => interpolateEnv("${MISSING}", env)).toThrow(/MISSING/);
  });

  it("applies defaults", () => {
    const config = parseConfig(baseConfig());
    expect(config.server.port).toBe(8080);
    expect(config.server.completionTimeoutSeconds).toBe(300);
    expect(config.embeddings.additional).toEqual([]);
  });

  it("rejects unknown tiers, unknown providers and missing auth", () => {
    expect(() => parseConfig(baseConfig({ routing: { default: "nope" } }))).toThrow(/unknown tier "nope"/);
    expect(() => parseConfig({ ...baseConfig(), routing: { default: { provider: "mistral", model: "x" } } })).toThrow(/Invalid gateway configuration/);
    expect(() => parseConfig(baseConfig({ auth: {} }))).toThrow(/accountTokens/);
    expect(() => parseConfig(baseConfig({ auth: { allowAnyAccountToken: true } }))).not.toThrow();
    expect(() => parseConfig({ ...baseConfig(), routing: { ...baseConfig().routing!, default: { provider: "openai", model: "m", effort: "extreme" } } })).toThrow();
  });

  it("loads YAML with env interpolation", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-"));
    const path = join(dir, "gateway.config.yaml");
    writeFileSync(
      path,
      [
        "auth:",
        "  accountTokens: ['${TOKEN}']",
        "providers:",
        "  openai: { apiKey: '${OPENAI_KEY}' }",
        "routing:",
        "  default: { provider: openai, model: gpt-5.6, effort: low }",
      ].join("\n"),
    );
    const config = loadConfigFile(path, { TOKEN: "t", OPENAI_KEY: "k" });
    expect(config.auth.accountTokens).toEqual(["t"]);
    expect(config.providers.openai?.apiKey).toBe("k");
  });

  it("reads numbers and booleans interpolated from env as strings", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-"));
    const path = join(dir, "gateway.config.yaml");
    writeFileSync(
      path,
      [
        "server: { port: '${PORT}', completionTimeoutSeconds: '${TIMEOUT:-90.5}', maxBodyBytes: '${MAX_BODY}' }",
        "auth: { allowAnyAccountToken: '${ALLOW_ANY}' }",
        "webhook: { maxAttempts: '${ATTEMPTS}', initialBackoffMs: '0', timeoutSeconds: '30' }",
        "providers:",
        "  openai: { apiKey: k }",
        "routing:",
        "  default: { provider: openai, model: m, maxOutputTokens: '${MAX_OUT}', capabilities: { tools: '${TOOLS}', schema: 'No' } }",
      ].join("\n"),
    );
    const config = loadConfigFile(path, { PORT: "9000", MAX_BODY: "1024", ALLOW_ANY: "TRUE", ATTEMPTS: "2", MAX_OUT: "4096", TOOLS: "1" });
    expect(config.server).toMatchObject({ port: 9000, completionTimeoutSeconds: 90.5, maxBodyBytes: 1024 });
    expect(config.auth.allowAnyAccountToken).toBe(true);
    expect(config.webhook).toMatchObject({ maxAttempts: 2, initialBackoffMs: 0, timeoutSeconds: 30 });
    expect(config.routing.default).toMatchObject({ maxOutputTokens: 4096, capabilities: { tools: true, schema: false } });
    for (const [value, expected] of [["false", false], ["0", false], ["no", false], ["yes", true]] as const) {
      expect(parseConfig(baseConfig({ auth: { accountTokens: ["t"], allowAnyAccountToken: value } })).auth.allowAnyAccountToken).toBe(expected);
    }
  });

  it("rejects strings that are not numbers or booleans", () => {
    expect(() => parseConfig(baseConfig({ server: { port: "abc" } }))).toThrow(/server\.port: Invalid input: expected number, received string/);
    expect(() => parseConfig(baseConfig({ server: { port: "" } }))).toThrow(/server\.port/);
    expect(() => parseConfig(baseConfig({ server: { port: "80.5" } }))).toThrow(/server\.port/);
    expect(() => parseConfig(baseConfig({ auth: { accountTokens: ["t"], allowAnyAccountToken: "maybe" } }))).toThrow(
      /auth\.allowAnyAccountToken: Invalid input: expected boolean, received string/,
    );
  });
});

describe("gateway.config.example.yaml", () => {
  it("is a valid configuration", () => {
    const env = {
      ODOO_AI_ACCOUNT_TOKEN: "t",
      OPENAI_API_KEY: "k",
      ANTHROPIC_API_KEY: "k",
      GEMINI_API_KEY: "k",
      XAI_API_KEY: "k",
      OPENROUTER_API_KEY: "k",
    };
    const config = loadConfigFile(join(import.meta.dirname, "../../gateway.config.example.yaml"), env);
    expect(config.routing.usages["agent:ai_website.ai_agent_website_builder"]).toMatchObject({ provider: "claude" });
    expect(config.routing.routes["1/get_embeddings"]).toMatchObject({ model: "text-embedding-3-small" });
    expect(config.tiers.map((tier) => tier.name)).toEqual(["fast", "balanced", "deep"]);
  });
});

describe("gateway.env.example", () => {
  it("is a valid configuration", () => {
    const env = parseEnv(readFileSync(join(import.meta.dirname, "../../gateway.env.example"), "utf8"));
    const config = loadConfigFromEnv(env);
    expect(config.providers.openrouter?.baseUrl).toMatch(/^https?:/);
    expect(config.tiers).toHaveLength(2);
    expect(config.routing.routes["1/get_embeddings"]).toBeDefined();
  });
});
