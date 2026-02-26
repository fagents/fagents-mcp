import { timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { hasAgents, resolveAgentByApiKey, getServerConfig } from "./config.js";

const AUTH_ERROR = "Unauthorized: Invalid or missing API key";

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const multiAgent = hasAgents();
  const config = getServerConfig();

  const providedKey = req.headers["x-api-key"];

  if (!multiAgent && !config.apiKey) {
    // No agents.json and no MCP_API_KEY — allow (local dev)
    next();
    return;
  }

  if (typeof providedKey !== "string") {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: AUTH_ERROR },
      id: null,
    });
    return;
  }

  if (multiAgent) {
    const agentId = resolveAgentByApiKey(providedKey);
    if (!agentId) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: AUTH_ERROR },
        id: null,
      });
      return;
    }
    (req as unknown as Record<string, unknown>).agentId = agentId;
    next();
    return;
  }

  // Single-agent mode
  const keyBuf = Buffer.from(providedKey);
  const apiBuf = Buffer.from(config.apiKey!);
  if (keyBuf.length !== apiBuf.length || !timingSafeEqual(keyBuf, apiBuf)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: AUTH_ERROR },
      id: null,
    });
    return;
  }
  next();
}
