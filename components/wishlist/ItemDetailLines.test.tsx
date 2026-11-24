// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ItemDetailLines } from "./ItemDetailLines";

afterEach(cleanup);

const stored = [
  { kind: "size", value: "M" },
  { kind: "other", label: "Scent", value: "Unscented" },
];

describe("ItemDetailLines", () => {
  it("shows a labelled line for each detail as lines", () => {
    render(<ItemDetailLines details={stored} variant="lines" />);
    const terms = screen.getAllByRole("term").map((t) => t.textContent);
    const definitions = screen.getAllByRole("definition").map((d) => d.textContent);
    expect(terms).toEqual(["Size", "Scent"]);
    expect(definitions).toEqual(["M", "Unscented"]);
  });

  it("reads as one line of plain text as line", () => {
    const { container } = render(<ItemDetailLines details={stored} variant="line" />);
    expect(container.textContent).toBe("Size M · Scent Unscented");
  });

  it.each([
    ["an empty list", []],
    ["null", null],
    ["a string", "x"],
  ])("draws nothing for %s", (_name, details) => {
    for (const variant of ["lines", "line"] as const) {
      const { container } = render(<ItemDetailLines details={details} variant={variant} />);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });
});
