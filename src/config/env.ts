/**
 * Configuration from `GATEWAY_*` environment variables, for running the image with only an env
 * file (`docker run --env-file`, compose `env_file:`). A config file, when present, wins. Values
 * stay strings: the schema reads numbers and booleans from strings (see `numeric` / `flag`).
 * Every variable is listed in `gateway.env.example`.
 */
import { EFFORTS, PROVIDER_NAMES } from "../providers/types.js";
import { parseConfig } from "./load.js";
import { ROUTES, type GatewayConfig, type GatewayConfigInput } from "./schema.js";

type Env = Record<string, string | undefined>;
type EntryInput = GatewayConfigInput["routing"]["default"];
type TargetInput = Exclude<EntryInput, string>;

export const CONFIG_FILES = ["gateway.config.yaml", "gateway.config.yml", "gateway.config.json"] as const;
const SERVER = {
  host: "GATEWAY_HOST",
  port: "GATEWAY_PORT",
  completionTimeoutSeconds: "GATEWAY_COMPLETION_TIMEOUT_SECONDS",
  syncTimeoutSeconds: "GATEWAY_SYNC_TIMEOUT_SECONDS",
  requestTimeoutSeconds: "GATEWAY_REQUEST_TIMEOUT_SECONDS",
  maxBodyBytes: "GATEWAY_MAX_BODY_BYTES",
} as const;
const AUTH = {
  accountTokens: "GATEWAY_ACCOUNT_TOKENS",
  allowAnyAccountToken: "GATEWAY_ALLOW_ANY_ACCOUNT_TOKEN",
  transactionTokenSecret: "GATEWAY_TRANSACTION_TOKEN_SECRET",
} as const;
const WEBHOOK = {
  allowedHosts: "GATEWAY_WEBHOOK_ALLOWED_HOSTS",
  maxAttempts: "GATEWAY_WEBHOOK_MAX_ATTEMPTS",
  initialBackoffMs: "GATEWAY_WEBHOOK_INITIAL_BACKOFF_MS",
  timeoutSeconds: "GATEWAY_WEBHOOK_TIMEOUT_SECONDS",
} as const;
const PROVIDER_FIELDS = { apiKey: "API_KEY", baseUrl: "BASE_URL", headers: "HEADERS" } as const;
const FEATURES = { image_generation: "GATEWAY_ROUTE_IMAGE_GENERATION", web_grounding: "GATEWAY_ROUTE_WEB_GROUNDING" } as const;

/** `1/get_embeddings` -> `GATEWAY_ROUTE_GET_EMBEDDINGS`. */
const routeVariable = (route: string) => `GATEWAY_ROUTE_${route.replace(/^1\//, "").toUpperCase()}`;
/** `deep-think` -> `GATEWAY_TIER_DEEP_THINK`. */
const tierVariable = (tier: string) => `GATEWAY_TIER_${tier.toUpperCase().replaceAll("-", "_")}`;

/** Unset and empty (or blank) variables are the same: the schema default applies. */
function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

const list = (value: string | undefined) => value?.split(",").map((item) => item.trim()).filter(Boolean);

function json(value: string, variable: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    // The parser's message quotes the input, which may hold a secret (headers): keep only the position.
    const position = /position \d+/.exec((error as Error).message)?.[0];
    throw new Error(`${variable}: invalid JSON${position ? ` at ${position}` : ""}`);
  }
}

/**
 * One routing entry: `{...}` is a JSON target; `provider:model[@effort]` a compact target, split at
 * the first `:` (the model may hold `:` and `/`), with `@effort` only when it names an effort;
 * anything else is a tier name.
 */
export function parseEntry(value: string, variable: string): EntryInput {
  if (value.startsWith("{")) return json(value, variable) as TargetInput;
  const colon = value.indexOf(":");
  if (colon < 0) return value;
  const provider = value.slice(0, colon) as TargetInput["provider"];
  const model = value.slice(colon + 1);
  const at = model.lastIndexOf("@");
  const effort = model.slice(at + 1);
  if (at >= 0 && (EFFORTS as readonly string[]).includes(effort)) {
    return { provider, model: model.slice(0, at), effort: effort as TargetInput["effort"] };
  }
  return { provider, model };
}

/** Drop the keys left undefined, so the result only holds what the environment set. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

/** Plain string fields, `{field: VARIABLE}` -> `{field: value}`. */
function strings(env: Env, variables: Record<string, string>): Record<string, string> {
  return defined(Object.fromEntries(Object.entries(variables).map(([key, name]) => [key, read(env, name)]))) as Record<string, string>;
}

/** Build the raw config from the environment; `parseConfig` validates it. */
export function configFromEnv(env: Env = process.env): GatewayConfigInput {
  const entry = (variable: string) => {
    const value = read(env, variable);
    return value === undefined ? undefined : parseEntry(value, variable);
  };
  const jsonVariable = (variable: string) => {
    const value = read(env, variable);
    return value === undefined ? undefined : json(value, variable);
  };
  /** String items of a JSON value go through `parseEntry` like any other entry. */
  const entryItem = (variable: string) => (item: unknown) => (typeof item === "string" ? parseEntry(item, variable) : item);

  const routeDefault = entry("GATEWAY_ROUTE_DEFAULT");
  if (routeDefault === undefined) throw new Error("GATEWAY_ROUTE_DEFAULT is required to configure the gateway from the environment");

  // A provider exists only when its API key is set.
  const providers: Record<string, unknown> = {};
  for (const name of PROVIDER_NAMES) {
    const prefix = `GATEWAY_PROVIDER_${name.toUpperCase()}_`;
    const apiKey = read(env, prefix + PROVIDER_FIELDS.apiKey);
    if (apiKey === undefined) continue;
    const baseUrl = read(env, prefix + PROVIDER_FIELDS.baseUrl);
    providers[name] = defined({ apiKey, baseUrl, headers: jsonVariable(prefix + PROVIDER_FIELDS.headers) });
  }

  const tierNames = list(read(env, "GATEWAY_TIERS")) ?? [];
  const tierVariables = new Map<string, string>();
  for (const name of tierNames) {
    if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`GATEWAY_TIERS: tier name "${name}" may only hold letters, digits, "-" and "_"`);
    const other = tierVariables.get(tierVariable(name));
    if (other !== undefined) throw new Error(`GATEWAY_TIERS: tiers "${other}" and "${name}" both read ${tierVariable(name)}`);
    tierVariables.set(tierVariable(name), name);
  }
  const tiers = tierNames.map((name) => {
    const variable = tierVariable(name);
    const target = entry(variable);
    if (target === undefined) throw new Error(`GATEWAY_TIERS lists "${name}", but ${variable} is not set`);
    if (typeof target === "string") {
      throw new Error(`${variable}: a tier must be a target (provider:model[@effort] or a JSON object), not the tier name "${target}"`);
    }
    return { ...target, name };
  });

  // Usage keys ("agent:ai_website.x") cannot be variable names: one JSON object for all of them.
  const usages = jsonVariable("GATEWAY_USAGES");
  const additional = jsonVariable("GATEWAY_EMBEDDINGS_ADDITIONAL");
  const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

  return defined({
    server: strings(env, SERVER),
    auth: defined({ ...strings(env, AUTH), accountTokens: list(read(env, AUTH.accountTokens)) }),
    webhook: defined({ ...strings(env, WEBHOOK), allowedHosts: list(read(env, WEBHOOK.allowedHosts)) }),
    providers,
    tiers,
    routing: defined({
      default: routeDefault,
      agent: entry("GATEWAY_ROUTE_AGENT"),
      features: defined({ image_generation: entry(FEATURES.image_generation), web_grounding: entry(FEATURES.web_grounding) }),
      routes: defined(Object.fromEntries(ROUTES.map((route) => [route, entry(routeVariable(route))]))),
      usages: isRecord(usages)
        ? Object.fromEntries(Object.entries(usages).map(([usage, value]) => [usage, entryItem("GATEWAY_USAGES")(value)]))
        : usages,
    }),
    embeddings: defined({
      additional: Array.isArray(additional) ? additional.map(entryItem("GATEWAY_EMBEDDINGS_ADDITIONAL")) : additional,
    }),
  }) as GatewayConfigInput;
}

/** The variable behind a config path, so a validation error points at what to fix. */
function variableFor(path: string, tierNames: string[]): string | undefined {
  const [head, key, field] = path.split(".");
  switch (head) {
    case "server":
      return SERVER[key as keyof typeof SERVER];
    case "auth":
      // The "auth: set auth.accountTokens ..." cross-check has no field.
      return AUTH[(key ?? "accountTokens") as keyof typeof AUTH];
    case "webhook":
      return WEBHOOK[key as keyof typeof WEBHOOK];
    case "providers": {
      const suffix = PROVIDER_FIELDS[(field ?? "apiKey") as keyof typeof PROVIDER_FIELDS];
      return key && suffix ? `GATEWAY_PROVIDER_${key.toUpperCase()}_${suffix}` : undefined;
    }
    case "tiers": {
      // zod reports the index ("tiers.0.model"), the cross-checks the name ("tiers.fast").
      const name = /^\d+$/.test(key ?? "") ? tierNames[Number(key)] : key;
      return name === undefined ? "GATEWAY_TIERS" : tierVariable(name);
    }
    case "embeddings":
      return "GATEWAY_EMBEDDINGS_ADDITIONAL";
    case "routing": {
      if (key === "default" || key === "agent") return `GATEWAY_ROUTE_${key.toUpperCase()}`;
      if (key === "usages") return "GATEWAY_USAGES";
      if (key === "features") return FEATURES[field as keyof typeof FEATURES];
      // Route keys hold a "/" but no ".": the route is everything up to the next "." (one prefixes another).
      const route = ROUTES.find((candidate) => path === `routing.routes.${candidate}` || path.startsWith(`routing.routes.${candidate}.`));
      return route && routeVariable(route);
    }
  }
  return undefined;
}

/** `configFromEnv` + `parseConfig`, with the variable named next to each problem's config path. */
export function loadConfigFromEnv(env: Env = process.env): GatewayConfig {
  const input = configFromEnv(env);
  try {
    return parseConfig(input);
  } catch (error) {
    const tierNames = (input.tiers ?? []).map((tier) => tier.name);
    const message = (error as Error).message.replace(/^ {2}- (.+?): /gm, (line, path: string) => {
      const variable = variableFor(path, tierNames);
      return variable ? `  - ${path} (${variable}): ` : line;
    });
    throw new Error(message, { cause: error });
  }
}

/**
 * Where the config comes from: $ODOO_AI_GATEWAY_CONFIG, else ./gateway.config.{yaml,yml,json},
 * else the environment when GATEWAY_ROUTE_DEFAULT is set.
 */
export function configSource(env: Env, exists: (file: string) => boolean): { path: string } | { env: true } {
  const explicit = env.ODOO_AI_GATEWAY_CONFIG;
  if (explicit) return { path: explicit };
  const candidate = CONFIG_FILES.find((file) => exists(file));
  if (candidate) return { path: candidate };
  if (read(env, "GATEWAY_ROUTE_DEFAULT")) return { env: true };
  throw new Error(
    "No config found: set ODOO_AI_GATEWAY_CONFIG or create gateway.config.yaml (see gateway.config.example.yaml), " +
      "or set GATEWAY_ROUTE_DEFAULT and the other GATEWAY_* variables (see gateway.env.example)",
  );
}
