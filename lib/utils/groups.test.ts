import { describe, it, expect } from "vitest";
import { tidyInviteCode, tidyGroupText } from "./groups";

/**
 * The one tidying rule for an invite code, shared by the website's join box
 * and joinGroupByCode: compatibility forms folded (fullwidth letters and
 * digits become ASCII), letters and digits only, upper case, and the dashes
 * put back when exactly nine are left. Anything else is passed on as
 * stripped, for joinGroupByCode to refuse.
 */
describe("tidyInviteCode", () => {
  it.each([
    ["abc def ghi", "ABC-DEF-GHI"],
    ["ABC-DEF-GHI", "ABC-DEF-GHI"],
    [" abcdefghi\n", "ABC-DEF-GHI"],
    ["k7p-mxr-4tq", "K7P-MXR-4TQ"],
    ["abc", "ABC"],
    ["abc-def-ghij", "ABCDEFGHIJ"],
    ["", ""],
    ["ＫＴＰ－ＭＸＲ－４ＴＱ", "KTP-MXR-4TQ"],
    ["abcdefghß", "ABCDEFGH"],
  ])("tidies %j as %j", (raw, tidy) => {
    expect(tidyInviteCode(raw)).toBe(tidy);
  });
});

/**
 * A group's name and description are shown on one line, and the name goes
 * into the invitation email's subject. Each run of default-ignorable,
 * control, format, private-use and unassigned characters, space separators
 * other than the ordinary space, line and paragraph separators and the
 * braille blank becomes one space, and the ends are trimmed. Kept: U+FE0F
 * after an emoji or in a keycap, a joiner between two emoji or inside a
 * joining script, and the flags of England, Scotland and Wales.
 *
 * Every invisible character below is written as an escape, never typed.
 */
const ZWSP = "\u{200B}"; // zero-width space
const ZWNJ = "\u{200C}"; // zero-width non-joiner
const ZWJ = "\u{200D}"; // zero-width joiner
const RLO = "\u{202E}"; // right-to-left override
const PDF = "\u{202C}"; // pop directional formatting
const LS = "\u{2028}"; // line separator
const PS = "\u{2029}"; // paragraph separator
const VS16 = "\u{FE0F}"; // emoji presentation selector
const KEYCAP = "\u{20E3}"; // combining enclosing keycap
const FAMILY = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`; // man, woman, girl

/** The black flag, then a code in tag characters, then the cancel tag. */
const BLACK_FLAG = "\u{1F3F4}";
const CANCEL_TAG = "\u{E007F}";
const tags = (code: string) =>
  [...code].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0)!)).join("");
const flag = (code: string) => `${BLACK_FLAG}${tags(code)}${CANCEL_TAG}`;

describe("tidyGroupText", () => {
  it.each([
    ["Garcia\nCousins", "Garcia Cousins"],
    ["Garcia\r\n\tCousins", "Garcia Cousins"],
    [` Garcia Cousins${LS}`, "Garcia Cousins"],
    [`Garcia${PS}Cousins`, "Garcia Cousins"],
    [`Garcia${ZWSP}Cousins`, "Garcia Cousins"],
    [`${RLO}Garcia Cousins${PDF}`, "Garcia Cousins"],
    ["Garcia\u{0000}Cousins\u{007F}", "Garcia Cousins"],
    [ZWSP, ""],
    [ZWJ, ""],
    [`Garcia${ZWJ} Cousins`, "Garcia  Cousins"],
    [`${FAMILY} Riveras`, `${FAMILY} Riveras`],
    ["\u{E0067}\u{E007F}", ""],
    ["Garcia Cousins", "Garcia Cousins"],
  ])("tidies %j as %j", (raw, tidy) => {
    expect(tidyGroupText(raw)).toBe(tidy);
  });

  /**
   * Ordinary names, each of which must come back exactly as it was given.
   * Accents are shown composed and decomposed; the non-Latin names have no
   * hidden characters, apart from the Persian non-joiner inside one word.
   */
  it.each([
    ["accents, composed", "Zoë Ibáñez-Müller"],
    ["accents, decomposed", "Zoe\u{0308} Iba\u{0301}n\u{0303}ez"],
    ["an apostrophe and a dash", "O'Brien – Smith-Jones"],
    ["a curly apostrophe", "O\u{2019}Briens"],
    ["a skin-toned emoji", "\u{1F44B}\u{1F3FD} Cousins"],
    ["a family emoji", `${FAMILY} Riveras`],
    ["a couple emoji", `\u{1F469}${ZWJ}\u{2764}${VS16}${ZWJ}\u{1F468} Riveras`],
    ["a country flag", "\u{1F1EC}\u{1F1E7} Cousins"],
    ["a keycap", `Book Club 1${VS16}${KEYCAP}`],
    ["a name in Arabic", "\u{0639}\u{0627}\u{0626}\u{0644}\u{0629} \u{0627}\u{0644}\u{0623}\u{062D}\u{0645}\u{062F}"],
    ["a name in Persian, with its non-joiner", `\u{0645}\u{06CC}${ZWNJ}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}`],
    ["a name in Hebrew", "\u{05DE}\u{05E9}\u{05E4}\u{05D7}\u{05EA} \u{05DB}\u{05D4}\u{05DF}"],
    ["a name in Hindi", "\u{0936}\u{0930}\u{094D}\u{092E}\u{093E} \u{092A}\u{0930}\u{093F}\u{0935}\u{093E}\u{0930}"],
    ["a name in Japanese", "\u{5C71}\u{7530}\u{5BB6}"],
    ["a name in Korean", "\u{AE40}\u{C528} \u{AC00}\u{C871}"],
  ])("leaves an ordinary name alone: %s", (_kind, name) => {
    expect(tidyGroupText(name)).toBe(name);
  });

  describe("tag characters", () => {
    it.each([
      ["England", "gbeng"],
      ["Scotland", "gbsct"],
      ["Wales", "gbwls"],
    ])("keeps the flag of %s", (_country, code) => {
      expect(tidyGroupText(`${flag(code)} Cousins`)).toBe(`${flag(code)} Cousins`);
    });

    it.each([["gbxyz"], ["ustx"], ["abc"], ["abcdefg"], ["gb1"], ["gbsctland"]])(
      "does not keep a black flag with any other code: %s",
      (code) => {
        expect(tidyGroupText(`${flag(code)}Cousins`)).toBe(`${BLACK_FLAG} Cousins`);
      }
    );

    it("turns tag characters after a letter into a space", () => {
      expect(tidyGroupText(`A${tags("hidden words")}${CANCEL_TAG}B`)).toBe("A B");
    });

    it("does not keep an unfinished flag, one with no cancel tag", () => {
      expect(tidyGroupText(`${BLACK_FLAG}${tags("gbsct")}Cousins`)).toBe(`${BLACK_FLAG} Cousins`);
    });
  });

  describe("variation selectors", () => {
    it.each([
      ["U+FE00", "\u{FE00}"],
      ["U+FE0E", "\u{FE0E}"],
      ["U+FE0F", "\u{FE0F}"],
      ["U+E0100", "\u{E0100}"],
      ["U+E01EF", "\u{E01EF}"],
      ["U+180B", "\u{180B}"],
      ["U+180D", "\u{180D}"],
      ["U+180F", "\u{180F}"],
    ])("turns %s after a letter into a space", (_name, selector) => {
      expect(tidyGroupText(`Garcia${selector}Cousins`)).toBe("Garcia Cousins");
      expect(tidyGroupText(selector)).toBe("");
    });

    it("turns a run of five of them into one space", () => {
      expect(tidyGroupText("Garcia\u{FE00}\u{FE01}\u{E0100}\u{180B}\u{FE0F}Cousins")).toBe("Garcia Cousins");
    });

    it.each([
      ["a heart", `\u{2764}${VS16}`],
      ["the rainbow flag", `\u{1F3F3}${VS16}${ZWJ}\u{1F308}`],
      ["a keycap one", `1${VS16}${KEYCAP}`],
      ["a keycap hash", `#${VS16}${KEYCAP}`],
    ])("keeps U+FE0F in %s", (_name, emoji) => {
      expect(tidyGroupText(`${emoji} Cousins`)).toBe(`${emoji} Cousins`);
    });

    it("turns U+FE0F into a space after a digit that is not a keycap", () => {
      expect(tidyGroupText(`Club 1${VS16} Cousins`)).toBe("Club 1  Cousins");
    });
  });

  describe("joiners", () => {
    it.each([
      ["a zero-width joiner", ZWJ],
      ["a zero-width non-joiner", ZWNJ],
    ])("turns %s between two Latin letters into a space", (_name, joiner) => {
      expect(tidyGroupText(`Gar${joiner}cia`)).toBe("Gar cia");
    });

    it.each([
      ["a family", FAMILY],
      ["the rainbow flag, after a variation selector", `\u{1F3F3}${VS16}${ZWJ}\u{1F308}`],
      ["a technologist, after a skin tone", `\u{1F468}\u{1F3FD}${ZWJ}\u{1F4BB}`],
    ])("keeps a joiner between two emoji: %s", (_name, emoji) => {
      expect(tidyGroupText(`${emoji} Riveras`)).toBe(`${emoji} Riveras`);
    });

    it.each([
      // Persian, "I want": the non-joiner keeps the first two letters apart.
      ["Arabic script", `\u{0645}\u{06CC}${ZWNJ}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}`],
      // Devanagari, ka + virama + joiner + ssa: the half form of ka.
      ["Devanagari", `\u{0915}\u{094D}${ZWJ}\u{0937}`],
      // Malayalam, na + virama + joiner: the chillu form of na.
      ["Malayalam", `\u{0D28}\u{0D4D}${ZWJ}\u{0D31}`],
    ])("keeps a joiner inside a word in %s", (_script, word) => {
      expect(tidyGroupText(word)).toBe(word);
    });

    it.each([
      ["a Latin letter and an Arabic one", `a${ZWNJ}\u{0628}`, "a \u{0628}"],
      ["an emoji and a Latin letter", `\u{1F468}${ZWJ}a`, "\u{1F468} a"],
      ["two letters, next to a zero-width space", `a${ZWSP}${ZWJ}b`, "a b"],
    ])("turns a joiner between %s into a space", (_name, raw, tidy) => {
      expect(tidyGroupText(raw)).toBe(tidy);
    });
  });

  describe("blank-looking characters", () => {
    it.each([
      ["U+034F", "\u{034F}"],
      ["U+115F", "\u{115F}"],
      ["U+1160", "\u{1160}"],
      ["U+17B4", "\u{17B4}"],
      ["U+17B5", "\u{17B5}"],
      ["U+2800", "\u{2800}"],
      ["U+3164", "\u{3164}"],
      ["U+FFA0", "\u{FFA0}"],
    ])("turns %s into a space", (_name, blank) => {
      expect(tidyGroupText(`Garcia${blank}Cousins`)).toBe("Garcia Cousins");
      expect(tidyGroupText(blank)).toBe("");
    });
  });

  describe("space separators", () => {
    it.each([
      ["a hair space", "\u{200A}"],
      ["a thin space", "\u{2009}"],
      ["a narrow no-break space", "\u{202F}"],
      ["a no-break space", "\u{00A0}"],
      ["an ideographic space", "\u{3000}"],
    ])("turns %s inside a name into an ordinary space", (_name, space) => {
      expect(tidyGroupText(`Gar${space}cia`)).toBe("Gar cia");
    });

    it("leaves ordinary spaces as they are", () => {
      expect(tidyGroupText("Garcia  Cousins")).toBe("Garcia  Cousins");
    });
  });

  describe("private-use, unassigned and lone surrogate characters", () => {
    it.each([
      ["a private-use character", "\u{E000}"],
      ["a noncharacter, never assigned", "\u{FDD0}"],
      ["a lone surrogate", "\u{D800}"],
    ])("turns %s into a space", (_name, char) => {
      expect(tidyGroupText(`Garcia${char}Cousins`)).toBe("Garcia Cousins");
    });
  });
});
