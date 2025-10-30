import { DashboardNav } from "@/components/vibe/DashboardNav";
import { DateReminderBanner } from "@/components/reminders/DateReminderBanner";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getActiveDateReminders } from "@/lib/actions/date-reminders";

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

  return (
    <div className="min-h-screen flex">
      <DashboardNav user={user} />
      <main className="flex-1 p-8">
        {reminders && reminders.length > 0 && (
          <div className="mb-6">
            <DateReminderBanner reminders={reminders} />
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
