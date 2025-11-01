"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sign up a user from an invitation link
 * Auto-confirms their email since they received the invitation via email
 */
export async function signupFromInvitation(data: {
  email: string;
  password: string;
  username: string;
}): Promise<
  | { error: string; success?: never; user?: never; session?: never }
  | { success: true; user: any; session: any; error?: never }
> {
  try {
    const adminClient = createAdminClient();

    // Create the user with auto-confirm
    const { data: signupData, error: signupError } = await adminClient.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true, // Auto-confirm the email
      user_metadata: {
        username: data.username,
      },
    });

    if (signupError) {
      console.error("Signup error:", signupError);
      return { error: signupError.message };
    }

    if (!signupData.user) {
      return { error: "Failed to create user" };
    }

    console.log("User created and auto-confirmed:", signupData.user.id);

    // Now sign them in with the regular client to establish a session
    const supabase = await createClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (sessionError) {
      console.error("Session creation error:", sessionError);
      return { error: "Account created but failed to sign in. Please try logging in manually." };
    }

    console.log("Session created successfully");

    return {
      success: true,
      user: signupData.user,
      session: sessionData.session,
    };
  } catch (error) {
    console.error("Exception in signupFromInvitation:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}
