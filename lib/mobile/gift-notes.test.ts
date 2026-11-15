import { describe, it, expect } from "vitest";
import { fixture } from "./test-fixtures";
import { IDS } from "./test-shopping";
import { parseHeadingKey, parseNotesBody } from "./gift-notes";

const JOE = "recipient:" + IDS.recipientJoe;
/** The gift door's sentence for a control character (RULES.characters), written out: if it changes, these fail. */
const CHARACTERS = "That has characters Rybn can't save. Try typing it again.";

describe("parseHeadingKey", () => {
  it.each([
    ["person:user_2momABC", { kind: "person", personId: "user_2momABC" }],
    ["recipient:F0E1D2C3-0003-4C00-8000-000000000003", { kind: "recipient", recipientId: "f0e1d2c3-0003-4c00-8000-000000000003" }],
    ["person:", null],
    ["person:a b", null],
    ["recipient:x", null],
    ["group:7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e", null],
    ["", null],
  ])("parseHeadingKey(%j) is %j", (key, heading) => expect(parseHeadingKey(key)).toEqual(heading));
});

describe("parseNotesBody", () => {
  it("reads the request fixture", () =>
    expect(parseNotesBody(fixture("gift-notes-request"))).toEqual({
      ok: true,
      target: { kind: "recipient", recipientId: IDS.recipientJoe },
      name: "Grandpa Joe",
      notes: "Fishes most Sundays. Size L hats.",
    }));
  it("trims a typed name and keeps the notes as written", () =>
    expect(parseNotesBody({ key: JOE, name: "  Grandpa Joe ", notes: " x " })).toMatchObject({ ok: true, name: "Grandpa Joe", notes: " x " }));
  it("reads a person's key with no name", () =>
    expect(parseNotesBody({ key: "person:user_2momABC", notes: "" })).toEqual({
      ok: true,
      target: { kind: "person", personId: "user_2momABC" },
      notes: "",
      name: null,
    }));
  it.each([
    [[], "That request wasn't valid."],
    [{ notes: "x" }, "That request wasn't valid."],
    [{ key: "person:user_2momABC" }, "That request wasn't valid."],
    [{ key: "person:user_2momABC", notes: "x", name: "Mom" }, "That request wasn't valid."],
    [{ key: "person:user_2momABC", notes: "x", name: null }, "That request wasn't valid."],
    [{ key: JOE, notes: "x" }, "Name is required"],
    [{ key: JOE, notes: "x", name: "   " }, "Name is required"],
    [{ key: JOE, notes: "x", name: 5 }, "That request wasn't valid."],
    [{ key: JOE, notes: "x", name: "a".repeat(101) }, "Name must be less than 100 characters"],
    [{ key: JOE, notes: "a".repeat(501), name: "Joe" }, "Notes must be less than 500 characters"],
    // The gift door's rules: a typed name as a recipient's name (no control character once trimmed), notes as a gift's
    // notes (a tab, a line feed and a carriage return allowed), each checked before the website's.
    [{ key: JOE, notes: "x", name: "Grandpa\u0000Joe" }, CHARACTERS],
    [{ key: JOE, notes: "x", name: "Grandpa\tJoe" }, CHARACTERS],
    [{ key: JOE, notes: "x", name: "Grandpa\nJoe" }, CHARACTERS],
    [{ key: JOE, notes: "x", name: "a".repeat(101) + "\u0007" }, CHARACTERS],
    [{ key: JOE, notes: "Size\u0000L", name: "Joe" }, CHARACTERS],
    [{ key: JOE, notes: "a".repeat(501) + "\u001B", name: "Joe" }, CHARACTERS],
    [{ key: "person:user_2momABC", notes: "Medium\u007F" }, CHARACTERS],
  ])("refuses %j with %j", (raw, message) => expect(parseNotesBody(raw)).toEqual({ ok: false, message }));
  it("takes a tab, a line feed and a carriage return in notes, and trims them from the ends of a typed name", () =>
    expect(parseNotesBody({ key: JOE, name: "\tGrandpa Joe\r\n", notes: "Hats:\tL\r\nGloves:\tM\n" })).toEqual({
      ok: true,
      target: { kind: "recipient", recipientId: IDS.recipientJoe },
      name: "Grandpa Joe",
      notes: "Hats:\tL\r\nGloves:\tM\n",
    }));
  it("refuses what is not an object, and a key that is not text", () => {
    for (const raw of [undefined, null, "x", 5, { key: 5, notes: "x" }]) {
      expect(parseNotesBody(raw)).toEqual({ ok: false, message: "That request wasn't valid." });
    }
  });
  it("answers not found for any other key", () => {
    expect(parseNotesBody({ key: "group:x", notes: "x" })).toEqual({ ok: false, notFound: true });
    expect(parseNotesBody({ key: "recipient:nope", notes: "x", name: "Joe" })).toEqual({ ok: false, notFound: true });
  });
});
