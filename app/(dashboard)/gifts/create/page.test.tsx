// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

/**
 * The create page asks who a group gift is for: the chosen group's people, then people from the caller's other
 * groups, then "Someone not on Rybn". These render the real page and mock only the two actions.
 */

const getGroupGiftChoices = vi.fn();
const createGroupGift = vi.fn();
vi.mock("@/lib/actions/gifts", () => ({
  getGroupGiftChoices: () => getGroupGiftChoices(),
  createGroupGift: (data: unknown) => createGroupGift(data),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/layout/BreadcrumbSetter", () => ({ BreadcrumbSetter: () => null }));

const { default: CreateGiftGroupPage } = await import("./page");

const BOOK_CLUB = "2b8f6c4a-1e3d-4f5a-9b7c-0d1e2f3a4b5c";
const RIVERA = "7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e";

const person = (id: string, display_name: string, group_ids: string[]) => ({
  id,
  username: display_name.toLowerCase(),
  display_name,
  avatar_url: null,
  group_ids,
});

const CHOICES = {
  data: {
    groups: [
      { id: BOOK_CLUB, name: "Book Club" },
      { id: RIVERA, name: "Rivera Family" },
    ],
    people: [
      person("user_2alxABC", "Alex", [RIVERA]),
      person("user_2dadABC", "Dad", [RIVERA]),
      person("user_2grnABC", "Gran", [RIVERA]),
      person("user_2jrdABC", "jordan", [RIVERA]),
      person("user_2momABC", "Mom", [RIVERA]),
      person("user_2prySHA", "Priya", [BOOK_CLUB]),
    ],
  },
};

/** The checkboxes of the "Who is it for?" fieldset, by their names, in the order shown. */
const listed = () =>
  within(screen.getByRole("group", { name: "Who is it for?" }))
    .getAllByRole("checkbox")
    .map((box) => (box as HTMLInputElement).labels?.[0]?.textContent);

const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

const chooseGroup = (id: string) => fireEvent.change(screen.getByRole("combobox"), { target: { value: id } });

const fillName = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText("e.g., Birthday Gift for Sarah"), { target: { value } });

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Create Group Gift" }));

const open = async () => {
  render(<CreateGiftGroupPage />);
  await screen.findByRole("group", { name: "Who is it for?" });
};

beforeEach(() => {
  vi.clearAllMocks();
  getGroupGiftChoices.mockResolvedValue(CHOICES);
  createGroupGift.mockResolvedValue({ error: "stop here" });
});

afterEach(() => {
  cleanup();
});

describe("the create page's Who is it for?", () => {
  it("lists the chosen group's people, then the others, then Someone not on Rybn", async () => {
    await open();
    // The first group by name is chosen: Book Club has only Priya.
    expect(listed()).toEqual(["Priya", "Alex", "Dad", "Gran", "jordan", "Mom", "Someone not on Rybn"]);
    expect(screen.getByText("From your other groups")).toBeTruthy();

    chooseGroup(RIVERA);
    expect(listed()).toEqual(["Alex", "Dad", "Gran", "jordan", "Mom", "Priya", "Someone not on Rybn"]);
  });

  it("leaves out the heading when nobody is in another group", async () => {
    getGroupGiftChoices.mockResolvedValue({
      data: { groups: [{ id: RIVERA, name: "Rivera Family" }], people: CHOICES.data.people.slice(0, 5) },
    });
    await open();
    expect(screen.queryByText("From your other groups")).toBeNull();
    expect(listed()).toEqual(["Alex", "Dad", "Gran", "jordan", "Mom", "Someone not on Rybn"]);
  });

  it("sends who it is for, in the order listed", async () => {
    await open();
    chooseGroup(RIVERA);
    fireEvent.click(box("Mom"));
    fireEvent.click(box("Dad"));
    fillName("Anniversary weekend away");
    submit();

    await waitFor(() => expect(createGroupGift).toHaveBeenCalledTimes(1));
    const sent = createGroupGift.mock.calls[0][0];
    expect(sent.recipient_ids).toEqual(["user_2dadABC", "user_2momABC"]);
    expect(sent.group_id).toBe(RIVERA);
    expect(sent.target_amount).toBeNull();
  });

  it("says who will never see it once someone is ticked", async () => {
    await open();
    chooseGroup(RIVERA);
    expect(screen.queryByText(/will never see this gift/)).toBeNull();
    fireEvent.click(box("Mom"));
    fireEvent.click(box("Dad"));
    expect(screen.getByText("Dad and Mom will never see this gift, its pledges or its chat.")).toBeTruthy();
  });

  it("unticks the people when Someone not on Rybn is ticked, and sends an empty list", async () => {
    await open();
    chooseGroup(RIVERA);
    fireEvent.click(box("Mom"));
    fireEvent.click(box("Someone not on Rybn"));
    expect(box("Mom").checked).toBe(false);
    expect(box("Someone not on Rybn").checked).toBe(true);
    expect(screen.queryByText(/will never see this gift/)).toBeNull();

    // Ticking a person unticks it again.
    fireEvent.click(box("Dad"));
    expect(box("Someone not on Rybn").checked).toBe(false);
    fireEvent.click(box("Dad"));
    fireEvent.click(box("Someone not on Rybn"));

    fillName("Surprise");
    submit();
    await waitFor(() => expect(createGroupGift).toHaveBeenCalledTimes(1));
    expect(createGroupGift.mock.calls[0][0].recipient_ids).toEqual([]);
  });

  it("asks Choose who this gift is for. and sends nothing when nobody is ticked", async () => {
    await open();
    chooseGroup(RIVERA);
    fillName("Surprise");
    submit();
    expect(await screen.findByText("Choose who this gift is for.")).toBeTruthy();
    expect(createGroupGift).not.toHaveBeenCalled();
  });

  it("keeps a tick when the group is changed", async () => {
    await open();
    chooseGroup(RIVERA);
    fireEvent.click(box("Mom"));
    chooseGroup(BOOK_CLUB);
    expect(box("Mom").checked).toBe(true);
    expect(listed()).toEqual(["Priya", "Alex", "Dad", "Gran", "jordan", "Mom", "Someone not on Rybn"]);
  });
});
