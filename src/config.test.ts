import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Each test creates a real temp .agents/ dir — no fs mocking needed

let testDir: string;
let originalAgentsDir: string | undefined;

function createAgentsDir(): string {
  testDir = join(tmpdir(), `fagents-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

function writeEmailEnv(username: string, env: Record<string, string>) {
  const dir = join(testDir, username);
  mkdirSync(dir, { recursive: true });
  const content = Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n");
  writeFileSync(join(dir, "email.env"), content);
}

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
    originalAgentsDir = process.env.AGENTS_DIR;
    createAgentsDir();
    process.env.AGENTS_DIR = testDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAgentsDir !== undefined) {
      process.env.AGENTS_DIR = originalAgentsDir;
    } else {
      delete process.env.AGENTS_DIR;
    }
    delete process.env.SMTP_HOST;
    delete process.env.MCP_PORT;
    if (testDir) rmSync(testDir, { recursive: true, force: true });
  });

  function setupAgents() {
    writeEmailEnv("coo", {
      MCP_API_KEY: "key-coo-123",
      SMTP_HOST: "smtp.biz.com",
      SMTP_PORT: "587",
      SMTP_FROM: "coo@biz.com",
      SMTP_USER: "shared@biz.com",
      SMTP_PASS: "secret",
      IMAP_HOST: "imap.biz.com",
      IMAP_PORT: "993",
      IMAP_USER: "shared@biz.com",
      IMAP_PASS: "secret",
    });
    writeEmailEnv("dev", {
      MCP_API_KEY: "key-dev-456",
      SMTP_HOST: "smtp.biz.com",
      SMTP_PORT: "587",
      SMTP_USER: "shared@biz.com",
      SMTP_PASS: "secret",
      IMAP_HOST: "imap.biz.com",
      IMAP_PORT: "993",
      IMAP_USER: "shared@biz.com",
      IMAP_PASS: "secret",
    });
  }

  describe("hasAgents", () => {
    it("returns true when .agents/ has email.env files", async () => {
      setupAgents();
      const mod = await import("./config.js");
      expect(mod.hasAgents()).toBe(true);
    });

    it("returns false when .agents/ is empty", async () => {
      const mod = await import("./config.js");
      expect(mod.hasAgents()).toBe(false);
    });

    it("returns false when AGENTS_DIR does not exist", async () => {
      process.env.AGENTS_DIR = "/nonexistent/path";
      const mod = await import("./config.js");
      expect(mod.hasAgents()).toBe(false);
    });
  });

  describe("resolveAgentByApiKey", () => {
    it("resolves valid key to agent ID", async () => {
      setupAgents();
      const mod = await import("./config.js");
      expect(mod.resolveAgentByApiKey("key-coo-123")).toBe("coo");
      expect(mod.resolveAgentByApiKey("key-dev-456")).toBe("dev");
    });

    it("returns null for invalid key", async () => {
      setupAgents();
      const mod = await import("./config.js");
      expect(mod.resolveAgentByApiKey("wrong-key")).toBeNull();
    });
  });

  describe("getAgentEnv", () => {
    it("returns agent-specific value", async () => {
      setupAgents();
      const mod = await import("./config.js");
      expect(mod.getAgentEnv("coo", "SMTP_FROM")).toBe("coo@biz.com");
    });

    it("returns value from agent env (no shared fallback)", async () => {
      setupAgents();
      const mod = await import("./config.js");
      expect(mod.getAgentEnv("dev", "SMTP_HOST")).toBe("smtp.biz.com");
    });

    it("never exposes apiKey", async () => {
      setupAgents();
      const mod = await import("./config.js");
      expect(mod.getAgentEnv("coo", "apiKey")).toBeUndefined();
    });

    it("returns undefined for missing key", async () => {
      setupAgents();
      const mod = await import("./config.js");
      expect(mod.getAgentEnv("coo", "NONEXISTENT")).toBeUndefined();
    });
  });

  describe("getEnv with agent context", () => {
    it("resolves agent-specific env in runWithAgent", async () => {
      setupAgents();
      const mod = await import("./config.js");
      const result = mod.runWithAgent("coo", () => mod.getEnv("SMTP_FROM"));
      expect(result).toBe("coo@biz.com");
    });

    it("resolves SMTP_HOST from agent env", async () => {
      setupAgents();
      const mod = await import("./config.js");
      const result = mod.runWithAgent("dev", () => mod.getEnv("SMTP_HOST"));
      expect(result).toBe("smtp.biz.com");
    });

    it("falls back to process.env outside agent context", async () => {
      process.env.SMTP_HOST = "env-host.com";
      const mod = await import("./config.js");
      expect(mod.getEnv("SMTP_HOST")).toBe("env-host.com");
    });
  });

  describe("getRequiredEnv", () => {
    it("throws for missing required env", async () => {
      const mod = await import("./config.js");
      expect(() => mod.getRequiredEnv("NONEXISTENT")).toThrow("Missing required config: NONEXISTENT");
    });
  });

  describe("getServerConfig", () => {
    it("returns defaults", async () => {
      const mod = await import("./config.js");
      const cfg = mod.getServerConfig();
      expect(cfg.port).toBe(3000);
      expect(cfg.host).toBe("127.0.0.1");
    });

    it("reads MCP_PORT from env", async () => {
      process.env.MCP_PORT = "8080";
      const mod = await import("./config.js");
      expect(mod.getServerConfig().port).toBe(8080);
    });
  });

  describe("getEmailConfig", () => {
    it("resolves email config in agent context", async () => {
      setupAgents();
      const mod = await import("./config.js");
      const cfg = mod.runWithAgent("coo", () => mod.getEmailConfig());
      expect(cfg.from).toBe("coo@biz.com");
      expect(cfg.host).toBe("smtp.biz.com");
    });

    it("defaults SMTP_FROM to SMTP_USER", async () => {
      setupAgents();
      const mod = await import("./config.js");
      const cfg = mod.runWithAgent("dev", () => mod.getEmailConfig());
      expect(cfg.from).toBe("shared@biz.com"); // dev has no SMTP_FROM, falls to SMTP_USER
    });
  });

  describe("parseEnvFile edge cases", () => {
    it("ignores comments and blank lines", async () => {
      writeEmailEnv("edgecase", {
        MCP_API_KEY: "key-edge-789",
      });
      // Add a comment and blank line to the file
      const filePath = join(testDir, "edgecase", "email.env");
      writeFileSync(filePath, "# This is a comment\n\nMCP_API_KEY=key-edge-789\nSMTP_HOST=test.com\n");
      const mod = await import("./config.js");
      expect(mod.resolveAgentByApiKey("key-edge-789")).toBe("edgecase");
      expect(mod.getAgentEnv("edgecase", "SMTP_HOST")).toBe("test.com");
    });

    it("handles values with = signs", async () => {
      const filePath = join(testDir, "eqtest");
      mkdirSync(filePath, { recursive: true });
      writeFileSync(join(filePath, "email.env"), "MCP_API_KEY=key-eq-000\nSMTP_PASS=p@ss=word=123\n");
      const mod = await import("./config.js");
      expect(mod.getAgentEnv("eqtest", "SMTP_PASS")).toBe("p@ss=word=123");
    });
  });
});
