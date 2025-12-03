"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X, Home, Users, Gift, ListChecks, Calendar, User, LogOut } from "lucide-react";
import { Logo } from "@/components/vibe/Logo";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    email?: string;
  };
  profile?: {
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/groups", label: "Groups", icon: Users },
  { href: "/wishlist", label: "Wishlist", icon: ListChecks },
  { href: "/gifts", label: "Group Gifts", icon: Gift },
  { href: "/gift-exchange", label: "Gift Exchange", icon: Calendar },
];

export function MobileDrawer({ isOpen, onClose, user, profile }: MobileDrawerProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Close drawer on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  const handleNavigation = (href: string) => {
    router.push(href);
    onClose();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className="fixed left-0 top-0 bottom-0 w-72 max-w-[80vw] bg-light-background border-r border-light-border z-50 flex flex-col transform transition-transform duration-300 ease-in-out"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-light-border">
          <Logo width={120} height={48} className="h-8 w-auto" />
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-light-background-hover transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5 text-light-text-secondary" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);
            return (
              <Button
                key={item.href}
                onClick={() => handleNavigation(item.href)}
                variant={isActive ? "primary" : "tertiary"}
                size="medium"
                className="w-full justify-start"
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Button>
            );
          })}
        </nav>

        <Separator />

        {/* User Section */}
        <div className="p-4 space-y-2">
          <div className="flex gap-2 items-center px-2 mb-2">
            <Avatar className="h-8 w-8">
              {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
              <AvatarFallback>
                {profile?.display_name?.charAt(0).toUpperCase() ||
                 profile?.username?.charAt(0).toUpperCase() ||
                 user.email?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-light-text-primary">
                {profile?.display_name || profile?.username || user.email}
              </p>
            </div>
          </div>

          <Button
            onClick={() => handleNavigation("/profile")}
            variant="tertiary"
            size="small"
            className="w-full justify-start"
          >
            <User className="w-4 h-4" />
            Profile
          </Button>

          <Button
            onClick={handleSignOut}
            variant="tertiary"
            size="small"
            className="w-full justify-start text-error"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </div>
      </div>
    </>
  );
}
