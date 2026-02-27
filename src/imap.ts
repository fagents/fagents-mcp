import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { ImapConfig, MailboxInfo, EmailEnvelope, EmailFull, AttachmentInfo, SearchCriteria } from "./types.js";

async function withClient<T>(config: ImapConfig, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls !== false,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout();
  }
}

function formatAddr(addr: { name?: string; address?: string } | undefined): string {
  if (!addr) return "";
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address || "";
}

function formatAddrList(addrs: Array<{ name?: string; address?: string }> | undefined): string {
  if (!addrs?.length) return "";
  return addrs.map(formatAddr).join(", ");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function envelopeToEntry(msg: any): EmailEnvelope {
  const env = msg.envelope || {};
  return {
    uid: msg.uid,
    from: formatAddrList(env.from),
    to: formatAddrList(env.to),
    subject: env.subject || "",
    date: env.date?.toISOString?.() || "",
    flags: [...(msg.flags || [])].map(String),
    messageId: env.messageId || undefined,
  };
}

export async function listMailboxes(config: ImapConfig): Promise<MailboxInfo[]> {
  return withClient(config, async (client) => {
    const mailboxes = await client.list();
    return mailboxes.map(mb => ({
      path: mb.path,
      name: mb.name,
      flags: [...(mb.flags || [])].map(String),
      specialUse: mb.specialUse || undefined,
    }));
  });
}

export async function listMessages(config: ImapConfig, mailbox: string, limit = 20, offset = 0): Promise<EmailEnvelope[]> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const status = await client.status(mailbox, { messages: true });
      const total = status.messages ?? 0;
      if (total === 0) return [];

      const end = Math.max(1, total - offset);
      const start = Math.max(1, end - limit + 1);
      if (end < 1) return [];

      const messages: EmailEnvelope[] = [];
      for await (const msg of client.fetch(`${start}:${end}`, { uid: true, flags: true, envelope: true })) {
        if (!msg) continue;
        messages.push(envelopeToEntry(msg));
      }
      messages.reverse();
      return messages;
    } finally {
      lock.release();
    }
  });
}

export async function getMessage(config: ImapConfig, mailbox: string, uid: number): Promise<EmailFull> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg: any = await client.fetchOne(String(uid), {
        uid: true, flags: true, envelope: true, bodyStructure: true, source: true,
      }, { uid: true });

      if (!msg) throw new Error(`Message UID ${uid} not found`);

      const env = msg.envelope || {};
      const source = msg.source?.toString() || "";
      const parsed = await simpleParser(source);

      const attachments: AttachmentInfo[] = [];
      function walkParts(node: any, partNum = ""): void {
        if (!node) return;
        if (node.childNodes) {
          node.childNodes.forEach((child: any, i: number) => {
            walkParts(child, partNum ? `${partNum}.${i + 1}` : String(i + 1));
          });
        } else if (node.disposition === "attachment" || node.parameters?.name || node.dispositionParameters?.filename) {
          const filename = node.parameters?.name || node.dispositionParameters?.filename || `part-${partNum}`;
          attachments.push({
            part: partNum || "1",
            filename: String(filename),
            contentType: node.type || "application/octet-stream",
            size: node.size,
          });
        }
      }
      walkParts(msg.bodyStructure);

      return {
        uid: msg.uid,
        from: formatAddrList(env.from),
        to: formatAddrList(env.to),
        cc: formatAddrList(env.cc) || undefined,
        subject: env.subject || "",
        date: env.date?.toISOString?.() || "",
        flags: [...(msg.flags || [])].map(String),
        messageId: env.messageId || undefined,
        text: parsed.text || undefined,
        html: typeof parsed.html === "string" ? parsed.html : undefined,
        attachments,
      };
    } finally {
      lock.release();
    }
  });
}

export async function searchMessages(config: ImapConfig, mailbox: string, criteria: SearchCriteria): Promise<EmailEnvelope[]> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const query: Record<string, unknown> = {};
      if (criteria.from) query.from = criteria.from;
      if (criteria.to) query.to = criteria.to;
      if (criteria.subject) query.subject = criteria.subject;
      if (criteria.since) query.since = criteria.since;
      if (criteria.before) query.before = criteria.before;
      if (criteria.unseen) query.seen = false;
      if (criteria.text) query.body = criteria.text;

      const result: any = await client.search(query, { uid: true });
      const uids: number[] = Array.isArray(result) ? result : [];
      if (!uids.length) return [];

      const limited = uids.slice(-50);
      const messages: EmailEnvelope[] = [];
      for await (const msg of client.fetch(limited, { uid: true, flags: true, envelope: true }, { uid: true })) {
        if (!msg) continue;
        messages.push(envelopeToEntry(msg));
      }
      messages.reverse();
      return messages;
    } finally {
      lock.release();
    }
  });
}

export async function downloadAttachment(config: ImapConfig, mailbox: string, uid: number, part: string): Promise<{ content: string; contentType: string }> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const { content, meta } = await client.download(String(uid), part, { uid: true });
      const chunks: Buffer[] = [];
      for await (const chunk of content) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }
      return {
        content: Buffer.concat(chunks).toString("base64"),
        contentType: meta?.contentType || "application/octet-stream",
      };
    } finally {
      lock.release();
    }
  });
}
export async function appendToSent(config: ImapConfig, rawMessage: Buffer | string): Promise<string | null> {
  return withClient(config, async (client) => {
    const mailboxes = await client.list();
    const sentBox = mailboxes.find(mb => mb.specialUse === "\\Sent") ||
                    mailboxes.find(mb => /^sent$/i.test(mb.name));
    if (!sentBox) return null;
    await client.append(sentBox.path, rawMessage, ["\\Seen"]);
    return sentBox.path;
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
