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
 * characters and invisible characters becomes one space, and the ends are
 * trimmed. A zero-width joiner between two visible characters, and the tag
 * characters after a flag, are part of the emoji they build and stay.
 *
 * Every invisible character below is written as an escape, never typed.
 */
const ZWSP = "\u{200B}"; // zero-width space
const ZWJ = "\u{200D}"; // zero-width joiner
const RLO = "\u{202E}"; // right-to-left override
const PDF = "\u{202C}"; // pop directional formatting
const LS = "\u{2028}"; // line separator
const PS = "\u{2029}"; // paragraph separator
const FAMILY = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`; // man, woman, girl
const SCOTLAND = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";

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
    [`${SCOTLAND} Cousins`, `${SCOTLAND} Cousins`],
    ["\u{E0067}\u{E007F}", ""],
    ["Garcia Cousins", "Garcia Cousins"],
  ])("tidies %j as %j", (raw, tidy) => {
    expect(tidyGroupText(raw)).toBe(tidy);
  });
});
