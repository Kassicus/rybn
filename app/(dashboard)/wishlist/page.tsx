import { redirect } from "next/navigation";
import { getMyWishlist } from "@/lib/actions/wishlist";
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

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-error">Error loading wishlist: {error}</p>
      </div>
    );
  }

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
            />
          ))}
        </div>
      )}
    </div>
  );
}
