import { redirect } from "next/navigation";
import { getMyWishlist } from "@/lib/actions/wishlist";
import { getUpcomingOccasions } from "@/lib/actions/occasions";
import { getTagsForItems } from "@/lib/actions/item-occasions";
import { daysUntil } from "@/lib/occasions/display";
import { taggableOccasions } from "@/lib/occasions/taggable";
import { RelativeWhen } from "@/components/occasions/RelativeWhen";
import { whenLabel } from "@/components/occasions/whenLabel";
import { formatMonthDay } from "@/lib/utils/dates";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { WishlistItemCard } from "@/components/wishlist/WishlistItemCard";
import { Plus, Gift } from "lucide-react";
import Link from "next/link";

import { getUserId } from "@/lib/auth/require-auth";
export default async function WishlistPage() {
  const userId = await getUserId();

  if (!userId) {
    redirect("/login");
  }

  const { data: items, error } = await getMyWishlist();

  // getUpcomingOccasions() carries no claim fields at all (see
  // UpcomingOccasion in lib/occasions/display.ts) -- there is nothing here to
  // strip, unlike getMyWishlist() above. The soonest occasion where the
  // viewer IS the celebrant is the viewer's own upcoming birthday or
  // anniversary; a group_date row always has celebrantId: null, so it can
  // never match here. Failure is swallowed to `[]` rather than surfaced: this
  // is a one-line decoration on the owner's list, not the list itself, and
  // the page must not error out over it.
  //
  // 30 days, deliberately narrow: this is a single context line on the
  // viewer's OWN list, not a calendar, and is only worth showing when it is
  // close enough to act on -- finish curating the list before people start
  // shopping for it. A birthday 300 days out would read as noise here, the
  // exact failure mode a single widened default would produce (Important
  // 1); it is not noise on the group page or dashboard, where it is one
  // entry among several rather than the only line on the page.
  const { data: occasions = [] } = await getUpcomingOccasions(30);
  const myOccasion =
    occasions.find((occasion) => occasion.celebrantId === userId) ?? null;

  // A SEPARATE call from the context line above, at a SEPARATE horizon, on
  // purpose -- these two ask different questions. The context line above
  // asks "is this soon?" (30 days: only worth surfacing when close enough to
  // act on). Tagging asks "what could this be for?": a birthday eleven
  // months out is still a legitimate thing to tag an item for while curating
  // a list well ahead of time, and Phase 1 already shipped one bug from a
  // too-narrow default hiding an occasion that had just been created
  // (106 days out). 365 covers a full year, so every derived birthday or
  // anniversary is always inside the window (celebration_date_in_year always
  // resolves to the NEXT occurrence, at most 365 days out) -- see
  // taggableOccasions()'s own doc comment for why this raw list is further
  // filtered before anything renders it as a tag target.
  const { data: occasionsForTagging = [] } = await getUpcomingOccasions(365);
  const taggableForItem = taggableOccasions(occasionsForTagging, userId);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-error">Error loading wishlist: {error}</p>
      </div>
    );
  }

  // item id -> occasion ids this item is tagged for. getTagsForItems reads
  // wishlist_item_occasions, a table with no claim columns at all -- see
  // ItemOccasionTags.tsx's doc comment for the full owner-blindness
  // argument. Short-circuits to {} without a DB call for an empty item list
  // (see that function's own doc comment), so this is free on the empty
  // wishlist below.
  //
  // getTagsForItems's two branches don't share a companion `data?: never` /
  // `error?: never` field (unlike getUpcomingOccasions above), so a
  // destructured default can't be used here -- `in` narrows it instead. A
  // failure here is swallowed to {} for the same reason the occasions fetch
  // above swallows its own: this decorates the list, it is not the list.
  const tagsResult = await getTagsForItems(
    (items ?? []).map((item) => item.id)
  );
  const tagsByItemId = "data" in tagsResult ? tagsResult.data : {};

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My Wishlist", href: "/wishlist" },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Heading level="h1" className="font-display">
            My Wishlist
          </Heading>
          <Text variant="secondary">
            Items you&apos;d love to receive as gifts
          </Text>
        </div>
        <Link href="/wishlist/add">
          <Button variant="primary">
            <Plus className="w-4 h-4 mr-2" />
            Add Item
          </Button>
        </Link>
      </div>

      {/* Context only -- this line does not link anywhere or invite an
          action; tagging (Phase 2) lives on each item card below instead.
          Renders the occasion and its date and nothing else: no counts, no
          claim state. See getMyWishlist() above, which already stripped
          every claim field from `items` before this component ever saw
          them -- there is nothing claim-shaped left to leak, from any fetch
          on this page. */}
      {myOccasion && (
        <Text variant="secondary">
          {myOccasion.kind === "birthday" ? "Your birthday" : "Your anniversary"}{" "}
          is{" "}
          <RelativeWhen
            occasionDate={myOccasion.occasionDate}
            serverLabel={whenLabel(daysUntil(myOccasion.occasionDate))}
          />{" "}
          ({formatMonthDay(myOccasion.occasionDate)})
        </Text>
      )}

      {/* Empty state */}
      {items && items.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-light-border px-6 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-md bg-primary-50">
            <Gift className="h-7 w-7 text-primary" />
          </span>
          <div className="flex flex-col gap-1.5">
            <Heading level="h3" className="font-display">
              Nothing on your list yet
            </Heading>
            <Text variant="secondary">
              Add something you&apos;d like, and anyone you share with can see it.
            </Text>
          </div>
          <Link href="/wishlist/add">
            <Button variant="primary">
              <Plus className="w-4 h-4 mr-2" />
              Add your first item
            </Button>
          </Link>
        </div>
      )}

      {/* Wishlist items */}
      {items && items.length > 0 && (
        <div className="flex flex-col gap-4">
          {items.map((item) => (
            <WishlistItemCard
              key={item.id}
              item={item as any}
              isOwnWishlist={true}
              taggedOccasionIds={tagsByItemId[item.id] ?? []}
              availableOccasions={taggableForItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}
