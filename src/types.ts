// --- Config types ---

export interface AgentConfig {
  apiKey: string;
  [envKey: string]: string;
}

export interface AgentsFile {
  agents: Record<string, AgentConfig>;
  shared?: Record<string, string>;
}

// --- Email types ---

export interface EmailConfig {
  host: string;
  port: number;
  from: string;
  user?: string;
  pass?: string;
}

export interface EmailAttachment {
  filename: string;
  content: string; // base64
  contentType?: string;
}

export interface EmailMessage {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

// --- IMAP types ---

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  tls?: boolean;
}

export interface MailboxInfo {
  path: string;
  name: string;
  flags: string[];
  specialUse?: string;
}

export interface EmailEnvelope {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  flags: string[];
  messageId?: string;
}

export interface EmailFull {
  uid: number;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: string;
  flags: string[];
  messageId?: string;
  text?: string;
  html?: string;
  attachments: AttachmentInfo[];
}

export interface AttachmentInfo {
  part: string;
  filename: string;
  contentType: string;
  size?: number;
}

export interface SearchCriteria {
  from?: string;
  to?: string;
  subject?: string;
  since?: string;
  before?: string;
  unseen?: boolean;
  text?: string;
}
