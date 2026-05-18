import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock state. vi.hoisted() makes these available to vi.mock factories
// (which run before import statements).
const hoisted = vi.hoisted(() => {
  return {
    mockClient: {
      connect: vi.fn(),
      logout: vi.fn(),
      getMailboxLock: vi.fn(),
      status: vi.fn(),
      fetch: vi.fn(),
      fetchOne: vi.fn(),
      search: vi.fn(),
      download: vi.fn(),
    } as Record<string, ReturnType<typeof vi.fn>>,
    simpleParserMock: vi.fn(),
  };
});

vi.mock("imapflow", () => ({
  // `new ImapFlow(...)` in imap.ts requires a constructable. Arrow-function
  // mocks (`vi.fn(() => ...)`) cannot be `new`-d. A class whose constructor
  // explicitly returns an object is the simplest form that works under `new`.
  ImapFlow: class {
    constructor() {
      return hoisted.mockClient;
    }
  },
}));

vi.mock("mailparser", () => ({
  simpleParser: hoisted.simpleParserMock,
}));

import { listMessages, getMessage, checkNewEmail, downloadAttachment } from "./imap.js";
import type { ImapConfig } from "./types.js";

const cfg: ImapConfig = { host: "h", port: 993, user: "u", pass: "p", tls: true };

// Payload patterns used across tests. Escapes only -- no literal invisibles.
// Visible-prefix payloads (assert that only the invisible bytes are stripped):
const TAG_PAYLOAD = "X\u{E0065}\u{E0076}\u{E0069}\u{E006C}"; // "X" + tag-"evil"
const VS_PAYLOAD = "Y\u{E0100}\u{E0150}"; // "Y" + VS17 + VS81
const ZW_PAYLOAD = "Z\u{200B}\u{FEFF}"; // "Z" + ZWSP + BOM
const BIDI_PAYLOAD = "A\u{202E}B"; // RLO between two visible letters
// Pure-invisible payload (asserts strip yields empty insertion):
const HIDDEN_ONLY = "\u{E0065}\u{E0076}\u{E0069}\u{E006C}"; // tag-"evil", no visible chars

function makeAsyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

beforeEach(() => {
  for (const k of Object.keys(hoisted.mockClient)) {
    hoisted.mockClient[k].mockReset();
  }
  hoisted.simpleParserMock.mockReset();

  // Default plumbing -- individual tests override fetch/fetchOne/status output.
  hoisted.mockClient.connect.mockResolvedValue(undefined);
  hoisted.mockClient.logout.mockResolvedValue(undefined);
  hoisted.mockClient.getMailboxLock.mockResolvedValue({ release: vi.fn() });
});

describe("imap.ts sanitizes attacker-controlled fields", () => {
  describe("listMessages", () => {
    it("strips smuggling Unicode from subject + messageId + from name", async () => {
      hoisted.mockClient.status.mockResolvedValue({ messages: 1 });
      hoisted.mockClient.fetch.mockReturnValue(
        makeAsyncIter([
          {
            uid: 42,
            flags: ["\\Seen"],
            envelope: {
              subject: `Hello ${TAG_PAYLOAD} World`,
              messageId: `<id-${ZW_PAYLOAD}@host>`,
              from: [{ name: `Mallory${VS_PAYLOAD}`, address: "m@x.com" }],
              to: [{ name: "Recipient", address: "r@x.com" }],
              date: new Date("2026-05-18T00:00:00Z"),
            },
          },
        ]),
      );

      const result = await listMessages(cfg, "INBOX", 10, 0);

      expect(result).toHaveLength(1);
      expect(result[0].subject).toBe("Hello X World");
      expect(result[0].messageId).toBe("<id-Z@host>");
      expect(result[0].from).toBe("MalloryY <m@x.com>");
    });

    it("preserves legitimate Unicode (Finnish, emoji)", async () => {
      hoisted.mockClient.status.mockResolvedValue({ messages: 1 });
      hoisted.mockClient.fetch.mockReturnValue(
        makeAsyncIter([
          {
            uid: 7,
            flags: [],
            envelope: {
              subject: "Hyvää päivää",
              messageId: "<plain@host>",
              from: [{ name: "Pekka", address: "p@example.fi" }],
              to: [],
              date: new Date("2026-05-18T00:00:00Z"),
            },
          },
        ]),
      );

      const result = await listMessages(cfg, "INBOX", 10, 0);

      expect(result[0].subject).toBe("Hyvää päivää");
      expect(result[0].from).toBe("Pekka <p@example.fi>");
    });
  });

  describe("getMessage", () => {
    it("strips smuggling Unicode from subject, messageId, text, html, attachments", async () => {
      hoisted.mockClient.fetchOne.mockResolvedValue({
        uid: 99,
        flags: [],
        envelope: {
          subject: `Subj ${TAG_PAYLOAD}`,
          messageId: `<id-${ZW_PAYLOAD}@host>`,
          from: [{ name: `Sender${BIDI_PAYLOAD}`, address: "s@x.com" }],
          to: [],
          date: new Date("2026-05-18T00:00:00Z"),
        },
        source: Buffer.from("dummy-rfc822-source"),
        bodyStructure: {
          childNodes: [
            { type: "text/plain", size: 100 },
            {
              type: `application/pdf${HIDDEN_ONLY}`,
              disposition: "attachment",
              dispositionParameters: { filename: `report${HIDDEN_ONLY}.pdf` },
              size: 1024,
            },
          ],
        },
      });

      hoisted.simpleParserMock.mockResolvedValue({
        text: `Body line 1 ${TAG_PAYLOAD}\nLine 2 ${VS_PAYLOAD}`,
        html: `<p>html ${ZW_PAYLOAD}</p>`,
      });

      const result = await getMessage(cfg, "INBOX", 99);

      expect(result.subject).toBe("Subj X");
      expect(result.messageId).toBe("<id-Z@host>");
      expect(result.from).toBe("SenderAB <s@x.com>"); // RLO stripped
      expect(result.text).toBe("Body line 1 X\nLine 2 Y");
      expect(result.html).toBe("<p>html Z</p>");
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].filename).toBe("report.pdf");
      expect(result.attachments[0].contentType).toBe("application/pdf");
    });

    it("handles mailparser's `false` text without throwing", async () => {
      // mailparser types parsed.text as `string | false | undefined`. If the
      // sanitizer is called on `false` directly it would throw on .replace().
      hoisted.mockClient.fetchOne.mockResolvedValue({
        uid: 101,
        flags: [],
        envelope: {
          subject: "no body",
          messageId: "<x@host>",
          from: [{ name: "S", address: "s@x.com" }],
          to: [],
          date: new Date("2026-05-18T00:00:00Z"),
        },
        source: Buffer.from("dummy"),
        bodyStructure: { childNodes: [] },
      });
      hoisted.simpleParserMock.mockResolvedValue({ text: false, html: false });

      const result = await getMessage(cfg, "INBOX", 101);

      expect(result.text).toBeUndefined();
      expect(result.html).toBeUndefined();
    });

    it("preserves legitimate body content (Finnish, emoji)", async () => {
      hoisted.mockClient.fetchOne.mockResolvedValue({
        uid: 100,
        flags: [],
        envelope: {
          subject: "Tervehdys",
          messageId: "<x@host>",
          from: [{ name: "Anna", address: "a@x.com" }],
          to: [],
          date: new Date("2026-05-18T00:00:00Z"),
        },
        source: Buffer.from("dummy"),
        bodyStructure: { childNodes: [] },
      });
      hoisted.simpleParserMock.mockResolvedValue({
        text: "Hyvää päivää \u{1F310}",
        html: "<p>Hyvää päivää</p>",
      });

      const result = await getMessage(cfg, "INBOX", 100);

      expect(result.text).toBe("Hyvää päivää \u{1F310}");
      expect(result.html).toBe("<p>Hyvää päivää</p>");
      expect(result.subject).toBe("Tervehdys");
    });
  });

  describe("downloadAttachment", () => {
    it("strips smuggling Unicode from meta.contentType", async () => {
      hoisted.mockClient.download.mockResolvedValue({
        content: makeAsyncIter([Buffer.from("payload-bytes")]),
        meta: { contentType: `application/pdf${HIDDEN_ONLY}` },
      });

      const result = await downloadAttachment(cfg, "INBOX", 99, "2");

      expect(result.contentType).toBe("application/pdf");
      // base64 of "payload-bytes"
      expect(result.content).toBe(Buffer.from("payload-bytes").toString("base64"));
    });
  });

  describe("checkNewEmail", () => {
    it("strips smuggling Unicode from from-address name", async () => {
      hoisted.mockClient.search.mockResolvedValue([10]);
      hoisted.mockClient.fetch.mockReturnValue(
        makeAsyncIter([
          {
            uid: 10,
            envelope: {
              from: [{ name: `Bob${TAG_PAYLOAD}`, address: "b@x.com" }],
              date: new Date("2026-05-18T00:00:00Z"),
            },
          },
        ]),
      );

      const result = await checkNewEmail(cfg, 0, "INBOX");

      expect(result).toHaveLength(1);
      expect(result[0].from).toBe("BobX <b@x.com>");
    });
  });
});
