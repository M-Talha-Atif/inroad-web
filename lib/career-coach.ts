import type {
  AssistResult,
  AssistSession,
  CareerArcDocument,
  CareerArcStory,
} from "@/lib/api-client/client";
import { EMPTY_CAREER_ARC, newRole, newStory } from "@/lib/career-arc";

/** The parts the coach fills, in the order it asks. Labels follow the story
 * editor so the same word means the same thing in both places. */
export const COACH_FIELDS = [
  { key: "situation", label: "Situation" },
  { key: "my_role", label: "My role" },
  { key: "actions", label: "What I did" },
  { key: "why", label: "Why" },
  { key: "trade_offs", label: "Trade-offs" },
  { key: "outcome", label: "Result" },
  { key: "lessons", label: "What I'd do differently" },
];

const TITLE_WORDS = 8;

function shortTitle(text: string | undefined, fallback: string): string {
  const words = (text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return fallback;
  const cut = words
    .slice(0, TITLE_WORDS)
    .join(" ")
    .replace(/[.,;:!?]+$/, "");
  return words.length > TITLE_WORDS ? `${cut}...` : cut;
}

/** The coach's card as a drafted story. The title is the start of the first
 * thing the person said, which they can change in the editor. */
export function storyFromResult(result: AssistResult): CareerArcStory {
  const { fields } = result;
  return {
    ...newStory("job"),
    title: shortTitle(fields.situation ?? fields.actions, result.title),
    source: "drafted",
    situation: fields.situation ?? null,
    my_role: fields.my_role ?? null,
    actions: fields.actions ?? null,
    why: fields.why ?? null,
    trade_offs: fields.trade_offs ?? null,
    outcome: fields.outcome ?? null,
    lessons: fields.lessons ?? null,
  };
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** Adds the story under the chapter it was told about, making the chapter if
 * the career arc has none like it. */
export function addCoachStory(
  document: CareerArcDocument | null,
  seed: AssistSession["seed"] | null,
  story: CareerArcStory,
): CareerArcDocument {
  const base = document ?? EMPTY_CAREER_ARC;
  const roles = base.roles ?? [];
  const organization = seed?.organization ?? null;
  const role = seed?.role ?? null;
  const index = roles.findIndex(
    (existing) => same(existing.organization, organization) && same(existing.role, role),
  );

  if (index >= 0) {
    return {
      ...base,
      roles: roles.map((existing, position) =>
        position === index
          ? { ...existing, stories: [...(existing.stories ?? []), story] }
          : existing,
      ),
    };
  }
  const chapter = { ...newRole("job"), organization, role, stories: [story] };
  return { ...base, roles: [...roles, chapter] };
}
