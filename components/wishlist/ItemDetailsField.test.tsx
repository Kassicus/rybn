// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ItemDetailsField, detailError } from "./ItemDetailsField";
import { CHARACTERS_REFUSED } from "@/lib/utils/characters";
import { DETAIL_SENTENCES, type ShownDetail } from "@/lib/wishlist/details";

afterEach(cleanup);

const size: ShownDetail = { kind: "size", label: "Size", value: "M" };
const color: ShownDetail = { kind: "color", label: "Color", value: "Blue" };
const own = (n: number): ShownDetail => ({ kind: "other", label: `Thing ${n}`, value: `v${n}` });

const KINDS = ["Size", "Color", "Style", "Version or model", "Brand", "Something else"];

function open(value: ShownDetail[], error?: string) {
  const onChange = vi.fn();
  render(<ItemDetailsField value={value} onChange={onChange} error={error} />);
  return onChange;
}

describe("ItemDetailsField", () => {
  it("shows Add details and no rows when empty", () => {
    open([]);
    expect(screen.getByRole("button", { name: "Add details" })).toBeTruthy();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Size" })).toBeNull();
  });

  it("lists the kinds in order once opened", () => {
    open([]);
    fireEvent.click(screen.getByRole("button", { name: "Add details" }));
    const names = screen
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => KINDS.includes(t ?? ""));
    expect(names).toEqual(KINDS);
  });

  it("appends a named kind with its label and no text", () => {
    const onChange = open([color]);
    fireEvent.click(screen.getByRole("button", { name: "Add details" }));
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    expect(onChange).toHaveBeenCalledWith([color, { kind: "size", label: "Size", value: "" }]);
  });

  it("appends Something else with an empty label", () => {
    const onChange = open([]);
    fireEvent.click(screen.getByRole("button", { name: "Add details" }));
    fireEvent.click(screen.getByRole("button", { name: "Something else" }));
    expect(onChange).toHaveBeenCalledWith([{ kind: "other", label: "", value: "" }]);
  });

  it("disables a named kind already present", () => {
    open([size]);
    fireEvent.click(screen.getByRole("button", { name: "Add details" }));
    expect((screen.getByRole("button", { name: "Size" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Color" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables Something else at five of them", () => {
    open([1, 2, 3, 4, 5].map(own));
    fireEvent.click(screen.getByRole("button", { name: "Add details" }));
    expect((screen.getByRole("button", { name: "Something else" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Size" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables every kind at ten rows", () => {
    open([size, color, ...[1, 2, 3, 4, 5].map(own), { kind: "style", label: "Style", value: "a" }, { kind: "brand", label: "Brand", value: "b" }, { kind: "version", label: "Version or model", value: "c" }]);
    expect((screen.getByRole("button", { name: "Add details" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("gives an own row a What it is box and a text box", () => {
    open([{ kind: "other", label: "Scent", value: "Plain" }]);
    expect((screen.getByLabelText("What it is") as HTMLInputElement).value).toBe("Scent");
    expect((screen.getByLabelText("Detail") as HTMLInputElement).value).toBe("Plain");
  });

  it("changes only the row typed in", () => {
    const rows = [size, { kind: "other", label: "Scent", value: "Plain" }];
    const onChange = open(rows);
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "L" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...size, value: "L" }, rows[1]]);
    fireEvent.change(screen.getByLabelText("What it is"), { target: { value: "Smell" } });
    expect(onChange).toHaveBeenLastCalledWith([size, { ...rows[1], label: "Smell" }]);
  });

  it("removes a row by its labelled button", () => {
    const onChange = open([size, color]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Size" }));
    expect(onChange).toHaveBeenCalledWith([color]);
  });

  it("names the remove button for an unlabelled own row", () => {
    const onChange = open([{ kind: "other", label: "", value: "" }]);
    fireEvent.click(screen.getByRole("button", { name: "Remove detail" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("shows the error under the control", () => {
    open([], "Give the detail a name.");
    expect(screen.getByText("Give the detail a name.")).toBeTruthy();
  });
});

describe("detailError", () => {
  it("keeps a detail's sentence and nothing else", () => {
    expect(detailError(DETAIL_SENTENCES.labelMissing, [])).toBe(DETAIL_SENTENCES.labelMissing);
    expect(detailError("Title is required", [])).toBeUndefined();
    expect(detailError(null, [])).toBeUndefined();
  });

  it("owns the characters sentence only when a row holds a control character", () => {
    expect(detailError(CHARACTERS_REFUSED, [{ kind: "size", label: "Size", value: "a\u0001" }])).toBe(CHARACTERS_REFUSED);
    expect(detailError(CHARACTERS_REFUSED, [size])).toBeUndefined();
  });
});
