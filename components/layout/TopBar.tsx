"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Bell } from "lucide-react";
import { Logo } from "@/components/vibe/Logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SearchBar } from "@/components/search/SearchBar";

interface TopBarProps {
  user: {
    email?: string;
  };
  profile?: {
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
}

export function TopBar({ user, profile }: TopBarProps) {
  const router = useRouter();
  const [showSearch, setShowSearch] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-light-border bg-light-background/95 backdrop-blur supports-[backdrop-filter]:bg-light-background/60">
      <div className="container flex h-16 items-center justify-between px-4 mx-auto max-w-screen-2xl">
        {/* Left: Logo */}
        <div className="flex items-center gap-6">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center transition-opacity hover:opacity-80"
          >
            <Logo width={120} height={48} className="h-8 w-auto" />
          </button>
        </div>

        {/* Center: Search */}
        <div className="flex-1 max-w-md mx-8 hidden md:block">
          <SearchBar placeholder="Search wishlists, groups, gifts, people..." />
        </div>

        {/* Right: Actions & Profile */}
        <div className="flex items-center gap-3">
          {/* Mobile search toggle */}
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="md:hidden p-2 rounded-lg hover:bg-light-background-hover transition-colors"
          >
            <Search className="w-5 h-5 text-light-text-secondary" />
          </button>

          {/* Notifications */}
          <button
            onClick={() => router.push("/notifications")}
            className="relative p-2 rounded-lg hover:bg-light-background-hover transition-colors"
          >
            <Bell className="w-5 h-5 text-light-text-secondary" />
            {/* Notification badge */}
            <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
          </button>

          {/* Profile Avatar */}
          <button
            onClick={() => router.push("/profile")}
            className="flex items-center gap-2 p-1 rounded-lg hover:bg-light-background-hover transition-colors"
          >
            <Avatar className="h-8 w-8">
              {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
              <AvatarFallback>
                {profile?.display_name?.charAt(0).toUpperCase() ||
                 profile?.username?.charAt(0).toUpperCase() ||
                 user.email?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </button>
        </div>
      </div>

      {/* Mobile search bar */}
      {showSearch && (
        <div className="md:hidden px-4 pb-4">
          <SearchBar placeholder="Search wishlists, groups, gifts, people..." />
        </div>
      )}
    </header>
  );
}
