import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { GROUP_RULES } from "@/lib/schemas/groups";
import { NOT_A_MEMBER } from "./action-response";
import {
  GROUP_REFUSALS,
  INVITATION_WORDS,
  groupRole,
  invitationAnswer,
  parseInvitationBody,
  parseJoinBody,
  parseNewGroupBody,
} from "./groups";
import { fixture } from "./test-fixtures";
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

it("answers the invitation fixture for a first send, and says so for a resend and a failed email", () => {
  expect(invitationAnswer({ emailSent: true, isResend: false })).toEqual(fixture("invitation"));
  expect(invitationAnswer({ emailSent: true, isResend: true }))
    .toEqual({ sent: true, resent: true, message: "Invitation resent successfully!" });
  const W = "The invitation is saved, but we couldn't send the email just now. Try resending it in a moment.";
  expect(invitationAnswer({ emailSent: false, isResend: false, warning: W })).toEqual({ sent: false, resent: false, message: W });
  expect(INVITATION_WORDS).toEqual({ sent: "Invitation sent successfully!", resent: "Invitation resent successfully!" });
});

/** The source of one exported function of a server action module. */
function actionSource(file: string, name: string): string {
  const text = readFileSync(fileURLToPath(new URL(`../actions/${file}`, import.meta.url)), "utf8");
  const start = text.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\nexport ", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

describe("the site's sentences the group routes match", () => {
  const says = (file: string, name: string, sentence: string) =>
    expect(actionSource(file, name)).toContain(`error: ${JSON.stringify(sentence)}`);

  it("joinGroupByCode answers each refusal the join route passes on", () => {
    expect(readFileSync(fileURLToPath(new URL("../actions/invitations.ts", import.meta.url)), "utf8"))
      .toContain(`const INVALID_INVITE_CODE = ${JSON.stringify(GROUP_REFUSALS.invalidCode)};`);
    expect(actionSource("invitations.ts", "joinGroupByCode")).toContain("error: INVALID_INVITE_CODE");
    says("invitations.ts", "joinGroupByCode", GROUP_REFUSALS.alreadyMember);
    says("invitations.ts", "joinGroupByCode", GROUP_REFUSALS.stillSettingUp);
  });

  it("sendGroupInvitation answers each refusal the invitation route passes on", () => {
    expect(actionSource("invitations.ts", "sendGroupInvitation")).toContain("error: GROUP_RULES.email");
    says("invitations.ts", "sendGroupInvitation", NOT_A_MEMBER);
    says("invitations.ts", "sendGroupInvitation", GROUP_REFUSALS.hourlyLimit);
    says("invitations.ts", "sendGroupInvitation", GROUP_REFUSALS.alreadyInGroup);
  });

  it("leaveGroup and deleteGroup answer the refusals the membership and group routes pass on", () => {
    says("groups.ts", "leaveGroup", NOT_A_MEMBER);
    says("groups.ts", "leaveGroup", GROUP_REFUSALS.ownerCannotLeave);
    says("groups.ts", "deleteGroup", GROUP_REFUSALS.onlyOwnerDeletes);
  });
});
