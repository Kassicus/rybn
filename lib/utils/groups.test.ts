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
 * into the invitation email's subject. Each run of line breaks, control
 * characters, invisible characters and blank-looking characters becomes one
 * space, and the ends are trimmed. A whole subdivision flag stays, and so
 * does a lone joiner between two emoji or between two characters of a script
 * that joins.
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
const FAMILY = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`; // man, woman, girl

/** The black flag, then a code in tag characters, then the cancel tag. */
const BLACK_FLAG = "\u{1F3F4}";
const CANCEL_TAG = "\u{E007F}";
const tags = (code: string) =>
  [...code].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0)!)).join("");
const ENGLAND = `${BLACK_FLAG}${tags("gbeng")}${CANCEL_TAG}`;
const SCOTLAND = `${BLACK_FLAG}${tags("gbsct")}${CANCEL_TAG}`;
const WALES = `${BLACK_FLAG}${tags("gbwls")}${CANCEL_TAG}`;

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

  describe("tag characters", () => {
    it.each([
      ["England", ENGLAND],
      ["Scotland", SCOTLAND],
      ["Wales", WALES],
    ])("keeps the flag of %s", (_country, flag) => {
      expect(tidyGroupText(`${flag} Cousins`)).toBe(`${flag} Cousins`);
    });

    it("turns tag characters after a letter into a space", () => {
      expect(tidyGroupText(`A${tags("hidden words")}${CANCEL_TAG}B`)).toBe("A B");
    });

    it("does not keep an unfinished flag, one with no cancel tag", () => {
      expect(tidyGroupText(`${BLACK_FLAG}${tags("gbsct")}Cousins`)).toBe(`${BLACK_FLAG} Cousins`);
    });

    it("does not keep a flag whose code is longer than a subdivision code", () => {
      expect(tidyGroupText(`${BLACK_FLAG}${tags("gbsctland")}${CANCEL_TAG}Cousins`)).toBe(
        `${BLACK_FLAG} Cousins`
      );
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
});
