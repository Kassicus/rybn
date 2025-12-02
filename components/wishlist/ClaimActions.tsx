"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  claimWishlistItem,
  unclaimWishlistItem,
  markAsPurchased,
} from "@/lib/actions/wishlist";
import { getMyRecipients } from "@/lib/actions/gift-tracking";
import { createGift } from "@/lib/actions/gift-tracking";
import { Gift, Check, X, ShoppingBag, ClipboardList, Plus } from "lucide-react";

interface ClaimerInfo {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

interface WishlistItemData {
  title: string;
  description?: string | null;
  url?: string | null;
  price?: number | null;
  image_url?: string | null;
}

interface GiftRecipient {
  id: string;
  name: string;
}

interface ClaimActionsProps {
  itemId: string;
  claimedBy: string | null;
  purchased: boolean;
  currentUserId: string;
  claimerInfo?: ClaimerInfo | null;
  variant?: "card" | "detail";
  itemData?: WishlistItemData;
}

export function ClaimActions({
  itemId,
  claimedBy,
  purchased,
  currentUserId,
  claimerInfo,
  variant = "card",
  itemData,
}: ClaimActionsProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Gift tracker state
  const [showGiftTracker, setShowGiftTracker] = useState(false);
  const [recipients, setRecipients] = useState<GiftRecipient[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<string>("");
  const [isAddingToTracker, setIsAddingToTracker] = useState(false);
  const [trackerSuccess, setTrackerSuccess] = useState(false);

  const isClaimedByMe = claimedBy === currentUserId;
  const isClaimedByOther = claimedBy && !isClaimedByMe;

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
    const result = await claimWishlistItem(itemId);
    if (result.error) {
      setError(result.error);
    } else {
      // Show gift tracker option after successful claim
      setShowGiftTracker(true);
    }
    setIsLoading(false);
    router.refresh();
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
      photo_url: itemData.image_url || undefined,
      status: "ordered", // Since they claimed it, assume they'll order it
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
    const result = await unclaimWishlistItem(itemId);
    if (result.error) {
      setError(result.error);
    }
    setIsLoading(false);
    router.refresh();
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
  };

  const getClaimerDisplayName = () => {
    if (!claimerInfo) return "Someone";
    return claimerInfo.display_name || claimerInfo.username || "Someone";
  };

  const getClaimerInitial = () => {
    const name = getClaimerDisplayName();
    return name.charAt(0).toUpperCase();
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
          <Button
            variant="secondary"
            size="small"
            onClick={handleClaim}
            loading={isLoading}
          >
            <Gift className="w-4 h-4" />
            I'll get this
          </Button>
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
                <div className="flex items-center gap-1.5 text-sm text-success">
                  <Check className="w-4 h-4" />
                  <span>Added to Gift Tracker</span>
                </div>
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
                <div className="flex items-center gap-1.5 text-sm text-success">
                  <Check className="w-4 h-4" />
                  <span>Added to Gift Tracker</span>
                </div>
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
            <Avatar className="w-5 h-5">
              {claimerInfo?.avatar_url && (
                <AvatarImage src={claimerInfo.avatar_url} />
              )}
              <AvatarFallback className="text-xs">
                {getClaimerInitial()}
              </AvatarFallback>
            </Avatar>
            <span>
              {getClaimerDisplayName()}{" "}
              {purchased ? "purchased this" : "is getting this"}
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
            This item hasn't been claimed yet. Claim it to let others know
            you're getting it!
          </Text>
          <Button variant="primary" onClick={handleClaim} loading={isLoading}>
            <Gift className="w-4 h-4" />
            I'll Get This Gift
          </Button>
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
            <div className="flex items-center gap-2 pt-3 border-t border-light-border text-success">
              <Check className="w-4 h-4" />
              <Text size="sm">Added to Gift Tracker</Text>
            </div>
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
          <Avatar className="w-8 h-8">
            {claimerInfo?.avatar_url && (
              <AvatarImage src={claimerInfo.avatar_url} />
            )}
            <AvatarFallback>{getClaimerInitial()}</AvatarFallback>
          </Avatar>
          <div>
            <Text size="sm" className="font-medium">
              {getClaimerDisplayName()}
            </Text>
            <Text variant="secondary" size="sm">
              {purchased ? "has purchased this item" : "is getting this gift"}
            </Text>
          </div>
        </div>
      )}
    </div>
  );
}
