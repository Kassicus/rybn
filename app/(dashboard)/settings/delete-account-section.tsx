"use client";

import { useId, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import { FormSection } from "@/components/profile/FormSection";
import { deleteAccount } from "@/lib/actions/account";
import { ACCOUNT_SENTENCES } from "@/lib/account/sentences";

const WHAT_IS_REMOVED =
  "Your profile, wishlist, pictures and gift tracker are removed, and your claims are released. Groups you own pass to the member who has been there longest. This can't be undone.";
const SIGN_IN_WITH_APPLE =
  "If you signed in with Apple, you can also remove Rybn under Sign in with Apple in your Apple Account settings.";
const QUESTION = "Delete your account? This can't be undone.";

/**
 * Settings' last section. It asks before anything is deleted, then runs
 * deleteAccount; once the account is gone it signs out to the front page. A
 * failure shows the action's sentence and the person stays signed in, and
 * trying again finishes what is left.
 */
export function DeleteAccountSection() {
  const { signOut } = useClerk();
  const questionId = useId();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set before the request and cleared only when it fails. A second click
  // that lands before the button renders disabled finds it set and sends
  // nothing.
  const deleting = useRef(false);

  const handleDelete = async () => {
    if (deleting.current) return;
    deleting.current = true;
    setIsDeleting(true);
    setError(null);

    let result: Awaited<ReturnType<typeof deleteAccount>>;
    try {
      result = await deleteAccount();
    } catch {
      // The request itself failed. Trying again is safe, as after any other failure.
      result = { error: ACCOUNT_SENTENCES.deleteFailed };
    }

    if ("error" in result) {
      setError(result.error);
      setIsDeleting(false);
      deleting.current = false;
      return;
    }

    await signOut({ redirectUrl: "/" });
  };

  return (
    <FormSection title="Delete account">
      <div className="space-y-2">
        <Text>{WHAT_IS_REMOVED}</Text>
        <Text variant="secondary" size="sm">
          {SIGN_IN_WITH_APPLE}
        </Text>
      </div>
      <Button type="button" variant="destructive" onClick={() => setShowConfirm(true)}>
        <Trash2 className="w-4 h-4" />
        Delete my account
      </Button>

      {showConfirm && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowConfirm(false)} />

          {/* Confirmation */}
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div
              role="dialog"
              aria-labelledby={questionId}
              className="bg-light-background rounded-lg border border-light-border max-w-md w-full p-6 space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-error-light flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-error" />
                </div>
                <Heading level="h4" id={questionId}>
                  {QUESTION}
                </Heading>
              </div>

              {error && (
                <div role="alert" className="p-3 rounded bg-error-light border border-error">
                  <Text variant="error" size="sm">
                    {error}
                  </Text>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowConfirm(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  loading={isDeleting}
                  disabled={isDeleting}
                  className="flex-1"
                >
                  Delete account
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </FormSection>
  );
}
