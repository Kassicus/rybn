import { describe, it, expect } from "vitest";
import { GROUP_RULES, GROUP_SENTENCES } from "@/lib/groups/sentences";
import { GROUP_DATE_RULES, GROUP_DATE_SENTENCES } from "@/lib/occasions/sentences";
import { GROUP_NOT_FOUND, NOT_A_MEMBER } from "./action-response";
import {
  GROUP_DATE_ROUTE_ANSWERS,
  GROUP_ROUTE_ANSWERS,
  INVITATION_WORDS,
  groupDateOccasion,
  groupRole,
  invitationAnswer,
  parseGroupDateBody,
  parseInvitationBody,
  parseJoinBody,
  parseNewGroupBody,
} from "./groups";
import { fixture } from "./test-fixtures";
import { GRAN_80TH } from "./test-groups";
import { IDS } from "./test-shopping";
import { RULES } from "./wishlist";

describe("groupRole", () => {
  it.each([["owner", "owner"], ["admin", "admin"], ["member", "member"], ["moderator", "member"], ["OWNER", "member"],
    [null, "member"], [undefined, "member"], [3, "member"]])("reads %j as %j", (value, role) => expect(groupRole(value)).toBe(role));
});

describe("parseNewGroupBody", () => {
  it("accepts the request fixture", () =>
    expect(parseNewGroupBody(fixture("group-request"))).toEqual({
      ok: true, body: { name: "Garcia Cousins", description: "Cousins on Dad's side", type: "family" } }));

  it("takes a null description as none", () => {
    expect(parseNewGroupBody({ name: "Garcia Cousins", description: null, type: "family" }))
      .toEqual({ ok: true, body: { name: "Garcia Cousins", description: null, type: "family" } });
    expect(parseNewGroupBody({ name: "Garcia Cousins", type: "family" }))
      .toEqual({ ok: true, body: { name: "Garcia Cousins", description: null, type: "family" } });
  });

  it.each([
    [{ name: " ", type: "family" }, "Group name is required"],
    [{ name: "Garcia Cousins", type: "club" }, "Choose a kind of group."],
    [[], "That request wasn't valid."],
    [null, RULES.request], ["Garcia Cousins", RULES.request], [undefined, RULES.request],
    [{ name: "G".repeat(51), type: "family" }, GROUP_RULES.nameTooLong],
    [{ name: "Garcia Cousins", description: "d".repeat(201), type: "family" }, GROUP_RULES.descriptionTooLong],
    [{ name: "Garcia Cousins", description: 7, type: "family" }, GROUP_RULES.descriptionTooLong],
  ])("refuses %j", (raw, message) => expect(parseNewGroupBody(raw)).toEqual({ ok: false, message }));
});

it("passes a join code on as sent, and refuses a body with none", () => {
  expect(parseJoinBody({ code: "k7p mxr 4tq" })).toEqual({ ok: true, code: "k7p mxr 4tq" });
  expect(parseJoinBody(fixture("join-request"))).toEqual({ ok: true, code: "K7P-MXR-4TQ" });
  for (const raw of [{}, { code: 7 }, { code: null }, [], null, "K7P-MXR-4TQ", undefined]) {
    expect(parseJoinBody(raw)).toEqual({ ok: false, message: "Invalid invite code" });
  }
});

it("passes an address on as sent, and refuses a body with none", () => {
  expect(parseInvitationBody(fixture("invitation-request"))).toEqual({ ok: true, email: "gran@example.com" });
  expect(parseInvitationBody({ email: "gran@example.com " })).toEqual({ ok: true, email: "gran@example.com " });
  for (const raw of [{}, { email: 7 }, { email: null }, [], null, "gran@example.com", undefined]) {
    expect(parseInvitationBody(raw)).toEqual({ ok: false, message: GROUP_RULES.email });
  }
});

it("refuses a code longer than 64 characters as it refuses any other bad code", () => {
  expect(parseJoinBody({ code: "K".repeat(64) })).toEqual({ ok: true, code: "K".repeat(64) });
  expect(parseJoinBody({ code: "K".repeat(65) })).toEqual({ ok: false, message: "Invalid invite code" });
  expect(parseJoinBody({ code: "K".repeat(5_000_000) })).toEqual({ ok: false, message: "Invalid invite code" });
});

it("refuses an address longer than 254 characters, once trimmed, as it refuses any other bad address", () => {
  const longest = `${"a".repeat(64)}@${"b".repeat(185)}.com`;   // 254
  expect(longest).toHaveLength(254);
  expect(parseInvitationBody({ email: `${longest} ` })).toEqual({ ok: true, email: `${longest} ` });
  for (const email of [`${"a".repeat(64)}@${"b".repeat(186)}.com`, "a".repeat(5_000_000)]) {
    expect(parseInvitationBody({ email })).toEqual({ ok: false, message: GROUP_RULES.email });
  }
});

it("answers the invitation fixture for a first send, and says so for a resend and a failed email", () => {
  expect(invitationAnswer({ emailSent: true, isResend: false })).toEqual(fixture("invitation"));
  expect(invitationAnswer({ emailSent: true, isResend: true }))
    .toEqual({ sent: true, resent: true, message: "Invitation resent successfully!" });
  const W = "The invitation is saved, but we couldn't send the email just now. Try resending it in a moment.";
  expect(invitationAnswer({ emailSent: false, isResend: false, warning: W })).toEqual({ sent: false, resent: false, message: W });
  expect(INVITATION_WORDS).toEqual({ sent: "Invitation sent successfully!", resent: "Invitation resent successfully!" });
});

describe("the sentences the group routes match", () => {
  const exported: string[] = [...Object.values(GROUP_SENTENCES), ...Object.values(GROUP_RULES)];
  const matched = [
    ...Object.values(GROUP_ROUTE_ANSWERS).flatMap((answers): readonly string[] => [
      ...("notFound" in answers ? answers.notFound : []), ...answers.refusals]),
    GROUP_NOT_FOUND, NOT_A_MEMBER,   // GET /groups/{id}
  ];

  it("are each one that lib/groups/sentences exports, the module the actions answer from", () => {
    expect(matched.length).toBeGreaterThan(0);
    for (const sentence of matched) expect(exported).toContain(sentence);
  });

  it("are the ones each route passes on", () => expect(GROUP_ROUTE_ANSWERS).toEqual({
    join: { refusals: ["Invalid invite code", "You are already a member of this group", "Your account is still being set up. Please try again."] },
    invitation: {
      notFound: ["You are not a member of this group"],
      refusals: ["Please enter a valid email address",
        "Rate limit exceeded. You can send up to 10 invitations per hour. Please try again later.",
        "This user is already a member of the group"],
    },
    leave: { notFound: ["You are not a member of this group"], refusals: ["Owners cannot leave the group. Transfer ownership or delete the group."] },
    delete: { refusals: ["Only the owner can delete this group"] },
  }));
});

describe("a group date at the door", () => {
  const rivera = { id: IDS.rivera, name: "Rivera Family" };

  it("reads a date's body, and builds the date fixture's occasion", () => {
    expect(parseGroupDateBody(fixture("group-date-request"))).toEqual({ ok: true, name: "Gran's 80th", date: "2027-03-14" });
    expect({ occasion: groupDateOccasion(GRAN_80TH, "Gran's 80th", "2027-03-14", rivera) }).toEqual(fixture("group-date"));
  });

  it("passes the name and the date on as sent, for the action to check, and titles the date as the action stores it", () => {
    expect(parseGroupDateBody({ name: "  Gran's 80th ", date: "2026-02-30", createdBy: "user_2momABC", groupId: IDS.bookClub }))
      .toEqual({ ok: true, name: "  Gran's 80th ", date: "2026-02-30" });
    expect(parseGroupDateBody({ name: "", date: "" })).toEqual({ ok: true, name: "", date: "" });
    expect(groupDateOccasion(GRAN_80TH, "  Gran's 80th\n", "2027-03-14", rivera).title).toBe("Gran's 80th");
    expect(groupDateOccasion(GRAN_80TH, "Gran's\n80th\u{200B}party", "2027-03-14", rivera).title).toBe("Gran's 80th party");
  });

  it.each([
    [{ date: "2027-03-14" }, "Give this occasion a name"],
    [{ name: "x" }, "Please enter a valid date (YYYY-MM-DD)"],
    ["x", "That request wasn't valid."],
    [{ name: 7, date: "2027-03-14" }, "Give this occasion a name"],
    [{ name: null, date: "2027-03-14" }, "Give this occasion a name"],
    [{ name: "x", date: 20270314 }, "Please enter a valid date (YYYY-MM-DD)"],
    [{ name: "x", date: null }, "Please enter a valid date (YYYY-MM-DD)"],
    [[], RULES.request], [null, RULES.request], [undefined, RULES.request],
  ])("refuses %j", (raw, message) => expect(parseGroupDateBody(raw)).toEqual({ ok: false, message }));
});

describe("the sentences the group date routes match", () => {
  it("are each one the date actions answer from a shared module", () => {
    const exported: string[] = [
      ...Object.values(GROUP_DATE_SENTENCES), ...Object.values(GROUP_DATE_RULES), ...Object.values(GROUP_SENTENCES)];
    const matched = Object.values(GROUP_DATE_ROUTE_ANSWERS).flatMap((answers): readonly string[] => [
      ...answers.notFound, ...("refusals" in answers ? answers.refusals : [])]);
    expect(matched.length).toBeGreaterThan(0);
    for (const sentence of matched) expect(exported).toContain(sentence);
  });

  it("are the ones each route passes on", () => {
    const refusals = ["Give this occasion a name", "Keep the name to 200 characters or fewer.", "Please enter a valid date (YYYY-MM-DD)"];
    expect(GROUP_DATE_ROUTE_ANSWERS).toEqual({
      add: { notFound: ["You are not a member of this group"], refusals },
      save: { notFound: ["That occasion no longer exists, or is not yours to edit"], refusals },
      delete: { notFound: ["That occasion no longer exists, or is not yours to delete"] },
    });
  });
});
