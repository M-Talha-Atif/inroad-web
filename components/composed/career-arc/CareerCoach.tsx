"use client";

import { useEffect, useRef, useState } from "react";

import { AssistPanel } from "@/components/composed/ai-assist/AssistPanel";
import { useAssistSession } from "@/components/composed/ai-assist/useAssistSession";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import type { AssistSession, CareerArcStory } from "@/lib/api-client/client";
import type { AssistDraft } from "@/lib/assist";
import { COACH_FIELDS, storyFromResult } from "@/lib/career-coach";

/** "Talk it through": a side panel where the coach asks about one piece of
 * work, one question at a time, and the answers become a drafted story. */
export function CareerCoach({
  open,
  onClose,
  draft,
  onDraftChange,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  draft: AssistDraft;
  onDraftChange: (update: (previous: AssistDraft) => AssistDraft) => void;
  onAdd: (seed: AssistSession["seed"] | null, story: CareerArcStory) => void;
}) {
  const session = useAssistSession({ recipe: "career_story", draft, onDraftChange });
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState("");
  const [starting, setStarting] = useState(false);
  const tried = useRef(false);
  const { resume } = session;

  useEffect(() => {
    if (!open) {
      tried.current = false;
      return;
    }
    if (!tried.current && session.phase === "idle") {
      tried.current = true;
      void resume();
    }
  }, [open, session.phase, resume]);

  async function startConversation() {
    setStarting(true);
    await session.start({
      organization: organization.trim() || null,
      role: role.trim() || null,
      bullets: [],
    });
    setStarting(false);
  }

  async function addStory() {
    const seed = session.seed;
    const result = await session.finish();
    if (!result) return;
    onAdd(seed, storyFromResult(result));
    session.reset();
    onClose();
  }

  const showForm =
    session.phase === "idle" || (session.phase === "loading" && (starting || !draft.sessionId));
  const canStart = Boolean(organization.trim() || role.trim());

  return (
    <Drawer open={open} onClose={onClose} label="Talk it through" side="right">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-start gap-4 border-b border-ink/10 px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-sans-semibold text-ink">Talk it through</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Answer a few questions about one piece of work. The story card is built from your own
              words, and nothing is added until you say so.
            </p>
          </div>
          <Button type="button" size="sm" variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>

        {showForm ? (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6">
            <Field
              label="Where was this?"
              hint="A company, a project, a school or a group. Pick one piece of work."
              htmlFor="coach-organization"
            >
              <Input
                id="coach-organization"
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                maxLength={200}
                placeholder="Payly"
                autoFocus
              />
            </Field>
            <Field label="What was your role?" htmlFor="coach-role">
              <Input
                id="coach-role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                maxLength={200}
                placeholder="Backend engineer"
              />
            </Field>
            {session.error ? <Notice boxed>{session.error.message}</Notice> : null}
            <div className="flex items-center gap-3">
              <Button
                type="button"
                loading={starting}
                disabled={!canStart || starting}
                onClick={() => void startConversation()}
              >
                Start
              </Button>
              <span className="text-xs text-ink-muted">
                About five minutes. You can stop any time.
              </span>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            {session.phase === "loading" ? (
              <p className="px-6 py-6 text-sm text-ink-muted" role="status">
                Picking up where you left off...
              </p>
            ) : (
              <AssistPanel
                session={session}
                fields={COACH_FIELDS}
                cardTitle="Your story so far"
                finishLabel="Add this story"
                onFinish={() => void addStory()}
                onRestart={() => {
                  session.reset();
                }}
              />
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
