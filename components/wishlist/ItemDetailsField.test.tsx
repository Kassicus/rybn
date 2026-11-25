// @vitest-environment jsdom
import { useState } from "react";
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
    expect(screen.getByText("What it is")).toBeTruthy();
    expect((screen.getByLabelText("Detail 1, what it is") as HTMLInputElement).value).toBe("Scent");
    expect((screen.getByLabelText("Detail 1, text") as HTMLInputElement).value).toBe("Plain");
  });

  it("changes only the row typed in", () => {
    const rows = [size, { kind: "other", label: "Scent", value: "Plain" }];
    const onChange = open(rows);
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "L" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...size, value: "L" }, rows[1]]);
    fireEvent.change(screen.getByLabelText("Detail 1, what it is"), { target: { value: "Smell" } });
    expect(onChange).toHaveBeenLastCalledWith([size, { ...rows[1], label: "Smell" }]);
  });

  it("removes a row by its labelled button", () => {
    const onChange = open([size, color]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Size" }));
    expect(onChange).toHaveBeenCalledWith([color]);
  });

  it("names the remove button for an unlabelled own row", () => {
    const onChange = open([{ kind: "other", label: "", value: "" }]);
    fireEvent.click(screen.getByRole("button", { name: "Remove detail 1" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("tells own rows apart by position", () => {
    open([size, own(1), own(2)]);
    expect(screen.getByLabelText("Detail 2, what it is")).toBeTruthy();
    expect(screen.getByLabelText("Detail 2, text")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Thing 2" })).toBeTruthy();
    cleanup();
    open([{ kind: "other", label: "", value: "" }, { kind: "other", label: "", value: "" }]);
    expect(screen.getByRole("button", { name: "Remove detail 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove detail 2" })).toBeTruthy();
  });

  it("is a group named by its visible Details label", () => {
    open([]);
    expect(screen.getByRole("group", { name: "Details" })).toBeTruthy();
  });

  it("closes the list on Escape and returns focus to Add details", () => {
    open([]);
    const add = screen.getByRole("button", { name: "Add details" });
    fireEvent.click(add);
    expect(add.getAttribute("aria-controls")).toBe(screen.getByRole("list", { name: "Kinds of detail" }).id);
    fireEvent.keyDown(screen.getByRole("button", { name: "Color" }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Color" })).toBeNull();
    expect(document.activeElement).toBe(add);
  });

  it("shows the error under the control", () => {
    open([], "Give the detail a name.");
    expect(screen.getByText("Give the detail a name.")).toBeTruthy();
  });
});

/** A parent that holds the rows, as the forms do, so focus can be watched across renders. */
function Held({ start }: { start: ShownDetail[] }) {
  const [rows, setRows] = useState(start);
  return <ItemDetailsField value={rows} onChange={setRows} />;
}

describe("ItemDetailsField focus", () => {
  it("moves to the text box of a named kind just added", () => {
    render(<Held start={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add details" }));
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Size"));
  });

  it("moves to the What it is box of Something else just added", () => {
    render(<Held start={[size]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add details" }));
    fireEvent.click(screen.getByRole("button", { name: "Something else" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Detail 1, what it is"));
  });

  it("after Remove, moves to the row that took its place", () => {
    render(<Held start={[size, color]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Size" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Color"));
  });

  it("after removing the last row, moves to the row before it", () => {
    render(<Held start={[size, color]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Color" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Size"));
  });

  it("after removing the only row, moves to Add details", () => {
    render(<Held start={[size]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Size" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add details" }));
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
