"use client";

import { Children, isValidElement } from "react";
import { CPT_CODES } from "@/data/cpt";
import { ICD10_CODES } from "@/data/icd10";

// Small read-only primitives shared by the "submitted request" detail views
// (PreAuthRequestFields, ClaimRequestDetail). Keeps the field/section/chip
// styling identical across the pre-auth and claim packets.

export const CPT_MAP: Record<string, string> = Object.fromEntries(CPT_CODES.map((c) => [c.code, c.description]));
export const ICD_MAP: Record<string, string> = Object.fromEntries(ICD10_CODES.map((c) => [c.code, c.description]));

export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-[#9ca3af]">{label}</dt>
      <dd className="text-sm text-[#0a0a0a] mt-0.5 break-words">{value}</dd>
    </div>
  );
}

export function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  // Hide the whole section when nothing would render. A <Field/> element is
  // always a truthy object even when it renders null, so inspect its `value`
  // prop directly; non-Field children (e.g. a code-chips wrapper) count as
  // content as-is.
  const isEmpty = (v: unknown) => v === null || v === undefined || v === "";
  const hasContent = Children.toArray(children).some((child) => {
    if (!isValidElement(child)) return Boolean(child);
    const props = child.props as { value?: unknown };
    return "value" in props ? !isEmpty(props.value) : true;
  });
  if (!hasContent) return null;
  return (
    <div className="bg-white border border-[#e5e7eb] rounded-lg p-4">
      <p className="text-xs font-bold text-[#0a0a0a] mb-3 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-[#16a34a]" /> {title}
      </p>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">{children}</dl>
    </div>
  );
}

export function CodeChips({ codes, map }: { codes: string[]; map: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {codes.map((c) => (
        <span
          key={c}
          title={map[c] || undefined}
          className="inline-flex items-center font-mono text-xs bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0] px-2 py-0.5 rounded"
        >
          {c}
          {map[c] ? <span className="ml-1.5 font-sans text-[#15803d]/70">{map[c]}</span> : null}
        </span>
      ))}
    </div>
  );
}
