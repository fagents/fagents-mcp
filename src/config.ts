import { readFileSync } from "fs";
import { resolve } from "path";
import { timingSafeEqual } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import type { AgentsFile } from "./types.js";

// --- Agent context (AsyncLocalStorage) ---

const storage = new AsyncLocalStorage<{ agentId: string }>();

export function runWithAgent<T>(agentId: string, fn: () => T): T {
  return storage.run({ agentId }, fn);
}

export function getCurrentAgentId(): string | undefined {
  return storage.getStore()?.agentId;
}

// --- Agents config loading ---

let agentsConfig: AgentsFile | null = null;

function loadAgentsConfig(): AgentsFile {
  if (agentsConfig) return agentsConfig;

  const configPath = resolve(process.cwd(), "agents.json");
  try {
    const raw = readFileSync(configPath, "utf-8");
    agentsConfig = JSON.parse(raw) as AgentsFile;
    return agentsConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      agentsConfig = { agents: {}, shared: {} };
      return agentsConfig;
    }
    throw new Error(`Failed to load agents.json: ${(error as Error).message}`);
  }
}

export function hasAgents(): boolean {
  return Object.keys(loadAgentsConfig().agents).length > 0;
}

export function resolveAgentByApiKey(apiKey: string): string | null {
  const config = loadAgentsConfig();
  const keyBuf = Buffer.from(apiKey);

  for (const [agentId, agentConfig] of Object.entries(config.agents)) {
    const storedBuf = Buffer.from(agentConfig.apiKey);
    if (keyBuf.length === storedBuf.length && timingSafeEqual(keyBuf, storedBuf)) {
      return agentId;
    }
  }
  return null;
}

export function getAgentEnv(agentId: string, key: string): string | undefined {
  const config = loadAgentsConfig();
  const agent = config.agents[agentId];
  if (agent && key in agent && key !== "apiKey") {
    return agent[key];
  }
  if (config.shared && key in config.shared) {
    return config.shared[key];
  }
  return undefined;
}

// --- Environment resolution ---

export function getEnv(key: string): string | undefined {
  const agentId = getCurrentAgentId();
  if (agentId) {
    const val = getAgentEnv(agentId, key);
    if (val !== undefined) return val;
  }
  return process.env[key] || undefined;
}

export function getRequiredEnv(key: string): string {
  const val = getEnv(key);
  if (!val) {
    const agentId = getCurrentAgentId();
    const ctx = agentId ? ` (agent: ${agentId})` : "";
    throw new Error(`Missing required config: ${key}${ctx}`);
  }
  return val;
}

// --- Server config ---

export function getServerConfig() {
  const portStr = getEnv("MCP_PORT") ?? "3000";
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid MCP_PORT: ${portStr}`);
  }
  const host = getEnv("MCP_HOST") ?? "127.0.0.1";
  const apiKey = getEnv("MCP_API_KEY");
  return { port, host, apiKey };
}

// --- Email/IMAP config helpers ---

export function getEmailConfig() {
  return {
    host: getRequiredEnv("SMTP_HOST"),
    port: parseInt(getEnv("SMTP_PORT") ?? "587", 10),
    from: getEnv("SMTP_FROM") ?? getRequiredEnv("SMTP_USER"),
    user: getEnv("SMTP_USER"),
    pass: getEnv("SMTP_PASS"),
  };
}

export function getImapConfig() {
  return {
    host: getRequiredEnv("IMAP_HOST"),
    port: parseInt(getEnv("IMAP_PORT") ?? "993", 10),
    user: getRequiredEnv("IMAP_USER"),
    pass: getRequiredEnv("IMAP_PASS"),
    tls: (getEnv("IMAP_TLS") ?? "true") !== "false",
  };
}
