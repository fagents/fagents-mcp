import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { authenticate } from "./auth.js";
import { runWithAgent, getServerConfig, getEmailConfig, getImapConfig } from "./config.js";
import { sendEmail } from "./email.js";
import * as imap from "./imap.js";

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

// --- MCP Server ---

const server = new McpServer({
  name: "fagents-mcp",
  version: "0.1.0",
});

// --- Email tools ---

server.tool(
  "send_email",
  "Send an email via SMTP. Supports plain text, HTML, and file attachments.",
  {
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject line"),
    body: z.string().describe("Email body text (plain text)"),
    html: z.string().optional().describe("Email body HTML (optional, sent alongside plain text)"),
    cc: z.string().optional().describe("CC recipients (comma-separated)"),
    bcc: z.string().optional().describe("BCC recipients (comma-separated)"),
    attachments: z.array(z.object({
      filename: z.string().describe("Attachment filename"),
      content: z.string().describe("Base64-encoded file content"),
      contentType: z.string().optional().describe("MIME type (e.g. application/pdf)"),
    })).optional().describe("File attachments"),
  },
  async (params) => {
    log(`send_email to=${params.to} subject="${params.subject}"`);
    try {
      const config = getEmailConfig();
      const result = await sendEmail(config, params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`send_email error: ${msg}`);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  "list_mailboxes",
  "List available email mailboxes/folders via IMAP",
  {},
  async () => {
    log("list_mailboxes");
    try {
      const config = getImapConfig();
      const result = await imap.listMailboxes(config);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`list_mailboxes error: ${msg}`);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  "list_emails",
  "List email messages in a mailbox folder. Returns newest first.",
  {
    mailbox: z.string().optional().describe("Mailbox path (default: INBOX)"),
    limit: z.number().optional().describe("Max messages to return (default: 20)"),
    offset: z.number().optional().describe("Skip N newest messages (default: 0)"),
  },
  async ({ mailbox, limit, offset }) => {
    log(`list_emails mailbox=${mailbox || "INBOX"}`);
    try {
      const config = getImapConfig();
      const result = await imap.listMessages(config, mailbox || "INBOX", limit || 20, offset || 0);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`list_emails error: ${msg}`);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  "read_email",
  "Read a full email message by UID, including body text/HTML and attachment info",
  {
    uid: z.number().describe("Message UID from list_emails or search_emails"),
    mailbox: z.string().optional().describe("Mailbox path (default: INBOX)"),
  },
  async ({ uid, mailbox }) => {
    log(`read_email uid=${uid} mailbox=${mailbox || "INBOX"}`);
    try {
      const config = getImapConfig();
      const result = await imap.getMessage(config, mailbox || "INBOX", uid);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`read_email error: ${msg}`);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  "search_emails",
  "Search emails in a mailbox by criteria (from, to, subject, date range, unseen, text)",
  {
    mailbox: z.string().optional().describe("Mailbox path (default: INBOX)"),
    from: z.string().optional().describe("Filter by sender address"),
    to: z.string().optional().describe("Filter by recipient address"),
    subject: z.string().optional().describe("Filter by subject text"),
    since: z.string().optional().describe("Messages since date (ISO 8601, e.g. 2026-01-01)"),
    before: z.string().optional().describe("Messages before date (ISO 8601)"),
    unseen: z.boolean().optional().describe("Only unread messages"),
    text: z.string().optional().describe("Search in message body text"),
  },
  async ({ mailbox, ...criteria }) => {
    log(`search_emails mailbox=${mailbox || "INBOX"}`);
    try {
      const config = getImapConfig();
      const result = await imap.searchMessages(config, mailbox || "INBOX", criteria);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`search_emails error: ${msg}`);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  "download_attachment",
  "Download an email attachment by part number. Returns base64-encoded content.",
  {
    uid: z.number().describe("Message UID from list_emails or search_emails"),
    part: z.string().describe("Attachment part number from read_email attachments list"),
    mailbox: z.string().optional().describe("Mailbox path (default: INBOX)"),
  },
  async ({ uid, part, mailbox }) => {
    log(`download_attachment uid=${uid} part=${part}`);
    try {
      const config = getImapConfig();
      const result = await imap.downloadAttachment(config, mailbox || "INBOX", uid, part);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`download_attachment error: ${msg}`);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }] };
    }
  }
);

// --- Express + Transport ---

const app = express();
app.use(express.json());

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // stateless
});

app.post("/mcp", authenticate, async (req: Request, res: Response) => {
  const agentId = (req as unknown as Record<string, unknown>).agentId as string | undefined;
  try {
    if (agentId) {
      await runWithAgent(agentId, () => transport.handleRequest(req, res, req.body));
    } else {
      await transport.handleRequest(req, res, req.body);
    }
  } catch (error) {
    console.error("MCP request error:", error);
    res.status(500).json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal server error" },
      id: null,
    });
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// --- Start ---

async function main() {
  await server.connect(transport);
  const config = getServerConfig();
  app.listen(config.port, config.host, () => {
    log(`fagents-mcp listening on http://${config.host}:${config.port}/mcp`);
    log(`6 email tools registered`);
  });
}

main().catch(console.error);
