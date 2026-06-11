export interface ClaimFormData {
  patient_name: string;
  patient_id: string;
  date_of_service: string;
  provider_name: string;
  provider_id: string;
  payer_name: string;
  payer_id: string;
  diagnosis_codes: string[];
  procedure_codes: string[];
  billed_amount: number;
  notes: string;
  confidence_scores?: Record<string, number>;
  clinic_id?: string;

  // ── Clinical Context — feeds the Layer-1 XGBoost fraud detector.
  // All optional, but the more we supply the higher the detector's
  // signal/noise ratio. If 5+ of these are missing for a claim, the
  // fraud model reports `insufficient_data` and skips scoring.
  patient_age?: number;
  patient_gender?: "Male" | "Female" | "";
  patient_state?: string;
  visit_type?: "Inpatient" | "Outpatient" | "Emergency" | "Day Surgery" | "";
  length_of_stay?: number;
  insurance_type?: string;
  provider_specialty?: string;
}

export interface ScrubResult {
  id: string;
  claim_id: string;
  status: "clean" | "warnings" | "errors";
  overall_score: number;
  issues: ScrubIssue[];
  corrected_claim: ClaimFormData;
  recommendations: string[];
  applied_policy_rules?: string[];
  retrieved_sources?: string[];
  created_at: string;
}

export interface ScrubIssue {
  field: string;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion: string;
}

export interface ClaimAuditLog {
  id: string;
  user_id: string;
  claim_reference_number: string;
  patient_name: string;
  date_of_service: string | null;
  provider_name: string | null;
  payer_name: string | null;
  diagnosis_codes: string[];
  procedure_codes: string[];
  billed_amount: number;
  ai_flags: ScrubIssue[];
  ai_corrections: ClaimFormData | Record<string, never>;
  export_count: number;
  created_at: string;
}

export interface ClaimData {
  patientName: string;
  patientId: string;
  patientDob?: string;
  patientGender?: string;
  providerName: string;
  providerId: string;
  providerSpecialty?: string;
  payerCode: string;
  payerNameEn: string;
  payerNameAr: string;
  policyNumber: string;
  memberId?: string;
  preauthNumber?: string;
  dateOfService: string;
  diagnosisCodes: string[];
  procedureCodes: string[];
  billedAmount: number;
  clinicalNarrative: string;
  additionalNotes?: string;
  claimNumber: string;
  generatedAt: string;
}

// Two decision vocabularies coexist on claims.status:
// AI adjudication writes accepted | denied | escalated; a human Medical
// Officer's manual review writes approved | rejected | needs_info.
export type ClaimStatus =
  | "draft"
  | "intake_complete"
  | "submitted"
  | "unrouted"
  | "pending"
  | "under_review"
  | "approved"
  | "accepted"
  | "denied"
  | "rejected"
  | "escalated"
  | "needs_info"
  | "appealing";

export interface AdjudicationVerdict {
  decision: "accept" | "deny" | "escalate";
  status: string;
  path: string;
  rationale: string;
  evidence?: { step: string; finding: string }[];
  policy_basis?: string[];
  adjudicated_by?: string;
  adjudicated_at?: string;
}

export interface Claim {
  id: string;
  user_id: string;
  clinic_id?: string;
  claim_number?: string;
  patient_name: string;
  patient_id: string;
  member_id?: string;
  date_of_service: string;
  provider_name: string;
  provider_id: string;
  payer_name: string;
  payer_id: string;
  payer_code?: string;
  diagnosis_codes: string[];
  procedure_codes: string[];
  billed_amount: number;
  total_billed?: number;
  currency?: string;
  notes: string;
  status: ClaimStatus;
  routing_status?: "routed" | "unrouted";
  scrub_result: ScrubResult | null;
  scrub_passed?: boolean;
  scrub_warnings?: number;
  adjudication?: AdjudicationVerdict | null;
  adjudication_decision?: "accept" | "deny" | "escalate" | null;
  adjudicated_at?: string | null;
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
  denial_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface InsurerProfile {
  id: string;
  user_id: string;
  company_name: string;
  company_name_ar?: string;
  license_number?: string;
  created_at: string;
  updated_at: string;
}

