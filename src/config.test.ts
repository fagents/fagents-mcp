import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import {
  hasAgents, resolveAgentByApiKey, getAgentEnv,
  getEnv, getRequiredEnv, runWithAgent,
  getEmailConfig, getImapConfig, getServerConfig,
} from "./config.js";

// Mock fs to control agents.json loading
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, readFileSync: vi.fn() };
});

const mockReadFileSync = vi.mocked(readFileSync);

const AGENTS_JSON = JSON.stringify({
  agents: {
    coo: { apiKey: "key-coo-123", SMTP_FROM: "coo@biz.com" },
    dev: { apiKey: "key-dev-456" },
  },
  shared: {
    SMTP_HOST: "smtp.biz.com",
    SMTP_PORT: "587",
    SMTP_USER: "shared@biz.com",
    SMTP_PASS: "secret",
    IMAP_HOST: "imap.biz.com",
    IMAP_PORT: "993",
    IMAP_USER: "shared@biz.com",
    IMAP_PASS: "secret",
  },
});

function setupAgents() {
  mockReadFileSync.mockReturnValue(AGENTS_JSON);
  // Force reload by clearing module cache — agents.json is cached
  // We need to re-import to reset. For now, use a fresh import per test file.
}

function setupNoAgents() {
  mockReadFileSync.mockImplementation(() => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); });
}

describe("config", () => {
  beforeEach(() => {
    // Reset cached config by reimporting — vitest handles module isolation
    vi.resetModules();
    setupAgents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SMTP_HOST;
    delete process.env.MCP_PORT;
  });

  describe("hasAgents", () => {
    it("returns true when agents.json has agents", async () => {
      const mod = await import("./config.js");
      expect(mod.hasAgents()).toBe(true);
    });

    it("returns false when no agents.json", async () => {
      setupNoAgents();
      const mod = await import("./config.js");
      expect(mod.hasAgents()).toBe(false);
    });
  });

  describe("resolveAgentByApiKey", () => {
    it("resolves valid key to agent ID", async () => {
      const mod = await import("./config.js");
      expect(mod.resolveAgentByApiKey("key-coo-123")).toBe("coo");
      expect(mod.resolveAgentByApiKey("key-dev-456")).toBe("dev");
    });

    it("returns null for invalid key", async () => {
      const mod = await import("./config.js");
      expect(mod.resolveAgentByApiKey("wrong-key")).toBeNull();
    });
  });

  describe("getAgentEnv", () => {
    it("returns agent-specific value", async () => {
      const mod = await import("./config.js");
      expect(mod.getAgentEnv("coo", "SMTP_FROM")).toBe("coo@biz.com");
    });

    it("falls back to shared value", async () => {
      const mod = await import("./config.js");
      expect(mod.getAgentEnv("dev", "SMTP_HOST")).toBe("smtp.biz.com");
    });

    it("never exposes apiKey", async () => {
      const mod = await import("./config.js");
      expect(mod.getAgentEnv("coo", "apiKey")).toBeUndefined();
    });

    it("returns undefined for missing key", async () => {
      const mod = await import("./config.js");
      expect(mod.getAgentEnv("coo", "NONEXISTENT")).toBeUndefined();
    });
  });

  describe("getEnv with agent context", () => {
    it("resolves agent-specific env in runWithAgent", async () => {
      const mod = await import("./config.js");
      const result = mod.runWithAgent("coo", () => mod.getEnv("SMTP_FROM"));
      expect(result).toBe("coo@biz.com");
    });

    it("falls back to shared in agent context", async () => {
      const mod = await import("./config.js");
      const result = mod.runWithAgent("dev", () => mod.getEnv("SMTP_HOST"));
      expect(result).toBe("smtp.biz.com");
    });

    it("falls back to process.env outside agent context", async () => {
      process.env.SMTP_HOST = "env-host.com";
      setupNoAgents();
      const mod = await import("./config.js");
      expect(mod.getEnv("SMTP_HOST")).toBe("env-host.com");
    });
  });

  describe("getRequiredEnv", () => {
    it("throws for missing required env", async () => {
      setupNoAgents();
      const mod = await import("./config.js");
      expect(() => mod.getRequiredEnv("NONEXISTENT")).toThrow("Missing required config: NONEXISTENT");
    });
  });

  describe("getServerConfig", () => {
    it("returns defaults", async () => {
      setupNoAgents();
      const mod = await import("./config.js");
      const cfg = mod.getServerConfig();
      expect(cfg.port).toBe(3000);
      expect(cfg.host).toBe("127.0.0.1");
    });

    it("reads MCP_PORT from env", async () => {
      process.env.MCP_PORT = "8080";
      setupNoAgents();
      const mod = await import("./config.js");
      expect(mod.getServerConfig().port).toBe(8080);
    });
  });

  describe("getEmailConfig", () => {
    it("resolves email config in agent context", async () => {
      const mod = await import("./config.js");
      const cfg = mod.runWithAgent("coo", () => mod.getEmailConfig());
      expect(cfg.from).toBe("coo@biz.com"); // agent override
      expect(cfg.host).toBe("smtp.biz.com"); // shared
    });

    it("defaults SMTP_FROM to SMTP_USER", async () => {
      const mod = await import("./config.js");
      const cfg = mod.runWithAgent("dev", () => mod.getEmailConfig());
      expect(cfg.from).toBe("shared@biz.com"); // dev has no SMTP_FROM, falls to SMTP_USER
    });
  });
});
