"use client";

import Link from "next/link";
import { SearchResult } from "@/lib/search/searchEngine";
import {
  User,
  Users,
  Gift,
  CalendarDays,
  Heart,
  ChevronRight,
  Package,
  UserCircle
} from "lucide-react";
import { format } from "date-fns";

interface SearchResultItemProps {
  result: SearchResult;
  onClick?: () => void;
}

export function SearchResultItem({ result, onClick }: SearchResultItemProps) {
  // Get icon based on result type
  const getIcon = () => {
    switch (result.type) {
      case "person":
        return <User className="h-4 w-4 text-light-text-secondary" />;
      case "group":
        return <Users className="h-4 w-4 text-light-text-secondary" />;
      case "gift":
        return <Gift className="h-4 w-4 text-light-text-secondary" />;
      case "exchange":
        return <CalendarDays className="h-4 w-4 text-light-text-secondary" />;
      case "wishlist":
        return <Heart className="h-4 w-4 text-light-text-secondary" />;
      case "tracked_gift":
        return <Package className="h-4 w-4 text-light-text-secondary" />;
      case "recipient":
        return <UserCircle className="h-4 w-4 text-purple-500" />;
      default:
        return null;
    }
  };

  // Get metadata display based on result type
  const getMetadataDisplay = () => {
    if (!result.metadata) return null;

    switch (result.type) {
      case "person":
        return (
          <span className="text-xs text-light-text-tertiary">
            {result.metadata.shared_groups} shared group{result.metadata.shared_groups !== 1 ? 's' : ''}
          </span>
        );
      case "group":
        return (
          <span className="text-xs text-light-text-tertiary capitalize">
            {result.metadata.type}
          </span>
        );
      case "wishlist":
        return result.metadata.price ? (
          <span className="text-xs font-medium text-success">
            ${parseFloat(result.metadata.price).toFixed(2)}
          </span>
        ) : null;
      case "gift":
        return (
          <div className="flex items-center gap-2 text-xs text-light-text-tertiary">
            {result.metadata.target_amount && (
              <span className="font-medium text-success">
                ${parseFloat(result.metadata.target_amount).toFixed(2)}
              </span>
            )}
            {result.metadata.group && (
              <span className="text-light-text-tertiary">• {result.metadata.group}</span>
            )}
          </div>
        );
      case "exchange":
        return (
          <div className="flex items-center gap-2 text-xs">
            {result.metadata.exchange_date && (
              <span className="text-light-text-tertiary">
                {format(new Date(result.metadata.exchange_date), "MMM d, yyyy")}
              </span>
            )}
            {result.metadata.days_until !== undefined && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 font-medium">
                {result.metadata.days_until} day{result.metadata.days_until !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        );
      case "tracked_gift":
        return (
          <div className="flex items-center gap-2 text-xs">
            {result.metadata.recipient_name && (
              <span className="text-light-text-tertiary">
                For: {result.metadata.recipient_name}
              </span>
            )}
            {result.metadata.status && (
              <span className="px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium capitalize">
                {result.metadata.status}
              </span>
            )}
            {result.metadata.price && (
              <span className="font-medium text-success">
                ${parseFloat(result.metadata.price).toFixed(2)}
              </span>
            )}
          </div>
        );
      case "recipient":
        return (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
              Gift Tracker
            </span>
            {result.metadata.gift_count !== undefined && (
              <span className="text-light-text-tertiary">
                {result.metadata.gift_count} gift{result.metadata.gift_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Link
      href={result.url}
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2 hover:bg-light-background-hover rounded-md transition-colors group"
    >
      {/* Icon */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-light-background-secondary flex items-center justify-center">
        {getIcon()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-light-text-primary truncate">{result.title}</p>
        </div>
        {result.description && (
          <p className="text-xs text-light-text-secondary truncate">
            {result.description}
          </p>
        )}
        {getMetadataDisplay()}
      </div>

      {/* Chevron */}
      <ChevronRight className="h-4 w-4 text-light-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </Link>
  );
}
