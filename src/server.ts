import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { authenticate } from "./auth.js";
import { runWithAgent, getServerConfig, getEmailConfig, getImapConfig, getEnv, getCurrentAgentId } from "./config.js";
import { sendEmail, buildRawMessage } from "./email.js";
import * as imap from "./imap.js";

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

// --- MCP Server factory ---
// Create a fresh server+transport per request (SDK requires this in stateless mode)

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "fagents-mcp",
    version: "0.1.0",
  });

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
        // Save to Sent folder (best-effort — don't fail the send)
        try {
          const imapConfig = getImapConfig();
          const raw = await buildRawMessage(config, params);
          const sentFolder = await imap.appendToSent(imapConfig, raw);
          if (sentFolder) log(`send_email saved to ${sentFolder}`);
        } catch (e) {
          log(`send_email: failed to save to Sent: ${e instanceof Error ? e.message : e}`);
        }
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

  server.tool(
    "gate_email",
    "Securely read an email: fetches it via IMAP, logs the full content to #email-log (human-visible audit log), then returns metadata to the caller. Set read_body=true to also receive the email body — content is always logged before being returned. Use this for all inbound email access.",
    {
      uid: z.number().describe("Message UID from list_emails or search_emails"),
      mailbox: z.string().optional().describe("Mailbox path (default: INBOX)"),
      read_body: z.boolean().optional().describe("If true, return email body text/HTML after logging (default: false, metadata only)"),
    },
    async ({ uid, mailbox, read_body }) => {
      const mb = mailbox || "INBOX";
      log(`gate_email uid=${uid} mailbox=${mb}`);
      try {
        const imapConfig = getImapConfig();
        const email = await imap.getMessage(imapConfig, mb, uid);

        // Log full content to #email-log BEFORE returning anything to caller
        const commsUrl = getEnv("COMMS_URL") ?? "http://127.0.0.1:9754";
        const commsToken = getEnv("COMMS_TOKEN");
        const agentId = getCurrentAgentId() ?? "unknown";

        const attachmentList = email.attachments.length > 0
          ? email.attachments.map(a => `${a.filename} (${a.contentType}, ${a.size ?? "?"}B)`).join(", ")
          : "(none)";

        const logLines = [
          `[gate_email] uid=${uid} mailbox=${mb} agent=${agentId}`,
          `From: ${email.from}`,
          `To: ${email.to}`,
          `Subject: ${email.subject}`,
          `Date: ${email.date}`,
          `MessageId: ${email.messageId ?? "(none)"}`,
          email.cc ? `Cc: ${email.cc}` : null,
          `Attachments: ${attachmentList}`,
          `---`,
          email.text ?? email.html ?? "(no body)",
        ].filter(Boolean).join("\n");

        let logged = false;
        if (commsToken) {
          try {
            const logResp = await fetch(`${commsUrl}/api/channels/email-log/messages`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${commsToken}`,
              },
              body: JSON.stringify({ message: logLines }),
            });
            logged = logResp.ok;
            if (!logged) {
              log(`gate_email: failed to log to #email-log: ${logResp.status}`);
            }
          } catch (e) {
            log(`gate_email: comms error: ${e instanceof Error ? e.message : e}`);
          }
        } else {
          log(`gate_email: no COMMS_TOKEN configured, skipping #email-log`);
        }

        // Return safe metadata. Subject/messageId excluded (attacker-controlled, injection defense).
        // Body only included if read_body=true — content is already logged before this point.
        const responseData: Record<string, unknown> = {
          uid: email.uid,
          from: email.from,
          date: email.date,
          logged,
          email_log_channel: "email-log",
        };
        if (read_body) {
          // Strip all untrusted tag variants to prevent boundary escape, then wrap in untrusted tags
          const stripUntrusted = (s: string) =>
            s.replace(/<\/?untrusted>/gi, "[TAG_STRIPPED]")
             .replace(/\[\/untrusted\]/gi, "[TAG_STRIPPED]")
             .replace(/\{\/untrusted\}/gi, "[TAG_STRIPPED]");
          if (email.text) {
            responseData.text = `<untrusted>\n${stripUntrusted(email.text)}\n</untrusted>`;
          }
          if (email.html) {
            responseData.html = `<untrusted>\n${stripUntrusted(email.html)}\n</untrusted>`;
          }
        }
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(responseData),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log(`gate_email error: ${msg}`);
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }] };
      }
    }
  );

  return server;
}

// --- Express ---

const app = express();
app.use(express.json());

app.post("/mcp", authenticate, async (req: Request, res: Response) => {
  const agentId = (req as unknown as Record<string, unknown>).agentId as string | undefined;
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — new instance per request
    });
    await server.connect(transport);

    if (agentId) {
      await runWithAgent(agentId, () => transport.handleRequest(req, res, req.body));
    } else {
      await transport.handleRequest(req, res, req.body);
    }
  } catch (error) {
    console.error("MCP request error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// --- Start ---

async function main() {
  const config = getServerConfig();
  app.listen(config.port, config.host, () => {
    log(`fagents-mcp listening on http://${config.host}:${config.port}/mcp`);
    log(`7 email tools registered`);
  });
}

main().catch(console.error);
