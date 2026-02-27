import nodemailer from "nodemailer";
import type { EmailConfig, EmailMessage, EmailSendResult } from "./types.js";

export function createTransport(config: EmailConfig) {
  const emailMatch = config.from.match(/@([^>]+)/);
  const ehloDomain = emailMatch ? emailMatch[1] : undefined;

  return nodemailer.createTransport({
    name: ehloDomain,
    host: config.host,
    port: config.port,
    secure: false, // STARTTLS
    ...(config.user && config.pass ? { auth: { user: config.user, pass: config.pass } } : {}),
    tls: { rejectUnauthorized: true },
  });
}

function mailOptions(config: EmailConfig, message: EmailMessage) {
  return {
    from: config.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    text: message.body,
    ...(message.html ? { html: message.html } : {}),
    ...(message.attachments?.length ? {
      attachments: message.attachments.map(a => ({
        filename: a.filename,
        content: Buffer.from(a.content, "base64"),
        ...(a.contentType ? { contentType: a.contentType } : {}),
      })),
    } : {}),
  };
}

export async function sendEmail(config: EmailConfig, message: EmailMessage): Promise<EmailSendResult> {
  const transport = createTransport(config);
  try {
    const info = await transport.sendMail(mailOptions(config, message));

    return {
      messageId: info.messageId,
      accepted: info.accepted as string[],
      rejected: info.rejected as string[],
    };
  } finally {
    transport.close();
  }
}

export async function buildRawMessage(config: EmailConfig, message: EmailMessage): Promise<Buffer> {
  const stream = nodemailer.createTransport({ streamTransport: true });
  const info = await stream.sendMail(mailOptions(config, message));
  const chunks: Buffer[] = [];
  for await (const chunk of info.message) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}
