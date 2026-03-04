import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import express from "express";
import request from "supertest";
import type { Request, Response } from "express";
import { authenticate } from "./auth.js";
import { runWithAgent, getImapConfig } from "./config.js";
import * as imap from "./imap.js";

// Mock fs for agents.json
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, readFileSync: vi.fn() };
});

// Mock imap module
vi.mock("./imap.js", () => ({
  checkNewEmail: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);
const mockCheckNewEmail = vi.mocked(imap.checkNewEmail);

const AGENTS_JSON = JSON.stringify({
  agents: {
    coo: {
      apiKey: "key-coo-123",
      IMAP_HOST: "imap.biz.com",
      IMAP_USER: "coo@biz.com",
      IMAP_PASS: "secret",
    },
  },
  shared: {},
});

// Build a minimal express app with the /api/check-email route
function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/api/check-email", authenticate, async (req: Request, res: Response) => {
    const agentId = (req as unknown as Record<string, unknown>).agentId as string | undefined;
    const sinceUid = parseInt(req.query.since_uid as string || "0", 10);
    if (isNaN(sinceUid) || sinceUid < 0) {
      res.status(400).json({ error: "Invalid since_uid parameter" });
      return;
    }
    try {
      const fn = async () => {
        const imapConfig = getImapConfig();
        return await imap.checkNewEmail(imapConfig, sinceUid);
      };
      const messages = agentId ? await runWithAgent(agentId, fn) : await fn();
      res.json({ messages });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });
  return app;
}

describe("/api/check-email", () => {
  beforeEach(() => {
    vi.resetModules();
    mockReadFileSync.mockReturnValue(AGENTS_JSON);
    mockCheckNewEmail.mockReset();
  });

  it("returns empty messages when no new email", async () => {
    mockCheckNewEmail.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app)
      .get("/api/check-email?since_uid=100")
      .set("x-api-key", "key-coo-123");
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });

  it("returns new messages with metadata only", async () => {
    mockCheckNewEmail.mockResolvedValue([
      { uid: 101, from: "alice@example.com", date: "2026-03-04T10:00:00Z" },
      { uid: 102, from: "bob@example.com", date: "2026-03-04T11:00:00Z" },
    ]);
    const app = buildApp();
    const res = await request(app)
      .get("/api/check-email?since_uid=100")
      .set("x-api-key", "key-coo-123");
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0]).toEqual({
      uid: 101,
      from: "alice@example.com",
      date: "2026-03-04T10:00:00Z",
    });
    // No subject or body in response
    expect(res.body.messages[0]).not.toHaveProperty("subject");
    expect(res.body.messages[0]).not.toHaveProperty("body");
  });

  it("defaults since_uid to 0", async () => {
    mockCheckNewEmail.mockResolvedValue([]);
    const app = buildApp();
    await request(app)
      .get("/api/check-email")
      .set("x-api-key", "key-coo-123");
    expect(mockCheckNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      0,
    );
  });

  it("rejects invalid since_uid", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/check-email?since_uid=abc")
      .set("x-api-key", "key-coo-123");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/since_uid/i);
  });

  it("rejects missing auth", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/check-email");
    expect(res.status).toBe(401);
  });

  it("returns 500 on IMAP error", async () => {
    mockCheckNewEmail.mockRejectedValue(new Error("IMAP connection refused"));
    const app = buildApp();
    const res = await request(app)
      .get("/api/check-email?since_uid=0")
      .set("x-api-key", "key-coo-123");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/IMAP/);
  });
});
