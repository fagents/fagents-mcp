import { describe, it, expect } from "vitest";
import { sanitizeText } from "./sanitize.js";

// Test inputs use \uXXXX / \u{XXXXX} escapes only -- never embed literal
// invisible characters in the source. Same hygiene rule as sanitize.ts.

describe("sanitizeText", () => {
  describe("strips zero-width chars", () => {
    it("strips ZWSP U+200B", () => {
      expect(sanitizeText("a\u{200B}b")).toBe("ab");
    });
    it("strips ZWNJ U+200C", () => {
      expect(sanitizeText("a\u{200C}b")).toBe("ab");
    });
    it("strips ZWJ U+200D", () => {
      expect(sanitizeText("a\u{200D}b")).toBe("ab");
    });
    it("strips WORD JOINER U+2060", () => {
      expect(sanitizeText("a\u{2060}b")).toBe("ab");
    });
    it("strips BOM U+FEFF", () => {
      expect(sanitizeText("a\u{FEFF}b")).toBe("ab");
    });
  });

  describe("strips bidi controls", () => {
    it("strips RLO U+202E", () => {
      expect(sanitizeText("a\u{202E}b")).toBe("ab");
    });
    it("strips LRI/PDI bracket U+2066/U+2069", () => {
      expect(sanitizeText("a\u{2066}b\u{2069}c")).toBe("abc");
    });
    it("strips ALM U+061C (Arabic Letter Mark)", () => {
      expect(sanitizeText("a\u{061C}b")).toBe("ab");
    });
    it("strips LRM U+200E (Left-to-Right Mark)", () => {
      expect(sanitizeText("a\u{200E}b")).toBe("ab");
    });
    it("strips RLM U+200F (Right-to-Left Mark)", () => {
      expect(sanitizeText("a\u{200F}b")).toBe("ab");
    });
  });

  describe("strips variation selectors", () => {
    it("strips VS16 U+FE0F (emoji color variant)", () => {
      // Smiley with U+FE0F renders as color emoji; strip yields bare smiley.
      expect(sanitizeText("☺\u{FE0F}")).toBe("☺");
    });
    it("strips VS17 U+E0100", () => {
      expect(sanitizeText("a\u{E0100}b")).toBe("ab");
    });
    it("strips full VS17-VS256 range", () => {
      const payload = "a\u{E0100}\u{E0150}\u{E01EF}b";
      expect(sanitizeText(payload)).toBe("ab");
    });
  });

  describe("strips tag block U+E0000-U+E007F", () => {
    it("strips tag-a U+E0061", () => {
      expect(sanitizeText("hello\u{E0061}")).toBe("hello");
    });
    it("strips tag-A through tag-DEL range", () => {
      expect(sanitizeText("h\u{E0041}e\u{E007F}")).toBe("he");
    });
    it("strips smuggled ASCII payload encoded as tag chars", () => {
      // "evil" encoded as tag chars hidden after visible 'X'
      const payload = "X\u{E0065}\u{E0076}\u{E0069}\u{E006C}";
      expect(sanitizeText(payload)).toBe("X");
    });
  });

  describe("preserves legitimate Unicode", () => {
    it("preserves Finnish characters", () => {
      expect(sanitizeText("hyvää päivää")).toBe("hyvää päivää");
    });
    it("preserves bare emoji (no VS modifier)", () => {
      expect(sanitizeText("hello \u{1F310} world")).toBe("hello \u{1F310} world");
    });
    it("preserves CJK", () => {
      expect(sanitizeText("こんにちは")).toBe("こんにちは");
    });
    it("preserves accented Latin", () => {
      expect(sanitizeText("résumé naïve")).toBe("résumé naïve");
    });
    it("preserves plain ASCII", () => {
      expect(sanitizeText("Hello, World!")).toBe("Hello, World!");
    });
    it("preserves newlines and tabs", () => {
      expect(sanitizeText("line1\nline2\tcol")).toBe("line1\nline2\tcol");
    });
  });

  describe("edge cases", () => {
    it("returns empty string unchanged", () => {
      expect(sanitizeText("")).toBe("");
    });
    it("returns undefined when given undefined", () => {
      expect(sanitizeText(undefined)).toBe(undefined);
    });
  });
});
