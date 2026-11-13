import { describe, it, expect } from "vitest";
import { RULES } from "@/lib/mobile/wishlist";
import { CHARACTERS_REFUSED, CONTROL, CONTROL_EXCEPT_NOTES_WHITESPACE } from "./characters";

describe("the characters Rybn cannot save", () => {
  // Written out, so changing a single character fails here.
  it("are refused with one sentence, the one the app's rules at the door answer", () => {
    expect(CHARACTERS_REFUSED).toBe("That has characters Rybn can't save. Try typing it again.");
    expect(RULES.characters).toBe(CHARACTERS_REFUSED);
  });

  it("are every control character in one-line text", () => {
    for (let code = 0; code <= 0x1f; code++) expect(CONTROL.test(String.fromCharCode(code)), `U+${code}`).toBe(true);
    expect(CONTROL.test("\u007F")).toBe(true);
    expect(CONTROL.test("Café ☕️ 👩‍👩‍👧, size 10½")).toBe(false);
  });

  it("are every control character but a tab, a line feed and a carriage return in free text", () => {
    const allowed = new Set([0x09, 0x0a, 0x0d]);
    for (let code = 0; code <= 0x1f; code++) {
      expect(CONTROL_EXCEPT_NOTES_WHITESPACE.test(String.fromCharCode(code)), `U+${code}`).toBe(!allowed.has(code));
    }
    expect(CONTROL_EXCEPT_NOTES_WHITESPACE.test("\u007F")).toBe(true);
    expect(CONTROL_EXCEPT_NOTES_WHITESPACE.test("line one\r\nline two\tthree")).toBe(false);
  });
});
