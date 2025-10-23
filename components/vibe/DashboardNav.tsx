"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Home, Users, Gift, ListChecks, Calendar, User as UserIcon, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "./ThemeToggle";
import { getMyProfile } from "@/lib/actions/profile";
import type { User } from "@supabase/supabase-js";

interface DashboardNavProps {
  user: User;
}

interface UserProfile {
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

export function DashboardNav({ user }: DashboardNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // Load user profile
  useEffect(() => {
    const loadProfile = async () => {
      const { data } = await getMyProfile();
      if (data) {
        setProfile({
          username: data.username,
          display_name: data.display_name,
          avatar_url: data.avatar_url,
        });
      }
    };
    loadProfile();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: Home },
    { href: "/groups", label: "Groups", icon: Users },
    { href: "/wishlist", label: "Wishlist", icon: ListChecks },
    { href: "/gifts", label: "Gifts", icon: Gift },
    { href: "/secret-santa", label: "Secret Santa", icon: Calendar },
  ];

  return (
    <aside className="w-64 border-r border-light-border dark:border-dark-border flex flex-col p-4 bg-light-background dark:bg-dark-background">
      <div className="mb-8">
        <Heading level="h3">Rybn</Heading>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.href}
              onClick={() => router.push(item.href)}
              variant={pathname.startsWith(item.href) ? "primary" : "tertiary"}
              size="medium"
              className="w-full justify-start"
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Button>
          );
        })}
      </nav>

      <Separator className="my-4" />

      <div className="space-y-2">
        <div className="flex gap-2 items-center px-2">
          <Avatar>
            {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
            <AvatarFallback>
              {profile?.display_name?.charAt(0).toUpperCase() ||
               profile?.username?.charAt(0).toUpperCase() ||
               user.email?.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-light-text-primary dark:text-dark-text-primary">
              {profile?.display_name || profile?.username || user.email}
            </p>
          </div>
          <ThemeToggle />
        </div>

        <Button
          onClick={() => router.push("/profile")}
          variant="tertiary"
          size="small"
          className="w-full justify-start"
        >
          <UserIcon className="w-4 h-4" />
          Profile
        </Button>

        <Button
          onClick={handleSignOut}
          variant="tertiary"
          size="small"
          className="w-full justify-start"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
