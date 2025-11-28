import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyWishlist } from "@/lib/actions/wishlist";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { WishlistItemCard } from "@/components/wishlist/WishlistItemCard";
import { Plus, Gift } from "lucide-react";
import Link from "next/link";

export default async function WishlistPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
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
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My Wishlist", href: "/wishlist" },
        ]}
      />
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">My Wishlist</Heading>
          <Text variant="secondary">
            Items you'd love to receive as gifts
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
        <div className="text-center py-16">
          <Gift className="w-16 h-16 mx-auto text-light-text-secondary mb-4" />
          <Heading level="h3" className="mb-2">No wishlist items yet</Heading>
          <Text variant="secondary" className="mb-6">
            Start adding items you'd love to receive!
          </Text>
          <Link href="/wishlist/add">
            <Button variant="primary">
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Item
            </Button>
          </Link>
        </div>
      )}

      {/* Wishlist items */}
      {items && items.length > 0 && (
        <div className="space-y-4">
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
