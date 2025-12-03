"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, Bell, User, LogOut, Settings, Menu } from "lucide-react";
import { MobileDrawer } from "@/components/layout/MobileDrawer";
import { Logo } from "@/components/vibe/Logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SearchBar } from "@/components/search/SearchBar";
import { createClient } from "@/lib/supabase/client";

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
  const supabase = createClient();
  const [showSearch, setShowSearch] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    }

    if (showProfileMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showProfileMenu]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-light-border bg-light-background/95 backdrop-blur supports-[backdrop-filter]:bg-light-background/60">
      <div className="container flex h-16 items-center justify-between px-4 mx-auto max-w-screen-2xl">
        {/* Left: Hamburger + Logo */}
        <div className="flex items-center gap-2 md:gap-6">
          {/* Mobile hamburger menu */}
          <button
            onClick={() => setShowMobileNav(true)}
            className="md:hidden p-2 rounded-lg hover:bg-light-background-hover transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5 text-light-text-secondary" />
          </button>

          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center transition-opacity hover:opacity-80"
          >
            <Logo width={150} height={60} className="h-10 w-auto" />
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

          {/* Profile Avatar with Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
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

            {/* Dropdown Menu */}
            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-light-border bg-white shadow-lg overflow-hidden">
                {/* User Info */}
                <div className="px-4 py-3 border-b border-light-border">
                  <p className="text-sm font-medium text-light-text-primary truncate">
                    {profile?.display_name || profile?.username || "User"}
                  </p>
                  <p className="text-xs text-light-text-secondary truncate">
                    {user.email}
                  </p>
                </div>

                {/* Menu Items */}
                <div className="py-1">
                  <button
                    onClick={() => {
                      router.push("/profile");
                      setShowProfileMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-light-text-primary hover:bg-light-background transition-colors"
                  >
                    <User className="w-4 h-4" />
                    Profile
                  </button>
                  <button
                    onClick={() => {
                      router.push("/settings");
                      setShowProfileMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-light-text-primary hover:bg-light-background transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </button>
                </div>

                {/* Logout */}
                <div className="border-t border-light-border">
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-error hover:bg-error-light transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile search bar */}
      {showSearch && (
        <div className="md:hidden px-4 pb-4">
          <SearchBar placeholder="Search wishlists, groups, gifts, people..." />
        </div>
      )}

      {/* Mobile navigation drawer */}
      <MobileDrawer
        isOpen={showMobileNav}
        onClose={() => setShowMobileNav(false)}
        user={user}
        profile={profile}
      />
    </header>
  );
}
