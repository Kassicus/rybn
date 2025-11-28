import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { RecipientForm } from "@/components/gift-tracking";

export default async function AddRecipientPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Gift Tracker", href: "/gift-tracker" },
          { label: "Add Recipient", href: "/gift-tracker/add-recipient" },
        ]}
      />
      <div className="mb-6">
        <Heading level="h1">Add Recipient</Heading>
        <Text variant="secondary">
          Add someone you&apos;re planning to buy gifts for
        </Text>
      </div>

      <div className="bg-white rounded-lg border border-light-border p-6">
        <RecipientForm />
      </div>
    </div>
  );
}
