"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Heading, Text } from "@/components/ui/text";
import { updateGroupDate, deleteGroupDate } from "@/lib/actions/occasions";

interface GroupDateActionsProps {
  occasionId: string;
  name: string;
  occasionDate: string;
}

/**
 * Edit/delete for a single group-date row on the group page's occasions
 * list -- the sibling of NewGroupDateButton.tsx's create affordance, built
 * to the same conventions: a hand-rolled modal (this app has no shared
 * Dialog primitive yet), router.refresh() after a successful write because
 * revalidatePath() alone does not repaint an already-rendered client tree,
 * and the action's OWN error string rendered verbatim rather than a
 * component-authored one.
 *
 * Deliberately does NO authorization check of its own -- not "is this mine
 * to edit," not "am I this group's admin." updateGroupDate/deleteGroupDate
 * are backed by RLS policies that already require kind = 'group_date' AND
 * membership of the group AND (creator OR group admin); this component only
 * ever offers the affordance and lets whatever the action returns --
 * success, or the shared "no longer exists, or is not yours" wording --
 * speak for itself. Computing eligibility here would duplicate a policy
 * this component cannot see and could drift from.
 *
 * Only ever rendered by UpcomingOccasions for kind === "group_date": a
 * derived birthday/anniversary has occasionId: null and no row to edit.
 */
export function GroupDateActions({
  occasionId,
  name,
  occasionDate,
}: GroupDateActionsProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"closed" | "edit" | "delete">("closed");
  const [editName, setEditName] = useState(name);
  const [editDate, setEditDate] = useState(occasionDate);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seeds the form from the CURRENT props at the moment the edit modal is
  // opened, not from a value captured once at mount -- so a save made,
  // closed, and reopened always starts from what is actually on screen.
  const openEdit = () => {
    setEditName(name);
    setEditDate(occasionDate);
    setError(null);
    setMode("edit");
  };

  const openDelete = () => {
    setError(null);
    setMode("delete");
  };

  const close = () => {
    setMode("closed");
    setError(null);
  };

  const handleSave = async () => {
    if (!editName.trim()) {
      setError("Give this occasion a name");
      return;
    }
    if (!editDate) {
      setError("Pick a date");
      return;
    }

    setIsLoading(true);
    setError(null);

    const result = await updateGroupDate(occasionId, {
      name: editName,
      occasionDate: editDate,
    });

    setIsLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    close();
    router.refresh();
  };

  const handleDelete = async () => {
    setIsLoading(true);
    setError(null);

    const result = await deleteGroupDate(occasionId);

    setIsLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    close();
    router.refresh();
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={openEdit}
        className="rounded p-1.5 text-light-text-secondary hover:bg-light-background-hover hover:text-light-text-primary"
        aria-label={`Edit ${name}`}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        onClick={openDelete}
        className="rounded p-1.5 text-light-text-secondary hover:bg-light-background-hover hover:text-error"
        aria-label={`Delete ${name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>

      {mode === "edit" && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/50" onClick={close} />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md space-y-4 rounded-lg border border-light-border bg-light-background p-6">
              <div className="flex items-start justify-between">
                <div>
                  <Heading level="h3">Edit occasion</Heading>
                  <Text variant="secondary" size="sm">
                    Every member of this group will see the change
                  </Text>
                </div>
                <button
                  onClick={close}
                  className="text-light-text-secondary hover:text-light-text-primary"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {error && (
                <div className="rounded border border-error bg-error-light p-3">
                  <Text variant="error" size="sm">
                    {error}
                  </Text>
                </div>
              )}

              <div>
                <Label htmlFor="edit-occasion-name">Name</Label>
                <Input
                  id="edit-occasion-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                  }}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="edit-occasion-date">Date</Label>
                <Input
                  id="edit-occasion-date"
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div className="flex gap-3">
                <Button variant="secondary" onClick={close} className="flex-1">
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={isLoading}
                  className="flex-1"
                >
                  Save changes
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {mode === "delete" && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/50" onClick={close} />

          {/* Modal -- a plain confirm, not a typed-name confirmation like
              DeleteGroupButton's: deleting one occasion off a group's
              calendar is a lighter-weight, easily recreated action, unlike
              deleting the whole group. */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md space-y-4 rounded-lg border border-light-border bg-light-background p-6">
              <div className="flex items-start justify-between">
                <Heading level="h3">Delete occasion?</Heading>
                <button
                  onClick={close}
                  className="text-light-text-secondary hover:text-light-text-primary"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <Text variant="secondary" size="sm">
                This removes <strong>{name}</strong> for every member of this
                group. This cannot be undone.
              </Text>

              {error && (
                <div className="rounded border border-error bg-error-light p-3">
                  <Text variant="error" size="sm">
                    {error}
                  </Text>
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="secondary" onClick={close} className="flex-1">
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  loading={isLoading}
                  className="flex-1"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
