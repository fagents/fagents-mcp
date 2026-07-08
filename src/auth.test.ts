import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Request, Response, NextFunction } from "express";

// Drives the authenticate() middleware directly with mock req/res/next. Auth
// resolution reads .agents/ (multi-agent) or MCP_API_KEY (single-agent), so
// each test sets up a real temp dir like config.test.ts.

let testDir: string;
let originalAgentsDir: string | undefined;
let originalApiKey: string | undefined;

function writeEmailEnv(username: string, env: Record<string, string>) {
  const dir = join(testDir, username);
  mkdirSync(dir, { recursive: true });
  const content = Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n");
  writeFileSync(join(dir, "email.env"), content);
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("authenticate", () => {
  beforeEach(() => {
    vi.resetModules();
    originalAgentsDir = process.env.AGENTS_DIR;
    originalApiKey = process.env.MCP_API_KEY;
    testDir = join(tmpdir(), `fagents-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.env.AGENTS_DIR = testDir;
    delete process.env.MCP_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAgentsDir !== undefined) process.env.AGENTS_DIR = originalAgentsDir;
    else delete process.env.AGENTS_DIR;
    if (originalApiKey !== undefined) process.env.MCP_API_KEY = originalApiKey;
    else delete process.env.MCP_API_KEY;
    if (testDir) rmSync(testDir, { recursive: true, force: true });
  });

  it("rejects a missing x-api-key header", async () => {
    writeEmailEnv("coo", { MCP_API_KEY: "key-coo-123", SMTP_HOST: "h" });
    const req = { headers: {} } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    const mod = await import("./auth.js");
    mod.authenticate(req, res, (() => { nextCalled = true; }) as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects an empty-string x-api-key header (multi-agent)", async () => {
    writeEmailEnv("coo", { MCP_API_KEY: "key-coo-123", SMTP_HOST: "h" });
    const req = { headers: { "x-api-key": "" } } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    const mod = await import("./auth.js");
    mod.authenticate(req, res, (() => { nextCalled = true; }) as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("does not authenticate an empty key against a keyless agent", async () => {
    // email.env with no MCP_API_KEY must not become a passwordless agent.
    writeEmailEnv("keyless", { SMTP_HOST: "h", IMAP_HOST: "i" });
    // A valid agent must also exist so hasAgents() is true and we reach resolution.
    writeEmailEnv("coo", { MCP_API_KEY: "key-coo-123", SMTP_HOST: "h" });
    const req = { headers: { "x-api-key": "" } } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    const mod = await import("./auth.js");
    mod.authenticate(req, res, (() => { nextCalled = true; }) as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("accepts a valid key and tags the request with agentId", async () => {
    writeEmailEnv("coo", { MCP_API_KEY: "key-coo-123", SMTP_HOST: "h" });
    const req = { headers: { "x-api-key": "key-coo-123" } } as unknown as Request & { agentId?: string };
    const res = mockRes();
    let nextCalled = false;
    const mod = await import("./auth.js");
    mod.authenticate(req, res, (() => { nextCalled = true; }) as NextFunction);
    expect(nextCalled).toBe(true);
    expect((req as unknown as Record<string, unknown>).agentId).toBe("coo");
  });

  it("fails closed when no agents and no MCP_API_KEY are configured", async () => {
    const req = { headers: { "x-api-key": "anything" } } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    const mod = await import("./auth.js");
    mod.authenticate(req, res, (() => { nextCalled = true; }) as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects an empty key in single-agent mode", async () => {
    process.env.MCP_API_KEY = "single-secret";
    const req = { headers: { "x-api-key": "" } } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    const mod = await import("./auth.js");
    mod.authenticate(req, res, (() => { nextCalled = true; }) as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("accepts the configured key in single-agent mode", async () => {
    process.env.MCP_API_KEY = "single-secret";
    const req = { headers: { "x-api-key": "single-secret" } } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    const mod = await import("./auth.js");
    mod.authenticate(req, res, (() => { nextCalled = true; }) as NextFunction);
    expect(nextCalled).toBe(true);
  });
});
