"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import {
  DETAIL_KINDS,
  DETAIL_LABELS,
  DETAIL_LIMITS,
  DETAIL_SENTENCES,
  type ShownDetail,
} from "@/lib/wishlist/details";
import { CHARACTERS_REFUSED, CONTROL_EXCEPT_NOTES_WHITESPACE } from "@/lib/utils/characters";

const KIND_NAMES: Record<string, string> = { ...DETAIL_LABELS, other: "Something else" };
const DETAIL_ERRORS: string[] = Object.values(DETAIL_SENTENCES);

/**
 * The sentence an action answered, when it is about a detail and so belongs under the control rather than at the top
 * of the form. The characters sentence is shared with the form's other fields, so it counts as a detail's only when a
 * row holds a character the server would refuse.
 */
export function detailError(
  error: string | null | undefined,
  rows: ShownDetail[]
): string | undefined {
  if (!error) return undefined;
  if (DETAIL_ERRORS.includes(error)) return error;
  if (
    error === CHARACTERS_REFUSED &&
    rows.some((r) => CONTROL_EXCEPT_NOTES_WHITESPACE.test(r.value) || CONTROL_EXCEPT_NOTES_WHITESPACE.test(r.label))
  ) {
    return error;
  }
  return undefined;
}

interface ItemDetailsFieldProps {
  value: ShownDetail[];
  onChange: (next: ShownDetail[]) => void;
  error?: string;
}

/**
 * The list of details on an item (Size, Color, ...), each a kind and a line of text. The rows are held by the form;
 * this adds, changes and removes them and does no checking of its own: the server cleans and checks what is sent.
 */
export function ItemDetailsField({ value, onChange, error }: ItemDetailsFieldProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // Where focus goes once the next render has the row or button it names: a row index, or "add" for the button.
  const pendingFocus = useRef<number | "add" | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target === "add") addButton.current?.focus();
    else root.current?.querySelector<HTMLElement>(`[data-row="${target}"] input`)?.focus();
  });

  const ownCount = value.filter((r) => r.kind === "other").length;
  const full = value.length >= DETAIL_LIMITS.total;

  const canAdd = (kind: string) => {
    if (full) return false;
    if (kind === "other") return ownCount < DETAIL_LIMITS.own;
    return !value.some((r) => r.kind === kind);
  };

  const add = (kind: string) => {
    const label = kind === "other" ? "" : DETAIL_LABELS[kind as keyof typeof DETAIL_LABELS];
    pendingFocus.current = value.length;
    onChange([...value, { kind, label, value: "" }]);
    setOpen(false);
  };

  const change = (index: number, patch: Partial<ShownDetail>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  // Focus stays with the list: the row that took the removed one's place, else the row before it, else the button.
  const remove = (index: number) => {
    pendingFocus.current = index < value.length - 1 ? index : index > 0 ? index - 1 : "add";
    onChange(value.filter((_, i) => i !== index));
  };

  const closeOnEscape = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    setOpen(false);
    addButton.current?.focus();
  };

  return (
    <div ref={root} role="group" aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <Label id={`${id}-heading`}>Details</Label>
      {value.length > 0 && (
        <ul className="flex flex-col gap-3">
          {value.map((row, index) => {
            const own = row.kind === "other";
            // The nth own row, so a screen reader can tell several of them apart.
            const position = value.slice(0, index + 1).filter((r) => r.kind === "other").length;
            const textId = `${id}-text-${index}`;
            const nameId = `${id}-name-${index}`;
            return (
              <li key={index} data-row={index} className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row">
                  {own && (
                    <div className="flex flex-col gap-1.5 sm:w-2/5">
                      <Label htmlFor={nameId}>What it is</Label>
                      <Input
                        id={nameId}
                        aria-label={`Detail ${position}, what it is`}
                        type="text"
                        value={row.label}
                        onChange={(e) => change(index, { label: e.target.value })}
                        placeholder="e.g. Scent"
                        className="h-12"
                      />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor={textId}>{own ? "Detail" : row.label || KIND_NAMES[row.kind] || row.kind}</Label>
                    <Input
                      id={textId}
                      aria-label={own ? `Detail ${position}, text` : undefined}
                      type="text"
                      value={row.value}
                      onChange={(e) => change(index, { value: e.target.value })}
                      className="h-12"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  className="mt-7"
                  aria-label={row.label ? `Remove ${row.label}` : `Remove detail ${position}`}
                  onClick={() => remove(index)}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col items-start gap-2" onKeyDown={closeOnEscape}>
        <Button
          ref={addButton}
          type="button"
          aria-controls={open ? `${id}-kinds` : undefined}
          variant="secondary"
          size="small"
          aria-expanded={open}
          disabled={full}
          onClick={() => setOpen((o) => !o)}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add details
        </Button>
        {open && (
          <ul id={`${id}-kinds`} aria-label="Kinds of detail" className="flex flex-wrap gap-2">
            {DETAIL_KINDS.map((kind) => (
              <li key={kind}>
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  disabled={!canAdd(kind)}
                  onClick={() => add(kind)}
                >
                  {KIND_NAMES[kind]}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <Text variant="error" size="sm" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
}
