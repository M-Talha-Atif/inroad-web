"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Textarea } from "@/components/ui/Textarea";

import { AssistLiveCard, type AssistCardField } from "./AssistLiveCard";
import type { useAssistSession } from "./useAssistSession";

const MAX_ANSWER = 2000;
const COUNT_FROM = 1500;

type Session = ReturnType<typeof useAssistSession>;

/** The chat and the live card for one guided conversation. It knows nothing
 * about careers: the caller says what the parts are called and what happens
 * with the finished result. */
export function AssistPanel({
  session,
  fields,
  cardTitle,
  finishLabel,
  onFinish,
  onRestart,
}: {
  session: Session;
  fields: AssistCardField[];
  cardTitle: string;
  finishLabel: string;
  onFinish: () => void;
  onRestart: () => void;
}) {
  const { phase, messages, quickReplies, card, progress, error, note, typing } = session;
  const endRef = useRef<HTMLDivElement>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const sending = phase === "sending";
  const closed = phase === "finished" || phase === "over";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sending, error]);

  function submit() {
    if (!typing.trim() || sending) return;
    session.send(typing);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const share = progress.total > 0 ? progress.filled / progress.total : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-6 pt-4">
        <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
          <span>
            {progress.filled} of {progress.total} parts filled
          </span>
          <span className="flex items-center gap-3">
            {progress.required_done && progress.filled > 0 ? (
              <span>The key parts are covered</span>
            ) : null}
            <button
              type="button"
              className="text-ink-muted underline underline-offset-2 hover:text-ink"
              onClick={() => {
                if (confirmRestart) {
                  setConfirmRestart(false);
                  onRestart();
                } else {
                  setConfirmRestart(true);
                }
              }}
              onBlur={() => setConfirmRestart(false)}
            >
              {confirmRestart ? "Discard and start over?" : "Start over"}
            </button>
          </span>
        </div>
        <ProgressBar
          value={share}
          thick
          className="mt-2"
          label="How much of the story is filled in"
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4 md:grid-cols-2">
        <div className="min-w-0 space-y-3" aria-live="polite">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.from === "you" ? "justify-end" : "justify-start"}`}
            >
              <p
                className={`max-w-bubble whitespace-pre-wrap break-words rounded-card px-4 py-2.5 text-sm ${
                  message.from === "you"
                    ? "bg-signal-amber-subtle text-ink"
                    : "bg-surface-raised text-ink"
                }`}
              >
                {message.text}
              </p>
            </div>
          ))}
          {sending ? (
            <div className="flex justify-start" role="status" aria-label="The coach is thinking">
              <span className="flex gap-1.5 rounded-card bg-surface-raised px-4 py-3">
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="h-2 w-2 animate-pulse-dot rounded-full bg-ink-faint"
                    style={{ animationDelay: `${dot * 0.2}s` }}
                  />
                ))}
              </span>
            </div>
          ) : null}
          {note && !sending ? (
            <Notice tone="neutral" size="xs">
              {note}
            </Notice>
          ) : null}
          {error ? (
            <div className="space-y-2">
              <Notice boxed>{error.message}</Notice>
              {error.canRetry ? (
                <Button type="button" size="sm" onClick={session.retry}>
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <div className="min-w-0">
          <AssistLiveCard fields={fields} card={card} title={cardTitle} />
        </div>
      </div>

      <div className="border-t border-ink/10 px-6 py-4">
        {phase === "finished" && progress.filled === 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-ink-muted">
              There is no story to add yet. Start again when you have something to tell.
            </p>
            <Button type="button" variant="quiet" onClick={onRestart}>
              Start again
            </Button>
          </div>
        ) : null}

        {phase === "finished" && progress.filled > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-ink-muted">
              That covers it. Check your story so far, then add it. You can edit every part
              afterwards.
            </p>
            <Button type="button" onClick={onFinish}>
              {finishLabel}
            </Button>
          </div>
        ) : null}

        {phase === "over" ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-ink-muted">
              {error?.message ?? "This conversation has ended."}
            </p>
            <Button type="button" variant="quiet" onClick={onRestart}>
              Start again
            </Button>
          </div>
        ) : null}

        {!closed ? (
          <div className="space-y-3">
            <Textarea
              value={typing}
              onChange={(event) => session.setTyping(event.target.value)}
              onKeyDown={onKeyDown}
              maxLength={MAX_ANSWER}
              placeholder="Type your answer. Enter sends, Shift and Enter adds a line."
              aria-label="Your answer"
              className="min-h-20"
              disabled={sending || phase === "loading"}
            />
            <div className="flex flex-wrap items-center gap-2">
              {quickReplies.map((reply) => (
                <Button
                  key={reply}
                  type="button"
                  variant="quiet"
                  size="xs"
                  disabled={sending}
                  onClick={() => session.send(reply)}
                >
                  {reply}
                </Button>
              ))}
              <span className="flex-1" />
              {typing.length >= COUNT_FROM ? (
                <span className="text-xs text-ink-faint">
                  {typing.length} of {MAX_ANSWER}
                </span>
              ) : null}
              <Button
                type="button"
                size="sm"
                loading={sending}
                disabled={!typing.trim() || sending}
                onClick={submit}
              >
                Send
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
