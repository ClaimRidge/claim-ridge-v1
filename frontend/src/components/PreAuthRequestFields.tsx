"use client";

import { User, Stethoscope, Activity, CalendarClock } from "lucide-react";
import { Field, Section, CodeChips, CPT_MAP, ICD_MAP } from "@/components/detail/fields";

// Presentational view of the structured pre-auth packet — every field the
// doctor/provider filed. Pure (no fetch); the standalone detail page loads the
// request once and passes it in. Document previews are rendered separately by
// DocumentViewer.

export interface PreAuthRequestData {
  patient_name?: string | null;
  patient_id?: string | null;
  patient_dob?: string | null;
  patient_age?: number | null;
  patient_gender?: string | null;
  patient_phone?: string | null;
  patient_address?: string | null;
  insurance_member_id?: string | null;
  insurance_group_number?: string | null;
  insurer_name?: string | null;
  priority?: string | null;
  place_of_service?: string | null;
  anticipated_date_of_service?: string | null;
  ordering_provider_name?: string | null;
  ordering_provider_npi?: string | null;
  ordering_provider_tax_id?: string | null;
  servicing_provider_name?: string | null;
  servicing_provider_npi?: string | null;
  servicing_provider_tax_id?: string | null;
  provider_name?: string | null;
  diagnosis_codes?: string[] | null;
  procedure_codes?: string[] | null;
  diagnosis_code?: string | null;
  procedure_code?: string | null;
  modifiers?: string | null;
  ndc_code?: string | null;
}

export default function PreAuthRequestFields({ request }: { request: PreAuthRequestData }) {
  // Prefer the structured arrays, fall back to the legacy singular columns.
  const dx = (request.diagnosis_codes && request.diagnosis_codes.length
    ? request.diagnosis_codes
    : request.diagnosis_code ? [request.diagnosis_code] : []).filter(Boolean) as string[];
  const cpt = (request.procedure_codes && request.procedure_codes.length
    ? request.procedure_codes
    : request.procedure_code ? [request.procedure_code] : []).filter(Boolean) as string[];
  const servicing = request.servicing_provider_name || request.provider_name;

  return (
    <div className="space-y-3">
      <Section icon={User} title="Patient">
        <Field label="Name" value={request.patient_name} />
        <Field label="Patient ID" value={request.patient_id} />
        <Field label="Date of birth" value={request.patient_dob} />
        <Field label="Age" value={request.patient_age} />
        <Field label="Gender" value={request.patient_gender} />
        <Field label="Phone" value={request.patient_phone} />
        <Field label="Address" value={request.patient_address} />
        <Field label="Member ID" value={request.insurance_member_id} />
        <Field label="Group #" value={request.insurance_group_number} />
      </Section>

      <Section icon={CalendarClock} title="Payer & service">
        <Field label="Insurer / payer" value={request.insurer_name} />
        <Field label="Priority" value={request.priority} />
        <Field label="Place of service" value={request.place_of_service} />
        <Field label="Anticipated date of service" value={request.anticipated_date_of_service} />
      </Section>

      <Section icon={Stethoscope} title="Providers">
        <Field label="Ordering provider" value={request.ordering_provider_name} />
        <Field label="Ordering NPI" value={request.ordering_provider_npi} />
        <Field label="Ordering Tax ID" value={request.ordering_provider_tax_id} />
        <Field label="Servicing provider / facility" value={servicing} />
        <Field label="Servicing NPI" value={request.servicing_provider_npi} />
        <Field label="Servicing Tax ID" value={request.servicing_provider_tax_id} />
      </Section>

      {(dx.length > 0 || cpt.length > 0 || request.modifiers || request.ndc_code) && (
        <Section icon={Activity} title="Clinical coding">
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
          <Field label="Modifiers" value={request.modifiers} />
          <Field label="NDC code" value={request.ndc_code} />
        </Section>
      )}
    </div>
  );
}
