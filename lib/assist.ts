import { ApiError, type AssistSession } from "@/lib/api-client/client";

// One place for the coach's timing. The backend gives a turn 25 seconds
// (2 model attempts and 1 repair call at most); the browser waits a little
// longer than that before it gives up.
export const TURN_TIMEOUT_MS = 30_000;
export const AUTO_RETRY_DELAY_MS = 1_000;
export const MAX_AUTO_RETRIES = 1;
export const CHECK_AGAIN_DELAY_MS = 2_000;
export const MAX_CHECKS = 3;

export type FailureAction = "retry_once" | "check_again" | "session_over" | "final";

export interface Failure {
  action: FailureAction;
  message: string;
  code: string | null;
}

const SAVED = "Your answer is saved.";

/** Decides what the browser does with a failed turn. It retries on its own
 * only when no answer came from our API (the network dropped, the request
 * timed out, or a proxy answered 502, 503 or 504 without our error code).
 * Anything our API said itself is final: the person decides whether to try
 * again, and the same turn id makes that safe. */
export function classifyFailure(error: unknown): Failure {
  if (!(error instanceof ApiError)) {
    return {
      action: "retry_once",
      message: `Could not reach the coach. ${SAVED} Check your connection and try again.`,
      code: null,
    };
  }
  const { status, code } = error;

  if (status === 409 && code === "turn_in_progress") {
    return { action: "check_again", message: "Still working on your last answer.", code };
  }
  if (code === null && (status === 0 || status === 502 || status === 503 || status === 504)) {
    return {
      action: "retry_once",
      message: `Could not reach the coach. ${SAVED} Try again.`,
      code,
    };
  }
  if (status === 404 || code === "session_not_active" || code === "session_not_found") {
    return {
      action: "session_over",
      message: "This conversation has ended. Start a new one to keep going.",
      code,
    };
  }
  if (code === "unclear_answers_limit") {
    return { action: "final", message: error.message, code };
  }
  if (status === 429) {
    return {
      action: "final",
      message: "You have sent a lot of answers just now. Wait a little, then try again.",
      code,
    };
  }
  if (status === 401) {
    return {
      action: "final",
      message: "Your session expired. Sign in again; your answer is kept.",
      code,
    };
  }
  if (code === "model_unavailable") {
    return {
      action: "final",
      message: `The coach could not answer just now. ${SAVED} Try again.`,
      code,
    };
  }
  return { action: "final", message: error.message, code };
}

export interface ChatMessage {
  id: string;
  from: "coach" | "you";
  text: string;
}

/** The conversation as the server remembers it: each finished turn's question
 * and answer, then the question waiting for an answer. Text cleared after the
 * retention period is skipped. */
export function messagesFromSession(session: AssistSession): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of session.turns) {
    if (turn.question) {
      messages.push({ id: `q${turn.turn_no}`, from: "coach", text: turn.question });
    }
    if (turn.answer) messages.push({ id: `a${turn.turn_no}`, from: "you", text: turn.answer });
  }
  if (session.status === "active") {
    messages.push({ id: `q${session.turns.length + 1}`, from: "coach", text: session.question });
  }
  return messages;
}

/** What the browser keeps to pick a conversation back up after a refresh. The
 * server holds everything else. */
export interface AssistDraft {
  sessionId: string | null;
  pending: { clientTurnId: string; answer: string } | null;
  typing: string;
}

export const EMPTY_ASSIST_DRAFT: AssistDraft = { sessionId: null, pending: null, typing: "" };

const DROPPED_NOTES: Record<string, string> = {
  quote_not_in_answer: "I left out something that was not in your own words.",
  number_not_in_answer: "I left out a number that you did not mention.",
  wrong_field: "I could not place that answer, so I left it out.",
  too_long: "That answer was too long to keep as written.",
  empty_value: "I could not find anything to keep in that answer.",
};

/** A plain sentence for a detail the coach refused to put on the card, or an
 * empty string when there is nothing worth telling the person. */
export function describeDropped(reason: string): string {
  return DROPPED_NOTES[reason] ?? "";
}
