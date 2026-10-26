import { describe, expect, it } from "vitest";

import { configFromEnv, configSource, loadConfigFromEnv, parseEntry } from "../../src/config/env.js";
import { parseConfig } from "../../src/config/load.js";

/** The smallest env that builds a valid config. */
const minimal = {
  GATEWAY_ACCOUNT_TOKENS: "t",
  GATEWAY_PROVIDER_OPENAI_API_KEY: "k",
  GATEWAY_ROUTE_DEFAULT: "openai:gpt-5.6",
};

describe("configFromEnv", () => {
  it("builds the full config", () => {
    const env = {
      GATEWAY_HOST: "127.0.0.1",
      GATEWAY_PORT: "9090",
      GATEWAY_COMPLETION_TIMEOUT_SECONDS: "200",
      GATEWAY_SYNC_TIMEOUT_SECONDS: "50",
      GATEWAY_REQUEST_TIMEOUT_SECONDS: "90",
      GATEWAY_MAX_BODY_BYTES: "1048576",
      GATEWAY_ACCOUNT_TOKENS: "tok-a, tok-b,",
      GATEWAY_ALLOW_ANY_ACCOUNT_TOKEN: "false",
      GATEWAY_TRANSACTION_TOKEN_SECRET: "0123456789abcdef0123",
      GATEWAY_WEBHOOK_ALLOWED_HOSTS: "odoo.example.com,*.example.org",
      GATEWAY_WEBHOOK_MAX_ATTEMPTS: "5",
      GATEWAY_WEBHOOK_INITIAL_BACKOFF_MS: "250",
      GATEWAY_WEBHOOK_TIMEOUT_SECONDS: "120",
      GATEWAY_PROVIDER_OPENROUTER_API_KEY: "or-key",
      GATEWAY_PROVIDER_OPENROUTER_BASE_URL: "https://llm.example.com/api/v1",
      GATEWAY_PROVIDER_OPENROUTER_HEADERS: '{"X-Title": "Odoo"}',
      GATEWAY_PROVIDER_OPENAI_API_KEY: "oa-key",
      GATEWAY_PROVIDER_OPENAI_BASE_URL: "http://embeddings.internal:8000/v1",
      GATEWAY_PROVIDER_CLAUDE_BASE_URL: "https://ignored.example.com",
      GATEWAY_TIERS: "fast, deep-think",
      GATEWAY_TIER_FAST: "openrouter:glm-5.2@low",
      GATEWAY_TIER_DEEP_THINK: '{"provider": "openrouter", "model": "anthropic/claude-x", "effort": "high", "maxOutputTokens": 8000}',
      GATEWAY_ROUTE_DEFAULT: "fast",
      GATEWAY_ROUTE_AGENT: "deep-think",
      GATEWAY_ROUTE_IMAGE_GENERATION: "openrouter:google/gemini-image",
      GATEWAY_ROUTE_WEB_GROUNDING: "fast",
      GATEWAY_ROUTE_GET_EMBEDDINGS: '{"provider": "openai", "model": "bge-m3", "name": "text-embedding-3-small"}',
      GATEWAY_ROUTE_GET_TRANSCRIPTION: "openai:whisper-1",
      GATEWAY_USAGES: '{"channel_name": "fast", "agent:ai_website.x": "openrouter:z-ai/glm-5.2@medium", "ai_field": {"provider": "openrouter", "model": "m"}}',
      GATEWAY_EMBEDDINGS_ADDITIONAL: '["openai:old-model", {"provider": "openai", "model": "older"}]',
    };
    const input = configFromEnv(env);
    expect(input).toEqual({
      server: {
        host: "127.0.0.1",
        port: "9090",
        completionTimeoutSeconds: "200",
        syncTimeoutSeconds: "50",
        requestTimeoutSeconds: "90",
        maxBodyBytes: "1048576",
      },
      auth: { accountTokens: ["tok-a", "tok-b"], allowAnyAccountToken: "false", transactionTokenSecret: "0123456789abcdef0123" },
      webhook: { allowedHosts: ["odoo.example.com", "*.example.org"], maxAttempts: "5", initialBackoffMs: "250", timeoutSeconds: "120" },
      providers: {
        openai: { apiKey: "oa-key", baseUrl: "http://embeddings.internal:8000/v1" },
        openrouter: { apiKey: "or-key", baseUrl: "https://llm.example.com/api/v1", headers: { "X-Title": "Odoo" } },
      },
      tiers: [
        { name: "fast", provider: "openrouter", model: "glm-5.2", effort: "low" },
        { name: "deep-think", provider: "openrouter", model: "anthropic/claude-x", effort: "high", maxOutputTokens: 8000 },
      ],
      routing: {
        default: "fast",
        agent: "deep-think",
        features: { image_generation: { provider: "openrouter", model: "google/gemini-image" }, web_grounding: "fast" },
        routes: {
          "1/get_embeddings": { provider: "openai", model: "bge-m3", name: "text-embedding-3-small" },
          "1/get_transcription": { provider: "openai", model: "whisper-1" },
        },
        usages: {
          channel_name: "fast",
          "agent:ai_website.x": { provider: "openrouter", model: "z-ai/glm-5.2", effort: "medium" },
          ai_field: { provider: "openrouter", model: "m" },
        },
      },
      embeddings: { additional: [{ provider: "openai", model: "old-model" }, { provider: "openai", model: "older" }] },
    });
    const config = parseConfig(input);
    expect(config.server.port).toBe(9090);
    expect(config.server.maxBodyBytes).toBe(1048576);
    expect(config.auth.allowAnyAccountToken).toBe(false);
    expect(config.webhook.maxAttempts).toBe(5);
    expect(config.tiers.map((tier) => tier.name)).toEqual(["fast", "deep-think"]);
    expect(Object.keys(config.providers).sort()).toEqual(["openai", "openrouter"]);
  });

  it("builds the minimal config with schema defaults", () => {
    const config = loadConfigFromEnv(minimal);
    expect(config.server.port).toBe(8080);
    expect(config.routing.default).toEqual({ provider: "openai", model: "gpt-5.6" });
    expect(config.tiers).toEqual([]);
  });

  it("treats empty variables as unset", () => {
    const config = loadConfigFromEnv({
      ...minimal,
      GATEWAY_PORT: "",
      GATEWAY_HOST: " ",
      GATEWAY_TIERS: "",
      GATEWAY_USAGES: "",
      GATEWAY_ROUTE_AGENT: "",
      GATEWAY_WEBHOOK_ALLOWED_HOSTS: "",
      GATEWAY_PROVIDER_CLAUDE_API_KEY: "",
      GATEWAY_EMBEDDINGS_ADDITIONAL: "",
    });
    expect(config.server.port).toBe(8080);
    expect(config.server.host).toBe("0.0.0.0");
    expect(config.webhook.allowedHosts).toBeUndefined();
    expect(config.routing.agent).toBeUndefined();
    expect(config.providers.claude).toBeUndefined();
  });

  it("reads the typed server and auth values", () => {
    const config = loadConfigFromEnv({ GATEWAY_ROUTE_DEFAULT: "openai:m", GATEWAY_PROVIDER_OPENAI_API_KEY: "k", GATEWAY_ALLOW_ANY_ACCOUNT_TOKEN: "Yes" });
    expect(config.auth.allowAnyAccountToken).toBe(true);
  });
});

describe("parseEntry", () => {
  it("parses compact targets", () => {
    expect(parseEntry("openrouter:glm-5.2", "V")).toEqual({ provider: "openrouter", model: "glm-5.2" });
    expect(parseEntry("openai:gpt-5.6@low", "V")).toEqual({ provider: "openai", model: "gpt-5.6", effort: "low" });
    expect(parseEntry("openrouter:anthropic/claude-x", "V")).toEqual({ provider: "openrouter", model: "anthropic/claude-x" });
    expect(parseEntry("openrouter:qwen/qwen3:free@high", "V")).toEqual({ provider: "openrouter", model: "qwen/qwen3:free", effort: "high" });
    expect(parseEntry("openrouter:org/model@v2", "V")).toEqual({ provider: "openrouter", model: "org/model@v2" });
  });

  it("returns a tier name as is", () => {
    expect(parseEntry("balanced", "V")).toBe("balanced");
  });

  it("parses a JSON object", () => {
    expect(parseEntry('{"provider": "openai", "model": "m", "capabilities": {"tools": true}}', "V")).toEqual({
      provider: "openai",
      model: "m",
      capabilities: { tools: true },
    });
  });

  it("names the variable on invalid JSON", () => {
    expect(() => parseEntry("{provider: openai}", "GATEWAY_ROUTE_DEFAULT")).toThrow(/GATEWAY_ROUTE_DEFAULT/);
  });
});

describe("configFromEnv errors", () => {
  it("rejects a listed tier without its variable", () => {
    expect(() => configFromEnv({ ...minimal, GATEWAY_TIERS: "fast,deep-think", GATEWAY_TIER_FAST: "openai:m" })).toThrow(/GATEWAY_TIER_DEEP_THINK/);
  });

  it("rejects a tier that names another tier", () => {
    expect(() => configFromEnv({ ...minimal, GATEWAY_TIERS: "fast", GATEWAY_TIER_FAST: "balanced" })).toThrow(/GATEWAY_TIER_FAST/);
  });

  it("names the variable holding invalid JSON", () => {
    expect(() => configFromEnv({ ...minimal, GATEWAY_USAGES: "{nope" })).toThrow(/GATEWAY_USAGES/);
    expect(() => configFromEnv({ ...minimal, GATEWAY_PROVIDER_OPENAI_HEADERS: "[1" })).toThrow(/GATEWAY_PROVIDER_OPENAI_HEADERS/);
    expect(() => configFromEnv({ ...minimal, GATEWAY_EMBEDDINGS_ADDITIONAL: "[" })).toThrow(/GATEWAY_EMBEDDINGS_ADDITIONAL/);
    expect(() => configFromEnv({ ...minimal, GATEWAY_ROUTE_GET_EMBEDDINGS: '{"provider": ' })).toThrow(/GATEWAY_ROUTE_GET_EMBEDDINGS/);
  });

  it("never repeats the invalid JSON text", () => {
    let message = "";
    try {
      configFromEnv({ ...minimal, GATEWAY_PROVIDER_OPENAI_HEADERS: '{"X":sk-SECRET}' });
    } catch (error) {
      message = (error as Error).message;
      expect((error as Error).cause).toBeUndefined();
    }
    expect(message).toMatch(/^GATEWAY_PROVIDER_OPENAI_HEADERS: invalid JSON/);
    expect(message).not.toContain("sk-SECRET");
  });

  it("rejects tier names that cannot map to a variable, or map to the same one", () => {
    expect(() => configFromEnv({ ...minimal, GATEWAY_TIERS: "fast.v2", "GATEWAY_TIER_FAST.V2": "openai:m" })).toThrow(/GATEWAY_TIERS.*fast\.v2/);
    expect(() => configFromEnv({ ...minimal, GATEWAY_TIERS: "Fast,fast", GATEWAY_TIER_FAST: "openai:m" })).toThrow(/GATEWAY_TIERS.*GATEWAY_TIER_FAST/);
    expect(() => configFromEnv({ ...minimal, GATEWAY_TIERS: "deep-think,deep_think", GATEWAY_TIER_DEEP_THINK: "openai:m" })).toThrow(/GATEWAY_TIERS/);
  });

  it("requires GATEWAY_ROUTE_DEFAULT", () => {
    expect(() => configFromEnv({ GATEWAY_PROVIDER_OPENAI_API_KEY: "k" })).toThrow(/GATEWAY_ROUTE_DEFAULT/);
  });

  it("rejects a provider used by a route without its API key", () => {
    expect(() => loadConfigFromEnv({ ...minimal, GATEWAY_ROUTE_AGENT: "claude:claude-opus-5-5" })).toThrow(
      /routing\.agent \(GATEWAY_ROUTE_AGENT\): provider "claude" has no credentials under "providers"/,
    );
  });

  it("points schema errors at the variable", () => {
    expect(() => loadConfigFromEnv({ ...minimal, GATEWAY_PORT: "abc" })).toThrow(/server\.port \(GATEWAY_PORT\)/);
    expect(() => loadConfigFromEnv({ ...minimal, GATEWAY_TIERS: "fast", GATEWAY_TIER_FAST: "mistral:m" })).toThrow(/GATEWAY_TIER_FAST/);
    expect(() => loadConfigFromEnv({ ...minimal, GATEWAY_USAGES: '{"x": "nope"}' })).toThrow(/routing\.usages\.x \(GATEWAY_USAGES\): unknown tier "nope"/);
    expect(() => loadConfigFromEnv({ ...minimal, GATEWAY_ROUTE_GET_COMPLETIONS_SYNC: "nope" })).toThrow(
      /routing\.routes\.1\/get_completions_sync \(GATEWAY_ROUTE_GET_COMPLETIONS_SYNC\): unknown tier "nope"/,
    );
    expect(() => loadConfigFromEnv({ ...minimal, GATEWAY_ROUTE_GET_COMPLETIONS: "openai:" })).toThrow(
      /routing\.routes\.1\/get_completions\.model \(GATEWAY_ROUTE_GET_COMPLETIONS\)/,
    );
  });
});

describe("configSource", () => {
  const none = () => false;

  it("prefers ODOO_AI_GATEWAY_CONFIG", () => {
    expect(configSource({ ODOO_AI_GATEWAY_CONFIG: "/etc/gw.yaml", GATEWAY_ROUTE_DEFAULT: "x" }, () => true)).toEqual({ path: "/etc/gw.yaml" });
  });

  it("prefers a config file in the working directory over the environment", () => {
    expect(configSource({ GATEWAY_ROUTE_DEFAULT: "x" }, (file) => file === "gateway.config.yml")).toEqual({ path: "gateway.config.yml" });
  });

  it("falls back to the environment", () => {
    expect(configSource({ GATEWAY_ROUTE_DEFAULT: "x" }, none)).toEqual({ env: true });
  });

  it("names both options when nothing is configured", () => {
    expect(() => configSource({ GATEWAY_ROUTE_DEFAULT: "" }, none)).toThrow(/ODOO_AI_GATEWAY_CONFIG.*GATEWAY_ROUTE_DEFAULT/s);
  });
});
