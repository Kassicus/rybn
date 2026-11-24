import { describe, expect, it } from "vitest";
import { CHARACTERS_REFUSED } from "@/lib/utils/characters";
import {
  DETAIL_KINDS,
  DETAIL_LABELS,
  DETAIL_LIMITS,
  DETAIL_SENTENCES,
  cleanDetails,
  shownDetails,
} from "./details";

const REFUSED = "That detail can't be saved. Try adding it again.";

function refusal(raw: unknown): string | null {
  const result = cleanDetails(raw);
  return result.ok ? null : result.message;
}

describe("the labels are the contract's", () => {
  it("holds the kinds, their labels, the limits and the four sentences", () => {
    expect([...DETAIL_KINDS]).toEqual(["size", "color", "style", "version", "brand", "other"]);
    expect(DETAIL_LABELS).toEqual({
      size: "Size",
      color: "Color",
      style: "Style",
      version: "Version or model",
      brand: "Brand",
    });
    expect(DETAIL_LIMITS).toEqual({ value: 100, label: 30, own: 5, total: 10 });
    expect(DETAIL_SENTENCES.valueTooLong).toBe("Keep each detail to 100 characters or fewer.");
    expect(DETAIL_SENTENCES.labelMissing).toBe("Give the detail a name.");
    expect(DETAIL_SENTENCES.labelTooLong).toBe("Keep a detail's name to 30 characters or fewer.");
    expect(DETAIL_SENTENCES.refused).toBe(REFUSED);
  });
});

describe("cleans what it is given", () => {
  it("trims, folds line breaks and tabs into one space, and drops a named kind's label", () => {
    expect(cleanDetails([{ kind: "size", label: "ignored", value: "  M\n\tor L  " }])).toEqual({
      ok: true,
      details: [{ kind: "size", value: "M or L" }],
    });
  });

  it("drops an entry whose text is empty after cleaning", () => {
    expect(cleanDetails([{ kind: "size", value: "   " }])).toEqual({ ok: true, details: [] });
  });

  it("trims an own label and keeps the order", () => {
    expect(
      cleanDetails([
        { kind: "other", label: " Scent ", value: "Unscented" },
        { kind: "color", value: "Blue" },
        { kind: "brand", value: "Nike" },
      ]),
    ).toEqual({
      ok: true,
      details: [
        { kind: "other", label: "Scent", value: "Unscented" },
        { kind: "color", value: "Blue" },
        { kind: "brand", value: "Nike" },
      ],
    });
  });
});

describe("counts as the item's other rules do", () => {
  it("passes a value of 100 units and refuses 101", () => {
    expect(cleanDetails([{ kind: "size", value: "a".repeat(100) }]).ok).toBe(true);
    expect(refusal([{ kind: "size", value: "a".repeat(101) }])).toBe(DETAIL_SENTENCES.valueTooLong);
  });

  it("counts an emoji as two units", () => {
    expect(cleanDetails([{ kind: "size", value: "😀".repeat(50) }]).ok).toBe(true);
    expect(refusal([{ kind: "size", value: "😀".repeat(51) }])).toBe(DETAIL_SENTENCES.valueTooLong);
  });

  it("passes a label of 30 and refuses 31", () => {
    expect(cleanDetails([{ kind: "other", label: "a".repeat(30), value: "x" }]).ok).toBe(true);
    expect(refusal([{ kind: "other", label: "a".repeat(31), value: "x" }])).toBe(
      DETAIL_SENTENCES.labelTooLong,
    );
  });
});

describe("says why", () => {
  it("asks for a name when an other has none", () => {
    expect(refusal([{ kind: "other", value: "x" }])).toBe(DETAIL_SENTENCES.labelMissing);
    expect(refusal([{ kind: "other", label: "   ", value: "x" }])).toBe(DETAIL_SENTENCES.labelMissing);
  });

  it("refuses a control character", () => {
    expect(refusal([{ kind: "size", value: "a\u0007b" }])).toBe(CHARACTERS_REFUSED);
    expect(refusal([{ kind: "other", label: "a\u0007", value: "b" }])).toBe(CHARACTERS_REFUSED);
  });

  it("answers the first broken rule, entry by entry", () => {
    expect(
      refusal([
        { kind: "size", value: "a".repeat(101) },
        { kind: "other", value: "x" },
        "x",
      ]),
    ).toBe(DETAIL_SENTENCES.valueTooLong);
    expect(refusal([{ kind: "other", value: "x" }, { kind: "size", value: "a".repeat(101) }])).toBe(
      DETAIL_SENTENCES.labelMissing,
    );
  });

  it("refuses everything else with the one sentence", () => {
    const own = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ kind: "other", label: `L${i}`, value: "x" }));
    const cases: unknown[] = [
      "x",
      {},
      [1],
      [null],
      [[]],
      [{ kind: "nope", value: "x" }],
      [{ value: "x" }],
      [{ kind: "size", value: 5 }],
      [{ kind: "size" }],
      [{ kind: "other", label: 5, value: "x" }],
      [
        { kind: "size", value: "M" },
        { kind: "size", value: "L" },
      ],
      own(6),
      Array.from({ length: 11 }, (_, i) => ({ kind: "other", label: `L${i}`, value: "x" })),
    ];
    for (const raw of cases) expect(refusal(raw)).toBe(REFUSED);
  });

  it("counts after empty entries are dropped", () => {
    expect(
      cleanDetails([
        { kind: "size", value: "M" },
        { kind: "size", value: " " },
      ]).ok,
    ).toBe(true);
  });
});

describe("an empty row is no detail", () => {
  it("drops an other with a label and no value", () => {
    expect(cleanDetails([{ kind: "other", label: "Scent", value: "" }])).toEqual({ ok: true, details: [] });
  });

  it("passes five other plus a sixth with an empty value, keeping five", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ kind: "other", label: `L${i}`, value: "x" }));
    const result = cleanDetails([...five, { kind: "other", label: "L5", value: "" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.details).toHaveLength(5);
  });
});

describe("reads the column forgivingly", () => {
  it("gives every entry its label", () => {
    expect(
      shownDetails([
        { kind: "size", value: "M" },
        { kind: "other", label: "Scent", value: "x" },
      ]),
    ).toEqual([
      { kind: "size", label: "Size", value: "M" },
      { kind: "other", label: "Scent", value: "x" },
    ]);
  });

  it("reads anything that is not a list as empty", () => {
    expect(shownDetails(null)).toEqual([]);
    expect(shownDetails("x")).toEqual([]);
    expect(shownDetails({})).toEqual([]);
  });

  it("leaves out an entry that is unreadable and keeps the rest", () => {
    expect(
      shownDetails([1, null, { kind: "size" }, { kind: "size", value: 3 }, { kind: "color", value: "Blue" }]),
    ).toEqual([{ kind: "color", label: "Color", value: "Blue" }]);
  });
});

describe("what it cleans, the database accepts", () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ kind: "other" as const, label: `Own ${i}`, value: "x" }));
  const lists = [
    [],
    [{ kind: "size", value: "M" }],
    [
      { kind: "size", value: "M" },
      { kind: "color", value: "Blue" },
      { kind: "style", value: "Slim" },
      { kind: "version", value: "Pro" },
      { kind: "brand", value: "Nike" },
      ...five,
    ],
    [{ kind: "size", value: "a".repeat(100) }],
    [{ kind: "other", label: "a".repeat(30), value: "x" }],
  ];

  it.each(lists.map((l, i) => [i, l] as const))("answers list %i unchanged", (_i, list) => {
    expect(cleanDetails(list)).toEqual({ ok: true, details: list });
  });
});
