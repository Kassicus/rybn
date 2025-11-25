"use client";

import { ExternalLink, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Text } from "@/components/ui/text";
import Link from "next/link";
import { GiftStatusBadge } from "./GiftStatusBadge";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { deleteGift, updateGiftStatus } from "@/lib/actions/gift-tracking";
import { giftStatuses, STATUS_INFO, type GiftStatus } from "@/lib/schemas/gift-tracking";

interface TrackedGift {
  id: string;
  recipient_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  product_link: string | null;
  price: number | null;
  status: GiftStatus;
  occasion: string | null;
  gift_recipients?: {
    id: string;
    name: string;
  } | null;
}

interface GiftCardProps {
  gift: TrackedGift;
  showRecipient?: boolean;
  onStatusChange?: () => void;
  onDelete?: () => void;
}

export function GiftCard({
  gift,
  showRecipient = false,
  onStatusChange,
  onDelete,
}: GiftCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const statusBadgeRef = useRef<HTMLDivElement>(null);

  // Calculate dropdown position when it opens
  useEffect(() => {
    if (showStatusDropdown && statusBadgeRef.current) {
      const rect = statusBadgeRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
  }, [showStatusDropdown]);

  const handleStatusChange = async (newStatus: GiftStatus) => {
    setShowStatusDropdown(false);
    await updateGiftStatus(gift.id, newStatus);
    onStatusChange?.();
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this gift?")) return;
    setIsDeleting(true);
    await deleteGift(gift.id);
    onDelete?.();
  };

  return (
    <div className={`relative p-4 rounded-lg border border-light-border hover:border-primary transition-colors bg-white ${isDeleting ? "opacity-50" : ""}`}>
      <div className="flex gap-4">
        {/* Image */}
        {gift.photo_url ? (
          <div className="w-20 h-20 flex-shrink-0 rounded-md overflow-hidden bg-gray-100">
            <img
              src={gift.photo_url}
              alt={gift.name}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="w-20 h-20 flex-shrink-0 rounded-md bg-gray-100 flex items-center justify-center">
            <Text variant="secondary" size="sm">No image</Text>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <Link href={`/gift-tracker/${gift.recipient_id}/${gift.id}`}>
                <Text className="font-semibold text-lg truncate hover:text-primary transition-colors">
                  {gift.name}
                </Text>
              </Link>
              {showRecipient && gift.gift_recipients && (
                <Text size="sm" variant="secondary" className="mt-0.5">
                  For: {gift.gift_recipients.name}
                </Text>
              )}
            </div>

            {/* Menu Button */}
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-1 rounded hover:bg-light-background-hover transition-colors"
              >
                <MoreHorizontal className="w-5 h-5 text-gray-400" />
              </button>

              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowMenu(false)}
                  />
                  <div className="absolute right-0 top-8 z-20 bg-white border border-light-border rounded-lg shadow-lg py-1 min-w-[120px]">
                    <Link
                      href={`/gift-tracker/${gift.recipient_id}/${gift.id}`}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-light-background-hover transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                      <Text size="sm">Edit</Text>
                    </Link>
                    <button
                      onClick={handleDelete}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-error-light transition-colors text-error"
                    >
                      <Trash2 className="w-4 h-4" />
                      <Text size="sm" variant="error">Delete</Text>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {gift.description && (
            <Text variant="secondary" size="sm" className="line-clamp-1 mt-1">
              {gift.description}
            </Text>
          )}

          <div className="flex items-center gap-3 flex-wrap mt-2">
            {/* Status with dropdown */}
            <div ref={statusBadgeRef}>
              <GiftStatusBadge
                status={gift.status}
                size="sm"
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              />
              {showStatusDropdown && typeof document !== "undefined" && createPortal(
                <>
                  <div
                    className="fixed inset-0 z-50"
                    onClick={() => setShowStatusDropdown(false)}
                  />
                  <div
                    className="fixed z-50 bg-white border border-light-border rounded-lg shadow-lg py-1 min-w-[140px]"
                    style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
                  >
                    {giftStatuses.map((status) => (
                      <button
                        key={status}
                        onClick={() => handleStatusChange(status)}
                        className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-light-background-hover transition-colors ${
                          status === gift.status ? "bg-light-background-hover" : ""
                        }`}
                      >
                        <Text size="sm">{STATUS_INFO[status].label}</Text>
                      </button>
                    ))}
                  </div>
                </>,
                document.body
              )}
            </div>

            {/* Price */}
            {gift.price && (
              <Text size="sm" className="font-medium">
                ${gift.price.toFixed(2)}
              </Text>
            )}

            {/* Occasion */}
            {gift.occasion && (
              <span className="px-2 py-0.5 rounded text-xs bg-light-background-hover">
                {gift.occasion}
              </span>
            )}

            {/* External Link */}
            {gift.product_link && (
              <a
                href={gift.product_link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-gray-400 hover:text-primary transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
