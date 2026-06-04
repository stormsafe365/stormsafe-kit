import type { ReactNode } from 'react';

/** Eyebrow-headed control group, matching the StormSafe section pattern. */
export function Section({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-5 py-5">
      <p className="mb-4 font-head text-[11px] uppercase tracking-wide2 text-teal-dim">{eyebrow}</p>
      <div className="space-y-5">{children}</div>
    </section>
  );
}
