import { TopBar } from "@/components/layout/TopBar";
import { FloatingActionButton } from "@/components/layout/FloatingActionButton";
import { DateReminderBanner } from "@/components/reminders/DateReminderBanner";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getActiveDateReminders } from "@/lib/actions/date-reminders";
import { getMyProfile } from "@/lib/actions/profile";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get active date reminders for the user
  const { data: reminders } = await getActiveDateReminders();

  // Get user profile for TopBar
  const { data: profile } = await getMyProfile();

  return (
    <div className="min-h-screen flex flex-col bg-light-background">
      <TopBar user={user} profile={profile} />
      <main className="flex-1 px-4 py-6 md:px-8 md:py-8 container mx-auto max-w-screen-2xl">
        {reminders && reminders.length > 0 && (
          <div className="mb-6">
            <DateReminderBanner reminders={reminders} />
          </div>
        )}
        {children}
      </main>
      <FloatingActionButton />
    </div>
  );
}
