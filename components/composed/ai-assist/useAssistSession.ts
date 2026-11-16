"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  fetchAssistSession,
  finishAssistSession,
  startAssistSession,
  submitAssistTurn,
  type AssistRecipe,
  type AssistResult,
  type AssistSession,
  type AssistSessionCreate,
  type AssistTurn,
} from "@/lib/api-client/client";
import {
  AUTO_RETRY_DELAY_MS,
  CHECK_AGAIN_DELAY_MS,
  MAX_AUTO_RETRIES,
  MAX_CHECKS,
  TURN_TIMEOUT_MS,
  classifyFailure,
  describeDropped,
  messagesFromSession,
  type AssistDraft,
  type ChatMessage,
} from "@/lib/assist";
import { ensureValidAccessToken } from "@/lib/auth-native/browser";

export type AssistPhase = "idle" | "loading" | "ready" | "sending" | "error" | "finished" | "over";

interface Progress {
  filled: number;
  total: number;
  required_done: boolean;
}

interface View {
  phase: AssistPhase;
  seed: AssistSession["seed"] | null;
  messages: ChatMessage[];
  quickReplies: string[];
  card: Record<string, string>;
  progress: Progress;
  maxTurns: number;
  error: { message: string; canRetry: boolean } | null;
  note: string | null;
}

const NO_PROGRESS: Progress = { filled: 0, total: 0, required_done: false };
const IDLE: View = {
  phase: "idle",
  seed: null,
  messages: [],
  quickReplies: [],
  card: {},
  progress: NO_PROGRESS,
  maxTurns: 0,
  error: null,
  note: null,
};

const SESSION_EXPIRED = "Your session expired. Sign in again; your answer is kept.";

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function phaseFor(status: AssistSession["status"]): AssistPhase {
  if (status === "finished") return "finished";
  return status === "expired" ? "over" : "ready";
}

/** One guided conversation. The server keeps the conversation; this keeps a
 * session id, the answer being sent and any half-typed text in `draft`, so a
 * refresh picks up where the person was. A turn that fails is sent again with
 * the same turn id, which makes a repeat safe. */
export function useAssistSession({
  recipe,
  draft,
  onDraftChange,
}: {
  recipe: AssistRecipe;
  draft: AssistDraft;
  onDraftChange: (update: (previous: AssistDraft) => AssistDraft) => void;
}) {
  const [view, setView] = useState<View>(IDLE);
  const controller = useRef<AbortController | null>(null);
  const turnCount = useRef(0);
  const busy = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => () => controller.current?.abort(), []);

  const patch = useCallback((changes: Partial<View>) => {
    setView((current) => ({ ...current, ...changes }));
  }, []);

  const applySession = useCallback((session: AssistSession) => {
    turnCount.current = session.turns.length;
    setView({
      phase: phaseFor(session.status),
      seed: session.seed,
      messages: messagesFromSession(session),
      quickReplies: session.quick_replies,
      card: session.card,
      progress: session.progress,
      maxTurns: session.max_turns,
      error: null,
      note: null,
    });
  }, []);

  const applyTurn = useCallback(
    (turn: AssistTurn, optimisticId: string) => {
      const isNew = turn.turn_no > turnCount.current;
      turnCount.current = Math.max(turnCount.current, turn.turn_no);
      const notes = turn.warnings.map((warning) => describeDropped(warning.reason)).filter(Boolean);
      setView((current) => ({
        ...current,
        phase: turn.finished ? "finished" : "ready",
        messages: [
          ...current.messages.filter((message) => message.id !== optimisticId || isNew),
          ...(isNew && turn.question
            ? [{ id: `q${turn.turn_no + 1}`, from: "coach" as const, text: turn.question }]
            : []),
        ],
        quickReplies: turn.quick_replies,
        card: turn.card,
        progress: turn.progress,
        error: null,
        note: notes[0] ?? null,
      }));
      onDraftChange((previous) => ({ ...previous, pending: null }));
    },
    [onDraftChange],
  );

  const run = useCallback(
    async (sessionId: string, turn: { clientTurnId: string; answer: string }) => {
      if (busy.current) return;
      busy.current = true;
      const optimisticId = `p-${turn.clientTurnId}`;
      const current = new AbortController();
      controller.current = current;
      setView((previous) => ({
        ...previous,
        phase: "sending",
        error: null,
        note: null,
        messages: previous.messages.some((message) => message.id === optimisticId)
          ? previous.messages
          : [...previous.messages, { id: optimisticId, from: "you", text: turn.answer }],
      }));

      let autoRetries = 0;
      let checks = 0;
      try {
        while (!current.signal.aborted) {
          try {
            const token = await ensureValidAccessToken();
            if (!token) {
              patch({ phase: "error", error: { message: SESSION_EXPIRED, canRetry: true } });
              return;
            }
            const request = new AbortController();
            const timer = setTimeout(() => request.abort(), TURN_TIMEOUT_MS);
            current.signal.addEventListener("abort", () => request.abort());
            try {
              const result = await submitAssistTurn(sessionId, turn, token, request.signal);
              applyTurn(result, optimisticId);
              return;
            } finally {
              clearTimeout(timer);
            }
          } catch (error) {
            if (current.signal.aborted) return;
            const failure = classifyFailure(error);
            if (failure.action === "retry_once" && autoRetries < MAX_AUTO_RETRIES) {
              autoRetries += 1;
              await wait(AUTO_RETRY_DELAY_MS, current.signal);
              continue;
            }
            if (failure.action === "check_again" && checks < MAX_CHECKS) {
              checks += 1;
              await wait(CHECK_AGAIN_DELAY_MS, current.signal);
              continue;
            }
            if (failure.action === "session_over") {
              patch({ phase: "over", error: { message: failure.message, canRetry: false } });
              onDraftChange((previous) => ({ ...previous, sessionId: null, pending: null }));
              return;
            }
            patch({
              phase: "error",
              error: {
                message:
                  failure.action === "check_again"
                    ? "Still working on it. Try again in a moment."
                    : failure.message,
                canRetry: true,
              },
            });
            return;
          }
        }
      } finally {
        busy.current = false;
      }
    },
    [applyTurn, onDraftChange, patch],
  );

  const begin = useCallback(
    async (load: (token: string, signal: AbortSignal) => Promise<AssistSession>) => {
      const current = new AbortController();
      controller.current?.abort();
      controller.current = current;
      patch({ phase: "loading", error: null });
      try {
        const token = await ensureValidAccessToken();
        if (!token) {
          patch({ phase: "idle", error: { message: SESSION_EXPIRED, canRetry: false } });
          return null;
        }
        const session = await load(token, current.signal);
        if (current.signal.aborted) return null;
        applySession(session);
        onDraftChange((previous) => ({
          ...previous,
          sessionId: session.status === "active" ? session.id : null,
        }));
        return session;
      } catch (error) {
        if (current.signal.aborted) return null;
        if (error instanceof ApiError && error.status === 404) {
          onDraftChange((previous) => ({ ...previous, sessionId: null, pending: null }));
          setView(IDLE);
          return null;
        }
        const failure = classifyFailure(error);
        patch({ phase: "idle", error: { message: failure.message, canRetry: false } });
        return null;
      }
    },
    [applySession, onDraftChange, patch],
  );

  /** Picks the conversation back up from the saved session id. With no saved
   * id there is nothing to resume: a session the person discarded must not
   * come back just because the server still lists it as open. */
  const resume = useCallback(async () => {
    const saved = draftRef.current;
    if (!saved.sessionId) return null;
    const sessionId = saved.sessionId;
    const session = await begin((token, signal) => fetchAssistSession(sessionId, token, signal));
    if (session && session.status === "active" && saved.pending && sessionId === session.id) {
      void run(session.id, saved.pending);
    }
    return session;
  }, [begin, run]);

  const start = useCallback(
    (seed: AssistSessionCreate["seed"]) =>
      begin((token, signal) => startAssistSession({ recipe, seed }, token, signal)),
    [begin, recipe],
  );

  const send = useCallback(
    (answer: string) => {
      const sessionId = draftRef.current.sessionId;
      const text = answer.trim();
      if (!sessionId || !text || busy.current) return;
      const turn = { clientTurnId: crypto.randomUUID(), answer: text };
      onDraftChange((previous) => ({ ...previous, pending: turn, typing: "" }));
      void run(sessionId, turn);
    },
    [onDraftChange, run],
  );

  const retry = useCallback(() => {
    const { sessionId, pending } = draftRef.current;
    if (sessionId && pending) void run(sessionId, pending);
    else void resume();
  }, [resume, run]);

  const finish = useCallback(async (): Promise<AssistResult | null> => {
    const sessionId = draftRef.current.sessionId;
    if (!sessionId) return null;
    try {
      const token = await ensureValidAccessToken();
      if (!token) {
        patch({ error: { message: SESSION_EXPIRED, canRetry: false } });
        return null;
      }
      const result = await finishAssistSession(sessionId, token);
      onDraftChange((previous) => ({ ...previous, sessionId: null, pending: null, typing: "" }));
      return result;
    } catch (error) {
      patch({ error: { message: classifyFailure(error).message, canRetry: false } });
      return null;
    }
  }, [onDraftChange, patch]);

  const reset = useCallback(() => {
    controller.current?.abort();
    busy.current = false;
    turnCount.current = 0;
    setView(IDLE);
    onDraftChange(() => ({ sessionId: null, pending: null, typing: "" }));
  }, [onDraftChange]);

  const setTyping = useCallback(
    (typing: string) => onDraftChange((previous) => ({ ...previous, typing })),
    [onDraftChange],
  );

  return { ...view, typing: draft.typing, setTyping, start, resume, send, retry, finish, reset };
}
