import { describe, it, expect } from "vitest";
import {
  buildMyProfile,
  buildPersonProfile,
  parseProfileBody,
  parseVisibilityBody,
  profileFormData,
  type InfoRow,
} from "./profile";
import { fixture } from "./test-fixtures";
import { MOM_ROW, SAM_CHOICE, SAM_ROW, momVisible, samInfo } from "./test-profile";
import { IDS } from "./test-shopping";

const RIVERA = { id: IDS.rivera, name: "Rivera Family" };
const BOOK_CLUB = { id: IDS.bookClub, name: "Book Club" };
const SAM_SETTING = { visibleToGroupTypes: ["family", "friends"], restrictToGroup: null };
const values = (profile: ReturnType<typeof buildMyProfile>) =>
  profile.sections.flatMap((s) => s.fields.map((f) => f.value));

describe("your own profile", () => {
  it("builds the profile fixture", () =>
    expect(buildMyProfile(SAM_ROW, samInfo(), SAM_CHOICE)).toEqual(fixture("profile").profile));

  it("says mixed when one field has another setting", () => {
    const info = samInfo();
    info[2] = { ...info[2], privacy_settings: { visibleToGroupTypes: ["family"], restrictToGroup: null } };
    expect(buildMyProfile(SAM_ROW, info, SAM_CHOICE).mixed).toBe(true);
  });

  it("says mixed when one field is tied to one group", () => {
    const info = samInfo();
    info[0] = { ...info[0], privacy_settings: { visibleToGroupTypes: ["family", "friends"], restrictToGroup: IDS.rivera } };
    expect(buildMyProfile(SAM_ROW, info, SAM_CHOICE).mixed).toBe(true);
  });

  it("says mixed when a field the catalog does not hold has another setting, as saving the choice sets it too", () => {
    const info: InfoRow[] = [
      ...samInfo(),
      { category: "personal", field_name: "favorite_movie", field_value: "Paddington 2", privacy_settings: { visibleToGroupTypes: ["family"], restrictToGroup: null } },
    ];
    expect(buildMyProfile(SAM_ROW, info, SAM_CHOICE).mixed).toBe(true);
  });

  it("answers every field empty, and the stored choice, for a person with no fields", () => {   // Review Focus 4
    const profile = buildMyProfile(SAM_ROW, [], SAM_CHOICE);
    expect(values(profile)).toEqual(Array(23).fill(null));
    expect([profile.visibleTo, profile.mixed]).toEqual([["family", "friends"], false]);
    // A person who chose only themselves keeps that choice with no fields too.
    const onlyMe = buildMyProfile(SAM_ROW, [], []);
    expect([onlyMe.visibleTo, onlyMe.mixed]).toEqual([[], false]);
  });

  it("answers the stored choice as it is given, already in order (readStoredChoice), as a list of its own", () => {
    const choice = Object.freeze(["family", "custom"] as const);
    const profile = buildMyProfile(SAM_ROW, [], choice);
    expect(profile.visibleTo).toEqual(["family", "custom"]);
    expect(profile.visibleTo).not.toBe(choice);
  });

  it("ignores a field it does not know and an empty value", () => {
    const info: InfoRow[] = [
      ...samInfo(),
      { category: "personal", field_name: "favorite_movie", field_value: "Paddington 2", privacy_settings: SAM_SETTING },
      { category: "sizes", field_name: "constructor", field_value: "x", privacy_settings: SAM_SETTING },
      { category: "sizes", field_name: "ring_size", field_value: "", privacy_settings: SAM_SETTING },
      { category: "sizes", field_name: "hat_size", field_value: "   ", privacy_settings: SAM_SETTING },
      { category: "sizes", field_name: "pants_size", field_value: null, privacy_settings: SAM_SETTING },
    ];
    const profile = buildMyProfile(SAM_ROW, info, SAM_CHOICE);
    expect(profile).toEqual(fixture("profile").profile);
    expect(JSON.stringify(profile)).not.toMatch(/favorite_movie|Paddington|constructor/);
  });

  it("sends the row's four named columns and nothing else of it", () => {
    const row = { ...SAM_ROW, id: "user_2abcDEF", email: "sam@example.com", email_preferences: { email_marketing: true } };
    expect(JSON.stringify(buildMyProfile(row, samInfo(), SAM_CHOICE))).not.toMatch(/email|@example\.com|user_2abcDEF/);
  });
});

describe("the body of a profile save", () => {
  it("reads the request fixture", () =>
    expect(parseProfileBody(fixture("profile-request"))).toEqual({
      ok: true,
      body: {
        username: "sam",
        displayName: "Sam Rivera",
        bio: "Coffee, maps and long walks.",
        fields: { shirt_size: "L", hobbies: null },
      },
    }));

  it("trims, and takes an empty text as a clear", () => {
    expect(parseProfileBody({ username: " sam ", displayName: "  ", bio: " Hi \n", fields: { ring_size: " 7 ", hat_size: "" } }))
      .toEqual({ ok: true, body: { username: "sam", displayName: null, bio: "Hi", fields: { ring_size: "7", hat_size: null } } });
    // An empty username stays text, for the form's own rule to refuse.
    expect(parseProfileBody({ username: "  ", displayName: null, bio: null })).toEqual({
      ok: true,
      body: { username: "", displayName: null, bio: null, fields: {} },
    });
  });

  const valid = { username: "sam", displayName: "Sam Rivera", bio: null };
  it.each<unknown>([
    { username: 5 },
    { username: "sam", fields: { email: "x" } },
    { username: "sam", fields: { shoe_size: 10 } },
    [],
    null,
    "sam",
    { displayName: "Sam Rivera", bio: null },
    { username: "sam", bio: null },
    { username: "sam", displayName: "Sam Rivera" },
    { ...valid, displayName: 5 },
    { ...valid, bio: ["x"] },
    { ...valid, fields: { email: "x" } },
    { ...valid, fields: { constructor: "x" } },
    { ...valid, fields: { shoe_size: 10 } },
    { ...valid, fields: { shoe_size: "10", avatar_url: "https://img.clerk.com/x" } },
    { ...valid, fields: ["shoe_size"] },
    { ...valid, fields: null },
  ])("refuses %j", (raw) =>
    expect(parseProfileBody(raw)).toEqual({ ok: false, message: "That request wasn't valid." }));

  it("refuses a field named __proto__", () =>
    expect(parseProfileBody(JSON.parse('{"username":"sam","displayName":null,"bio":null,"fields":{"__proto__":"x"}}')))
      .toEqual({ ok: false, message: "That request wasn't valid." }));

  it("never sends an avatar or a visibility to updateProfile", () => {
    const parsed = parseProfileBody({
      ...fixture("profile-request"),
      avatarUrl: "https://img.clerk.com/x",
      avatar_url: "https://img.clerk.com/x",
      visibleTo: [],
      visible_to_group_types: [],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    expect(Object.keys(profileFormData(parsed.body))).toEqual(["username", "display_name", "bio", "shirt_size", "hobbies"]);
    expect(profileFormData(parsed.body)).toEqual({
      username: "sam",
      display_name: "Sam Rivera",
      bio: "Coffee, maps and long walks.",
      shirt_size: "L",
      hobbies: null,
    });
  });
});

describe("the body of a visibility save", () => {
  it("reads the request fixture", () =>
    expect(parseVisibilityBody(fixture("visibility-request"))).toEqual({ ok: true, visibleTo: ["family"] }));

  it("puts the kinds in order, once each, and takes none as only you", () => {
    expect(parseVisibilityBody({ visibleTo: ["work", "family", "work"] })).toEqual({ ok: true, visibleTo: ["family", "work"] });
    expect(parseVisibilityBody({ visibleTo: [] })).toEqual({ ok: true, visibleTo: [] });
  });

  it.each<unknown>([{ visibleTo: ["club"] }, { visibleTo: "family" }, {}, { visibleTo: null }, [], null, undefined])(
    "refuses %j with the sentence",
    (raw) =>
      expect(parseVisibilityBody(raw)).toEqual({ ok: false, message: "Choose which kinds of group can see your details." }));
});

describe("another person's profile", () => {
  it("builds the person-profile fixture, field by field", () =>
    expect(buildPersonProfile(MOM_ROW, momVisible(), [RIVERA])).toEqual(fixture("person-profile")));

  it("sends four named person fields and no email", () => {
    const answer = buildPersonProfile({ ...MOM_ROW, email: "mom@example.com" } as typeof MOM_ROW, momVisible(), [RIVERA]);
    expect(Object.keys(answer.person)).toEqual(["id", "name", "username", "avatarUrl"]);
    expect(JSON.stringify(answer)).not.toMatch(/email|@example\.com/);
  });

  it("never says what a field's setting is, or that anything was hidden", () => {
    const info = momVisible().map((r) => ({ ...r, id: "x", user_id: MOM_ROW.id, privacy_settings: SAM_SETTING }));
    const answer = buildPersonProfile(MOM_ROW, info, [RIVERA]);
    expect(answer).toEqual(fixture("person-profile"));
    expect(Object.keys(answer)).toEqual(["person", "bio", "sections", "sharedGroups"]);
    expect(JSON.stringify(answer)).not.toMatch(/visibleToGroupTypes|restrictToGroup|privacy|user_id/);
  });

  it("leaves out a section with nothing to show", () => {
    expect(buildPersonProfile(MOM_ROW, momVisible(), [RIVERA]).sections.map((s) => s.id)).toEqual(["sizes", "preferences", "dates"]);
    expect(buildPersonProfile(MOM_ROW, [], [RIVERA]).sections).toEqual([]);
  });

  it("lists the groups the two share by name", () =>
    expect(buildPersonProfile(MOM_ROW, [], [RIVERA, BOOK_CLUB]).sharedGroups).toEqual([BOOK_CLUB, RIVERA]));

  it("answers no bio for an empty one", () => {
    expect(buildPersonProfile({ ...MOM_ROW, bio: "  " }, [], [RIVERA]).bio).toBeNull();
    expect(buildPersonProfile({ ...MOM_ROW, bio: null }, [], [RIVERA]).bio).toBeNull();
  });
});
