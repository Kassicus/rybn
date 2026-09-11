"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  markAsPurchased,
  markOutOfStock,
  unmarkOutOfStock,
} from "@/lib/actions/wishlist";
import { claimItem, releaseClaim } from "@/lib/actions/claims";
import { getMyRecipients } from "@/lib/actions/gift-tracking";
import { createGift } from "@/lib/actions/gift-tracking";
import { isExternalImageUrl } from "@/lib/storage/image-value";
import { Gift, Check, X, ShoppingBag, ClipboardList, Plus, AlertTriangle } from "lucide-react";

interface WishlistItemData {
  title: string;
  description?: string | null;
  url?: string | null;
  price?: number | null;
  /**
   * The item's RAW image value, not the signed URL that is rendered.
   *
   * "Add to Gift Tracker" copies this onto a gift the VIEWER owns, so it has to
   * be something durable. A signed URL is not: it would be stored and then die
   * within the hour. The item owner's object path is not either -- it lives in
   * their private folder, and the write path (correctly) refuses a path the
   * caller does not own. Server-side masking means this arrives as either an
   * external URL or null, and only the external case is carried over.
   */
  image_path?: string | null;
  /**
   * True when the item HAS an image but it is an uploaded object rather than a
   * pasted URL -- i.e. exactly the case where the photo cannot be carried over.
   *
   * image_path alone cannot express this: it is null both for "no image" and
   * for "an image we are not allowed to hand you", and the user needs to be
   * told about the second one.
   */
  image_is_private_upload?: boolean;
}

/**
 * Success confirmation for "Add to Gift Tracker", including the one thing the
 * user would otherwise be left to notice for themselves.
 *
 * An uploaded wishlist image lives in the OWNER's private storage folder, and
 * there is no durable reference to it a different user's gift row could hold:
 * the signed URL on screen expires within the hour, and the object path is
 * refused on write because it is not the claimer's. So it is not copied. Saying
 * nothing would let the photo vanish silently between two screens, which is the
 * failure mode this whole change exists to stop doing elsewhere.
 */
function GiftTrackerSuccess({
  photoDropped,
  standalone = false,
}: {
  photoDropped?: boolean;
  standalone?: boolean;
}) {
  return (
    <div className={standalone ? "pt-3 border-t border-light-border" : undefined}>
      <div className="flex items-center gap-1.5 text-sm text-success">
        <Check className="w-4 h-4" />
        <span>Added to Gift Tracker</span>
      </div>
      {photoDropped && (
        <Text size="sm" variant="secondary" className="mt-1">
          Photo not copied. Add your own in the Gift Tracker.
        </Text>
      )}
    </div>
  );
}

interface GiftRecipient {
  id: string;
  name: string;
}

interface ClaimActionsProps {
  itemId: string;
  claimedBy: string | null;
  purchased: boolean;
  outOfStockMarkedBy: string | null;
  currentUserId: string;
  /**
   * The occasion this claim ACTION would be scoped to if the viewer claims
   * this item right now -- the wishlist owner's id and the birthday/
   * anniversary currently in view, computed by the page (see
   * app/(dashboard)/wishlist/user/[userId]/page.tsx's `theirOccasion`).
   *
   * BOTH claim surfaces resolve this the same way -- the list card and the
   * item detail page each look for an occasion whose celebrantId is the
   * wishlist owner, inside the same 60-day window. They used to disagree: the
   * detail page passed null unconditionally, so claiming the same item from
   * the card produced a claim that auto-released and claiming it from the
   * detail page produced one that never would. Which button you happened to
   * press decided the semantics.
   *
   * `kind: null` now means what it says -- the owner has no birthday or
   * anniversary inside the window. claimItem() then claims UNSCOPED, which
   * never auto-releases: the honest behaviour when nobody can say what
   * occasion it is for. celebrantId is unused by claimItem() whenever kind is
   * null, but is still required, so callers pass the item's real owner.
   */
  celebrantId: string;
  kind: "birthday" | "anniversary" | null;
  /**
   * Label for the occasion an EXISTING claim (by someone else, or by the
   * current viewer) was made for -- e.g. "Mom's Birthday" -- resolved by the
   * caller via occasionLabel(), independently of `kind`/`celebrantId` above.
   * Null for an unscoped claim, or when no claim is active.
   */
  claimedOccasionLabel?: string | null;
  variant?: "card" | "detail";
  itemData?: WishlistItemData;
  /**
   * Called after any action that changes claim, purchase or stock state.
   *
   * router.refresh() is enough for a SERVER-rendered caller (the list page
   * re-renders and picks the new state up), but the item detail page is a
   * client component that loads through its own effect -- refresh() does not
   * re-run that effect, and its loadData("refresh") path additionally
   * short-circuits inside SIGNED_IMAGE_REFRESH_MS. So on that page the button
   * appeared to do nothing: the claim landed, the badge did not move.
   *
   * Optional: callers that render on the server need nothing here.
   */
  onChanged?: () => void;
}

export function ClaimActions({
  itemId,
  claimedBy,
  purchased,
  outOfStockMarkedBy,
  currentUserId,
  celebrantId,
  kind,
  claimedOccasionLabel = null,
  variant = "card",
  itemData,
  onChanged,
}: ClaimActionsProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isStockLoading, setIsStockLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Gift tracker state
  const [showGiftTracker, setShowGiftTracker] = useState(false);
  const [recipients, setRecipients] = useState<GiftRecipient[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<string>("");
  const [isAddingToTracker, setIsAddingToTracker] = useState(false);
  const [trackerSuccess, setTrackerSuccess] = useState(false);

  const isClaimedByMe = claimedBy === currentUserId;
  const isClaimedByOther = claimedBy && !isClaimedByMe;
  const isOutOfStock = !!outOfStockMarkedBy;

  // Fetch recipients when showing gift tracker option
  useEffect(() => {
    async function fetchRecipients() {
      if (showGiftTracker && recipients.length === 0) {
        const { data } = await getMyRecipients();
        if (data) {
          setRecipients(data);
        }
      }
    }
    fetchRecipients();
  }, [showGiftTracker, recipients.length]);

  const handleClaim = async () => {
    setIsLoading(true);
    setError(null);
    // The RPC's own error message is surfaced verbatim -- it is already
    // written for the person reading it ("somebody has already claimed
    // that item", "that item has already been purchased").
    const result = await claimItem(itemId, celebrantId, kind);
    if ("error" in result) {
      setError(result.error);
    } else {
      // Show gift tracker option after successful claim
      setShowGiftTracker(true);
    }
    setIsLoading(false);
    router.refresh();
    onChanged?.();
  };

  const handleAddToGiftTracker = async () => {
    if (!selectedRecipient || !itemData) return;

    setIsAddingToTracker(true);
    setError(null);

    const result = await createGift({
      recipient_id: selectedRecipient,
      name: itemData.title,
      description: itemData.description || undefined,
      product_link: itemData.url || undefined,
      price: itemData.price || undefined,
      photo_url: isExternalImageUrl(itemData.image_path)
        ? itemData.image_path
        : undefined,
      status: "planned", // Start as planned, user can update when ordered
      season_year: new Date().getFullYear(),
    });

    if (result.error) {
      setError(result.error);
    } else {
      setTrackerSuccess(true);
      setShowGiftTracker(false);
    }
    setIsAddingToTracker(false);
  };

  const handleUnclaim = async () => {
    setIsLoading(true);
    setError(null);
    const result = await releaseClaim(itemId);
    // { ok: false } (nothing of the caller's left to release) is not
    // exceptional -- see releaseClaim's own doc comment -- so only
    // `error` surfaces here.
    if ("error" in result) {
      setError(result.error);
    }
    setIsLoading(false);
    router.refresh();
    onChanged?.();
  };

  const handleMarkPurchased = async () => {
    setIsLoading(true);
    setError(null);
    const result = await markAsPurchased(itemId, !purchased);
    if (result.error) {
      setError(result.error);
    }
    setIsLoading(false);
    router.refresh();
    onChanged?.();
  };

  const handleToggleOutOfStock = async () => {
    setIsStockLoading(true);
    setError(null);
    const result = isOutOfStock
      ? await unmarkOutOfStock(itemId)
      : await markOutOfStock(itemId);
    if (result.error) {
      setError(result.error);
    }
    setIsStockLoading(false);
    router.refresh();
    onChanged?.();
  };

  // Compact variant for card view
  if (variant === "card") {
    return (
      <div
        className="flex items-center gap-2 flex-wrap"
        onClick={(e) => e.preventDefault()}
      >
        {error && (
          <Text size="sm" className="text-error w-full">
            {error}
          </Text>
        )}

        {!claimedBy && (
          <>
            <Button
              variant="secondary"
              size="small"
              onClick={handleClaim}
              loading={isLoading}
            >
              <Gift className="w-4 h-4" />
              I&apos;ll get this
            </Button>
            <Button
              variant={isOutOfStock ? "tertiary" : "secondary"}
              size="small"
              onClick={handleToggleOutOfStock}
              loading={isStockLoading}
            >
              <AlertTriangle className="w-4 h-4" />
              {isOutOfStock ? "Back in Stock" : "Out of Stock"}
            </Button>
          </>
        )}

        {isClaimedByMe && !purchased && (
          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="success"
                size="small"
                onClick={handleMarkPurchased}
                loading={isLoading}
              >
                <ShoppingBag className="w-4 h-4" />
                Mark Purchased
              </Button>
              <Button
                variant="tertiary"
                size="small"
                onClick={handleUnclaim}
                loading={isLoading}
              >
                <X className="w-4 h-4" />
                Unclaim
              </Button>
              {itemData && !trackerSuccess && !showGiftTracker && (
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setShowGiftTracker(true)}
                >
                  <ClipboardList className="w-4 h-4" />
                  Add to Gift Tracker
                </Button>
              )}
              {trackerSuccess && (
                <GiftTrackerSuccess
                  photoDropped={itemData?.image_is_private_upload}
                />
              )}
            </div>

            {/* Gift Tracker Recipient Selection */}
            {showGiftTracker && itemData && (
              <div className="flex items-center gap-2 pt-2 border-t border-light-border">
                <ClipboardList className="w-4 h-4 text-light-text-secondary" />
                <Select
                  value={selectedRecipient}
                  onValueChange={setSelectedRecipient}
                >
                  <SelectTrigger className="w-40 h-8 text-sm">
                    <SelectValue placeholder="Select recipient" />
                  </SelectTrigger>
                  <SelectContent>
                    {recipients.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="primary"
                  size="small"
                  onClick={handleAddToGiftTracker}
                  loading={isAddingToTracker}
                  disabled={!selectedRecipient}
                >
                  <Plus className="w-4 h-4" />
                  Add
                </Button>
                <Button
                  variant="tertiary"
                  size="small"
                  onClick={() => setShowGiftTracker(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {isClaimedByMe && purchased && (
          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-sm text-success">
                <Check className="w-4 h-4" />
                <span>You purchased this</span>
              </div>
              <Button
                variant="tertiary"
                size="small"
                onClick={handleMarkPurchased}
                loading={isLoading}
              >
                Undo
              </Button>
              <Button
                variant="tertiary"
                size="small"
                onClick={handleUnclaim}
                loading={isLoading}
              >
                <X className="w-4 h-4" />
                Unclaim
              </Button>
              {itemData && !trackerSuccess && !showGiftTracker && (
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setShowGiftTracker(true)}
                >
                  <ClipboardList className="w-4 h-4" />
                  Add to Gift Tracker
                </Button>
              )}
              {trackerSuccess && (
                <GiftTrackerSuccess
                  photoDropped={itemData?.image_is_private_upload}
                />
              )}
            </div>

            {/* Gift Tracker Recipient Selection */}
            {showGiftTracker && itemData && (
              <div className="flex items-center gap-2 pt-2 border-t border-light-border">
                <ClipboardList className="w-4 h-4 text-light-text-secondary" />
                <Select
                  value={selectedRecipient}
                  onValueChange={setSelectedRecipient}
                >
                  <SelectTrigger className="w-40 h-8 text-sm">
                    <SelectValue placeholder="Select recipient" />
                  </SelectTrigger>
                  <SelectContent>
                    {recipients.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="primary"
                  size="small"
                  onClick={handleAddToGiftTracker}
                  loading={isAddingToTracker}
                  disabled={!selectedRecipient}
                >
                  <Plus className="w-4 h-4" />
                  Add
                </Button>
                <Button
                  variant="tertiary"
                  size="small"
                  onClick={() => setShowGiftTracker(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {isClaimedByOther && (
          <div className="flex items-center gap-1.5 text-sm text-light-text-secondary">
            <Gift className="w-4 h-4" />
            <span>
              {purchased
                ? "Purchased"
                : claimedOccasionLabel
                ? `Claimed for ${claimedOccasionLabel}`
                : "Claimed"}
            </span>
          </div>
        )}
      </div>
    );
  }

  // Full variant for detail page
  return (
    <div className="p-4 rounded-lg border border-light-border space-y-3">
      <div className="flex items-center gap-2">
        <Gift className="w-5 h-5" />
        <Text className="font-medium">Gift Status</Text>
      </div>

      {error && (
        <Text size="sm" className="text-error">
          {error}
        </Text>
      )}

      {!claimedBy && (
        <div className="space-y-2">
          <Text variant="secondary" size="sm">
            This item hasn&apos;t been claimed yet. Claim it to let others know
            you&apos;re getting it!
          </Text>
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" onClick={handleClaim} loading={isLoading}>
              <Gift className="w-4 h-4" />
              I&apos;ll Get This Gift
            </Button>
            <Button
              variant={isOutOfStock ? "tertiary" : "secondary"}
              onClick={handleToggleOutOfStock}
              loading={isStockLoading}
            >
              <AlertTriangle className="w-4 h-4" />
              {isOutOfStock ? "Mark Back in Stock" : "Mark Out of Stock"}
            </Button>
          </div>
        </div>
      )}

      {isClaimedByMe && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-success" />
            <Text size="sm">
              {purchased
                ? "You purchased this item"
                : "You claimed this item"}
            </Text>
          </div>

          <div className="flex gap-2 flex-wrap">
            {!purchased ? (
              <Button
                variant="success"
                onClick={handleMarkPurchased}
                loading={isLoading}
              >
                <ShoppingBag className="w-4 h-4" />
                Mark as Purchased
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={handleMarkPurchased}
                loading={isLoading}
              >
                Mark as Not Purchased
              </Button>
            )}

            <Button
              variant="tertiary"
              onClick={handleUnclaim}
              loading={isLoading}
            >
              Unclaim
            </Button>
          </div>

          {/* Gift Tracker Option */}
          {itemData && !trackerSuccess && !showGiftTracker && (
            <div className="pt-3 border-t border-light-border">
              <Button
                variant="secondary"
                onClick={() => setShowGiftTracker(true)}
              >
                <ClipboardList className="w-4 h-4" />
                Add to Gift Tracker
              </Button>
            </div>
          )}

          {trackerSuccess && (
            <GiftTrackerSuccess
              photoDropped={itemData?.image_is_private_upload}
              standalone
            />
          )}

          {/* Gift Tracker Recipient Selection */}
          {showGiftTracker && itemData && (
            <div className="pt-3 border-t border-light-border space-y-2">
              <Text size="sm" variant="secondary">
                Select a recipient to track this gift:
              </Text>
              <div className="flex items-center gap-2">
                <Select
                  value={selectedRecipient}
                  onValueChange={setSelectedRecipient}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Select recipient" />
                  </SelectTrigger>
                  <SelectContent>
                    {recipients.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="primary"
                  onClick={handleAddToGiftTracker}
                  loading={isAddingToTracker}
                  disabled={!selectedRecipient}
                >
                  <Plus className="w-4 h-4" />
                  Add
                </Button>
                <Button
                  variant="tertiary"
                  onClick={() => setShowGiftTracker(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {isClaimedByOther && (
        <div className="flex items-center gap-3">
          <Gift className="w-5 h-5 text-light-text-secondary" />
          <div>
            <Text size="sm" className="font-medium">
              {claimedOccasionLabel
                ? `Claimed for ${claimedOccasionLabel}`
                : "Claimed"}
            </Text>
            <Text variant="secondary" size="sm">
              {purchased
                ? "has been purchased"
                : "someone else is getting this gift"}
            </Text>
          </div>
        </div>
      )}
    </div>
  );
}
