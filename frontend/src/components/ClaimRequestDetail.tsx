"use client";

import { User, Stethoscope, Activity, ShieldCheck, FileText } from "lucide-react";
import { Field, Section, CodeChips, CPT_MAP, ICD_MAP } from "@/components/detail/fields";

// Read-only view of the EXACT claim packet that was submitted. Mirrors
// PreAuthRequestFields for the claims side so a provider (or doctor) can see
// precisely what was filed, not just the scrub/decision summary.
//
// Reads straight from the already-loaded claim row (claims is select("*"), so
// every column — including the optional clinical/fraud signals and the pre-auth
// linkage — is present at runtime even when the Claim type doesn't list it).

interface ClaimLike {
  patient_name?: string | null;
  patient_id?: string | null;
  member_id?: string | null;
  patient_age?: number | null;
  patient_gender?: string | null;
  patient_state?: string | null;
  date_of_service?: string | null;
  visit_type?: string | null;
  length_of_stay?: number | null;
  provider_name?: string | null;
  provider_id?: string | null;
  provider_specialty?: string | null;
  payer_name?: string | null;
  insurance_type?: string | null;
  diagnosis_codes?: string[] | null;
  procedure_codes?: string[] | null;
  billed_amount?: number | null;
  total_billed?: number | null;
  currency?: string | null;
  notes?: string | null;
  pre_auth_number?: string | null;
  auth_check_status?: string | null;
  auth_check_detail?: string | null;
}

const AUTH_LABEL: Record<string, string> = {
  ok: "Verified against authorisation",
  missing: "No matching authorisation found",
  expired: "Authorisation expired",
  wrong_patient: "Patient does not match authorisation",
  code_mismatch: "Billed procedure not in authorised scope",
  not_applicable: "No pre-auth referenced",
};

export default function ClaimRequestDetail({ claim }: { claim: ClaimLike }) {
  const dx = (claim.diagnosis_codes || []).filter(Boolean);
  const cpt = (claim.procedure_codes || []).filter(Boolean);
  const amount = Number(claim.total_billed ?? claim.billed_amount) || 0;
  const currency = claim.currency || "JOD";

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#16a34a]">Submitted claim</p>

      <Section icon={User} title="Patient">
        <Field label="Name" value={claim.patient_name} />
        <Field label="Patient ID" value={claim.patient_id} />
        <Field label="Member ID" value={claim.member_id} />
        <Field label="Age" value={claim.patient_age} />
        <Field label="Gender" value={claim.patient_gender} />
        <Field label="State / region" value={claim.patient_state} />
      </Section>

      <Section icon={Stethoscope} title="Service & provider">
        <Field label="Date of service" value={claim.date_of_service} />
        <Field label="Visit type" value={claim.visit_type} />
        <Field label="Length of stay" value={claim.length_of_stay} />
        <Field label="Provider" value={claim.provider_name} />
        <Field label="Provider ID / NPI" value={claim.provider_id} />
        <Field label="Specialty" value={claim.provider_specialty} />
        <Field label="Payer" value={claim.payer_name} />
        <Field label="Insurance type" value={claim.insurance_type} />
      </Section>

      <Section icon={Activity} title="Clinical coding & billing">
        <div className="col-span-2 sm:col-span-3">
          {dx.length > 0 && (
            <div className="mb-3">
              <dt className="text-[11px] font-bold uppercase tracking-wide text-[#9ca3af] mb-1">Diagnosis (ICD-10)</dt>
              <CodeChips codes={dx} map={ICD_MAP} />
            </div>
          )}
          {cpt.length > 0 && (
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-[#9ca3af] mb-1">Procedures (CPT)</dt>
              <CodeChips codes={cpt} map={CPT_MAP} />
            </div>
          )}
        </div>
        <Field label="Total billed" value={`${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`} />
      </Section>

      {claim.pre_auth_number && (
        <Section icon={ShieldCheck} title="Pre-authorisation linkage">
          <Field label="Authorisation #" value={<span className="font-mono">{claim.pre_auth_number}</span>} />
          <Field
            label="Verification"
            value={claim.auth_check_status ? AUTH_LABEL[claim.auth_check_status] || claim.auth_check_status : null}
          />
          <Field label="Detail" value={claim.auth_check_detail} />
        </Section>
      )}

      {claim.notes && (
        <div className="bg-white border border-[#e5e7eb] rounded-lg p-4">
          <p className="text-xs font-bold text-[#0a0a0a] mb-2 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-[#16a34a]" /> Submitter notes
          </p>
          <p className="text-sm text-[#374151] whitespace-pre-wrap">{claim.notes}</p>
        </div>
      )}
    </div>
  );
}
