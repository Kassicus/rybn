import { describe, it, expect } from "vitest";
import { GROUP_DATE_RULES as FORM_RULES } from "@/lib/schemas/occasions";
import { GROUP_DATE_RULES, GROUP_DATE_SENTENCES } from "./sentences";

describe("the group date actions' sentences", () => {
  // Written out, so changing a single character of one fails here.
  it("are the words the actions answer, character for character", () => {
    expect(GROUP_DATE_SENTENCES).toEqual({
      notYoursToEdit: "That occasion no longer exists, or is not yours to edit",
      notYoursToDelete: "That occasion no longer exists, or is not yours to delete",
    });
    expect(GROUP_DATE_RULES).toEqual({
      name: "Give this occasion a name",
      nameTooLong: "Keep the name to 200 characters or fewer.",
      date: "Please enter a valid date (YYYY-MM-DD)",
    });
  });

  it("passes on the schema's sentences as they are", () => expect(GROUP_DATE_RULES).toBe(FORM_RULES));
});
