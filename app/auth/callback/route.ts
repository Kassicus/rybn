import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { sendWelcomeEmail } from "@/lib/resend/send";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Check if this is a new user or an existing user
      // OAuth users are auto-linked if email exists, so check creation time
      const isNewUser = data.session?.user?.created_at === data.session?.user?.last_sign_in_at;

      // Detect OAuth provider
      const provider = data.user.app_metadata?.provider;
      const isOAuthUser = provider && provider !== 'email';

      // Get user profile to check if username is set
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('username')
        .eq('id', data.user.id)
        .single();

      // Determine redirect path
      let redirectPath = next;

      // If OAuth user without username, redirect to username setup
      if (isOAuthUser && !profile?.username) {
        redirectPath = '/set-username';
      }

      // Send welcome email only for NEW users (not auto-linked ones)
      if (isNewUser) {
        try {
          const username = profile?.username ||
                          data.user.user_metadata?.username ||
                          data.user.email?.split('@')[0] ||
                          'there';
          await sendWelcomeEmail(data.user.email!, username);
        } catch (emailError) {
          console.error('Failed to send welcome email:', emailError);
          // Don't fail the auth flow if email fails
        }
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${redirectPath}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${redirectPath}`);
      } else {
        return NextResponse.redirect(`${origin}${redirectPath}`);
      }
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
