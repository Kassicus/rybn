"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Circle, Lock, ExternalLink } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { WishlistItemSettings } from "@/components/wishlist/WishlistItemSettings";
import { ClaimActions } from "@/components/wishlist/ClaimActions";
import { getWishlistItem, getClaimerProfile } from "@/lib/actions/wishlist";
import { PRIORITY_INFO } from "@/lib/schemas/wishlist";
import { cn } from "@/lib/utils";
import { SIGNED_IMAGE_REFRESH_MS } from "@/lib/storage/image-value";
import { GROUP_TYPES } from "@/types/privacy";
import type { GroupType } from "@/types/privacy";

interface ClaimerInfo {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

interface WishlistItem {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  url?: string | null;
  price?: number | null;
  /** Signed and renderable; expires. */
  image_url?: string | null;
  /** Raw stored value, masked to null when it is another user's object path. */
  image_path?: string | null;
  priority: 'low' | 'medium' | 'high' | 'must-have';
  category?: string | null;
  privacy_settings: {
    visibleToGroupTypes: GroupType[];
    restrictToGroup?: string | null;
  };
  claimed_by?: string | null;
  purchased?: boolean;
  out_of_stock_marked_by?: string | null;
}


/**
 * Why a load is happening, which decides two things:
 *
 *   mount   - the first load. Nothing is on screen, so any failure means there
 *             is nothing to show and /404 is the honest answer.
 *   saved   - the user just changed the item. Must not be skipped or dropped.
 *   refresh - the timer or a tab focus, renewing the signed image URL. Skipped
 *             when the data is still fresh, and never evicts on a transient
 *             failure.
 */
type LoadReason = "mount" | "saved" | "refresh";

export default function WishlistItemDetailPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = use(params);
  const [item, setItem] = useState<WishlistItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwnWishlist, setIsOwnWishlist] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [claimerInfo, setClaimerInfo] = useState<ClaimerInfo | null>(null);
  const router = useRouter();

  // When the data on screen was last successfully replaced, and whether a load
  // is already running. Refs, not state: neither should cause a render, and the
  // interval callback below must read the CURRENT value rather than the one
  // captured when it was scheduled.
  const lastLoadRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const loadData = useCallback(
    async (reason: LoadReason = "refresh"): Promise<void> => {
      // One load at a time. Dropping a refresh costs nothing -- whatever is in
      // flight is fetching the same row -- and it also removes the chance of two
      // responses resolving out of order and the older one winning. A save must
      // not be dropped though, so it waits its turn instead.
      const inFlight = inFlightRef.current;
      if (inFlight) {
        if (reason === "refresh") return;
        await inFlight;
      }

      // Nothing to renew yet. Without this, alt-tabbing ten times in a minute is
      // ten server actions, each a database read plus a storage signing call.
      if (
        reason === "refresh" &&
        Date.now() - lastLoadRef.current < SIGNED_IMAGE_REFRESH_MS
      ) {
        return;
      }

      const load = (async () => {
        // A throw here is the request itself failing (offline, aborted), which
        // is transient by definition -- never a missing item.
        const result = await getWishlistItem(itemId).catch(() => null);

        if (!result || result.error || !result.data || !result.currentUserId) {
          // Only a GENUINE not-found evicts a reader.
          //
          // This path used to run once, at mount, where any failure meant there
          // was nothing to show anyway. It now also runs on a timer and on every
          // tab focus, so treating a pooler blip as "this item is gone" would
          // navigate someone off the page they were reading -- the kind of thing
          // reported as "it randomly threw me out". On a refresh the data on
          // screen is still valid and its signed URL still has most of an hour
          // left, so the right response to a transient failure is to do nothing.
          const gone = !!result && "notFound" in result && result.notFound === true;
          if (reason === "mount" || gone) {
            router.push("/404");
          }
          return;
        }

        const itemData = result.data;
        const userId = result.currentUserId;

        lastLoadRef.current = Date.now();
        setItem(itemData as any);
        setCurrentUserId(userId);
        setIsOwnWishlist(itemData.user_id === userId);

        // Fetch claimer info if claimed and not own item
        if (itemData.claimed_by && itemData.user_id !== userId) {
          const { data: claimer } = await getClaimerProfile(itemData.claimed_by);
          if (claimer) {
            setClaimerInfo(claimer);
          }
        } else {
          setClaimerInfo(null);
        }

        setLoading(false);
      })();

      inFlightRef.current = load;
      try {
        await load;
      } finally {
        if (inFlightRef.current === load) inFlightRef.current = null;
      }
    },
    [itemId, router]
  );

  useEffect(() => {
    loadData("mount");
  }, [loadData]);

  // Renew the signed image URL before it expires.
  //
  // This is the ONE page in the app that fetches its own data in an effect;
  // everywhere else the images come from a Server Component, which re-signs on
  // every render, so navigation and router.refresh() renew them for free.
  // Neither of those re-runs a useEffect, so without this the URL minted at
  // mount is the only one this page will ever have -- and it is also the page
  // most likely to be left open, which is the worst combination.
  //
  // Two triggers, because a timer alone is not enough: a background tab has its
  // timers throttled and a sleeping machine does not run them at all, so a tab
  // returned to after two hours would still be showing dead URLs until the
  // interval next fired. The visibility handler covers exactly that case.
  //
  // Both fire far more often than they need to -- every tab focus, for a URL
  // valid for the better part of an hour -- so the staleness check and in-flight
  // guard inside loadData are what keep this from being a request per focus.
  // Passing the reason explicitly rather than relying on the default: a callback
  // handed straight to setInterval is one runtime quirk away from being invoked
  // with an argument nobody intended.
  useEffect(() => {
    const interval = setInterval(() => {
      loadData("refresh");
    }, SIGNED_IMAGE_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") loadData("refresh");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadData]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-1/3 mb-4"></div>
          <div className="h-12 bg-muted rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (!item) {
    return null;
  }
  const priorityInfo = PRIORITY_INFO[item.priority];

  const visibleToGroupTypes = item.privacy_settings?.visibleToGroupTypes || [];
  const restrictToGroup = item.privacy_settings?.restrictToGroup;
  const isPrivate = visibleToGroupTypes.length === 0 && !restrictToGroup;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My Wishlist", href: "/wishlist" },
          { label: item.title, href: `/wishlist/${item.id}` },
        ]}
      />
      {/* Header */}
      <div>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <Heading level="h1">{item.title}</Heading>
              {item.claimed_by && !isOwnWishlist && (
                <span className="px-2 py-1 rounded text-sm bg-green-100 text-green-700">
                  Claimed
                </span>
              )}
              {item.purchased && !isOwnWishlist && (
                <span className="px-2 py-1 rounded text-sm bg-blue-100 text-blue-700">
                  Purchased
                </span>
              )}
              {item.out_of_stock_marked_by && !isOwnWishlist && (
                <span className="px-2 py-1 rounded text-sm bg-red-100 text-red-700">
                  Out of Stock
                </span>
              )}
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Circle className={cn("w-5 h-5", priorityInfo.toneClass)} fill="currentColor" />
                <Text className={priorityInfo.toneClass}>
                  {priorityInfo.label}
                </Text>
              </div>

              {item.price && (
                <Text className="font-medium">
                  ${item.price.toFixed(2)}
                </Text>
              )}

              {item.category && (
                <span className="px-2 py-1 rounded text-sm bg-light-background-hover">
                  {item.category}
                </span>
              )}
            </div>
          </div>

          {isOwnWishlist && (
            <WishlistItemSettings
              itemId={item.id}
              itemTitle={item.title}
              item={item}
              onSaved={() => loadData("saved")}
            />
          )}
        </div>
      </div>

      <Separator />

      {/* Item Details */}
      <div className="space-y-6">
        {/* Image */}
        {item.image_url && (
          <div className="w-full max-w-md mx-auto rounded-lg overflow-hidden bg-light-background-hover">
            <img
              src={item.image_url}
              alt={item.title}
              className="w-full h-auto object-contain"
            />
          </div>
        )}

        {/* Description */}
        {item.description && (
          <div>
            <Heading level="h3" className="mb-2">Description</Heading>
            <Text variant="secondary">{item.description}</Text>
          </div>
        )}

        {/* Links and Actions */}
        <div className="flex flex-wrap gap-3">
          {item.url && (
            <Button
              variant="secondary"
              onClick={() => window.open(item.url!, "_blank")}
            >
              <ExternalLink className="w-4 h-4" />
              View Product
            </Button>
          )}
        </div>

        {/* Claim Actions - only for non-owners */}
        {!isOwnWishlist && currentUserId && (
          <ClaimActions
            itemId={item.id}
            claimedBy={item.claimed_by || null}
            purchased={item.purchased || false}
            outOfStockMarkedBy={item.out_of_stock_marked_by || null}
            currentUserId={currentUserId}
            claimerInfo={claimerInfo}
            variant="detail"
            itemData={{
              title: item.title,
              description: item.description,
              url: item.url,
              price: item.price,
              image_path: item.image_path,
              // image_url survives signing, image_path does not survive the
              // owner mask -- so this pair says "has an image we cannot hand on".
              image_is_private_upload: !!item.image_url && !item.image_path,
            }}
          />
        )}

        {/* Privacy Settings - only for owners */}
        {isOwnWishlist && (
          <div className="p-4 rounded-lg border border-light-border bg-light-background-hover">
            <Heading level="h4" className="mb-2">Privacy</Heading>
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-ink-muted" />
              <Text variant="secondary">
                {isPrivate
                  ? "Private: Only you can see this item"
                  : restrictToGroup
                  ? "Restricted to a specific group"
                  : `Visible to: ${visibleToGroupTypes
                      .map((t) => GROUP_TYPES[t].label)
                      .join(", ")} groups`}
              </Text>
            </div>
          </div>
        )}

        {/* Additional Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-light-border">
            <Text variant="secondary" size="sm" className="mb-1">Priority</Text>
            <div className="flex items-center gap-2">
              <Circle className={cn("w-5 h-5", priorityInfo.toneClass)} fill="currentColor" />
              <Text className={cn("font-medium", priorityInfo.toneClass)}>
                {priorityInfo.label}
              </Text>
            </div>
            <Text variant="secondary" size="sm" className="mt-1">
              {priorityInfo.description}
            </Text>
          </div>

          {item.price && (
            <div className="p-4 rounded-lg border border-light-border">
              <Text variant="secondary" size="sm" className="mb-1">Estimated Price</Text>
              <Text className="font-medium text-lg">
                ${item.price.toFixed(2)}
              </Text>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
