"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import {
  updateInstructorNote,
  type InstructorNoteState,
} from "@/app/flights/[id]/instructor-note-actions";
import type { InstructorNoteView } from "@/lib/ratings/notes";

const initial: InstructorNoteState = {};

/**
 * Private instructor notes on a flight — never resolved through the general
 * friends/public visibility path, so `notes` here has already been scoped
 * server-side to what THIS viewer may read (owner: all; a note's own
 * author: at least theirs, forever). Only the flight's CURRENT instructor
 * gets an editable form; a former instructor's own note still shows, read
 * only.
 */
export function InstructorNoteCard({
  flightId,
  notes,
  viewerId,
  isViewerCurrentInstructor,
}: {
  flightId: string;
  notes: InstructorNoteView[];
  viewerId: string | null;
  isViewerCurrentInstructor: boolean;
}) {
  const action = updateInstructorNote.bind(null, flightId);
  const [state, formAction, pending] = useActionState(action, initial);

  if (notes.length === 0 && !isViewerCurrentInstructor) return null;

  const ownNote = viewerId ? notes.find((n) => n.authorId === viewerId) : undefined;
  const otherNotes = notes.filter((n) => n.id !== ownNote?.id);

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <h2 className="font-condensed text-lg font-bold text-ink">Instructor notes</h2>

        {otherNotes.map((note) => (
          <div key={note.id} className="flex flex-col gap-1 rounded-md border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
              <span>
                {note.authorDisplayName} (@{note.authorHandle})
              </span>
              {!note.isCurrentInstructor && <span>No longer the assigned instructor</span>}
            </div>
            <p className="text-sm whitespace-pre-wrap text-ink">{note.body}</p>
          </div>
        ))}

        {ownNote && !isViewerCurrentInstructor && (
          <div className="flex flex-col gap-1 rounded-md border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
              <span>Your note</span>
              <span>No longer the assigned instructor — read only</span>
            </div>
            <p className="text-sm whitespace-pre-wrap text-ink">{ownNote.body}</p>
          </div>
        )}

        {isViewerCurrentInstructor && (
          <form action={formAction} className="flex flex-col gap-3">
            <textarea
              name="body"
              defaultValue={ownNote?.body ?? ""}
              maxLength={2000}
              rows={4}
              placeholder="Private notes for this pilot — visible only to them and to you."
              className="resize-none rounded-md border border-gray-300 bg-paper px-3 py-2 text-ink outline-none focus:border-amber focus:ring-2 focus:ring-amber/40"
            />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : ownNote ? "Update note" : "Save note"}
              </Button>
              {state.ok && <span className="text-sm text-leaf-strong">Saved.</span>}
              {state.error && <span className="text-sm text-red-600">{state.error}</span>}
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
