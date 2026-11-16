"use client";

import { Card } from "@/components/ui/Card";

export interface AssistCardField {
  key: string;
  label: string;
}

/** The result so far, one line per part. Filled parts read as text; the rest
 * wait quietly, so the person sees the story taking shape as they answer. */
export function AssistLiveCard({
  fields,
  card,
  title,
}: {
  fields: AssistCardField[];
  card: Record<string, string>;
  title: string;
}) {
  return (
    <Card variant="nested" padding="sm" aria-label={title}>
      <h3 className="utility-label text-ink-faint">{title}</h3>
      <dl className="mt-3 space-y-3">
        {fields.map(({ key, label }) => {
          const value = card[key];
          return (
            <div key={key}>
              <dt className="text-xs font-sans-semibold text-ink-muted">{label}</dt>
              <dd className={`mt-0.5 text-sm ${value ? "text-ink" : "text-ink-faint"}`}>
                {value || "Not yet"}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}
