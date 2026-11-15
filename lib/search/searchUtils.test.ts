import { describe, it, expect } from "vitest";
import { eitherContains } from "./searchUtils";

/**
 * A search's text reaches PostgREST's `or` filter as a double-quoted value, so
 * whatever characters it holds it is matched as text and adds no condition of
 * its own.
 */

/**
 * The conditions of an `or` filter, read as PostgREST reads them: split at the
 * commas outside double quotes, where a backslash inside the quotes keeps the
 * next character as it is.
 */
function conditions(filter: string): string[] {
  const found: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < filter.length; i++) {
    const char = filter[i];
    if (quoted && char === "\\") {
      current += char + filter[i + 1];
      i++;
    } else if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (char === "," && !quoted) {
      found.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  found.push(current);
  return found;
}

/** A condition's column, operator and the value its quotes hold, unescaped. */
function parts(condition: string): { column: string; operator: string; value: string } {
  const match = /^([a-z_]+)\.([a-z]+)\."((?:[^"\\]|\\.)*)"$/.exec(condition);
  if (!match) throw new Error(`not a quoted condition: ${condition}`);
  return { column: match[1], operator: match[2], value: match[3].replace(/\\(.)/g, "$1") };
}

describe("eitherContains", () => {
  it("matches an ordinary word in either column, without regard to case", () => {
    expect(eitherContains("title", "description", "Word")).toBe(
      'title.ilike."%word%",description.ilike."%word%"'
    );
  });

  it.each([
    ["a comma, a full stop, parentheses, a double quote and a backslash", 'Scarf, wool. (red) "large" \\ blue'],
    ["a text written as conditions of its own", "zzz,price.gt.0,title.ilike.zzz"],
    ["a closing quote and a comma", 'zzz",price.gt.0,title.ilike."zzz'],
    ["a trailing backslash", "zzz\\"],
  ])("keeps %s inside the quotes: exactly two conditions, each holding the whole text", (_case, text) => {
    const filter = eitherContains("title", "description", text);

    const found = conditions(filter).map(parts);
    expect(found).toEqual([
      { column: "title", operator: "ilike", value: `%${text.toLowerCase()}%` },
      { column: "description", operator: "ilike", value: `%${text.toLowerCase()}%` },
    ]);
  });

  it("escapes every backslash and double quote with a backslash", () => {
    expect(eitherContains("name", "description", 'a"b\\c')).toBe(
      'name.ilike."%a\\"b\\\\c%",description.ilike."%a\\"b\\\\c%"'
    );
  });
});
