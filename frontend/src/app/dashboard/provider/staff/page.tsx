"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Users, Building2, Trash2, ArrowLeft, CheckCircle, Plus } from "lucide-react";
import Button from "@/components/ui/Button";

interface DoctorProfile {
  id: string;
  organization_name: string;
  contact_email: string;
  config_json?: {
    specialty?: string;
  };
}

export default function StaffManagementPage() {
  const [doctors, setDoctors] = useState<DoctorProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgCode, setOrgCode] = useState("");
  const [copied, setCopied] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const fetchStaff = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get the Provider's Organization Code
      const { data: providerProfile } = await supabase
        .from("profiles")
        .select("org_code, account_type")
        .eq("id", user.id)
        .single();
        
      if (providerProfile) {
        let fetchedOrgCode = providerProfile.org_code;
        
        // SELF-HEALING: If provider has no org code, generate and save it now
        if (providerProfile.account_type === "provider" && !fetchedOrgCode) {
          fetchedOrgCode = 'ORG-' + Math.random().toString(36).substring(2, 8).toUpperCase();
          await supabase.from("profiles").update({ org_code: fetchedOrgCode }).eq("id", user.id);
        }
        setOrgCode(fetchedOrgCode || "");
      }

      // Fetch all doctors whose org_id matches this Provider's ID using the new junction table
      const { data: staffData } = await supabase
        .from("doctor_orgs")
        .select(`
          doctor_id,
          profiles!doctor_orgs_doctor_id_fkey (
            id,
            organization_name,
            contact_email,
            config_json
          )
        `)
        .eq("org_id", user.id);

      if (staffData) {
        // Flatten the joined data back into the expected DoctorProfile format
        const mappedDoctors = staffData.map((d: any) => d.profiles);
        setDoctors(mappedDoctors as DoctorProfile[]);
      }
      setLoading(false);
    };

    fetchStaff();
  }, [supabase]);

  const handleRemoveDoctor = async (doctorId: string) => {
    const confirmRemove = window.confirm("Are you sure you want to remove this doctor from your organization? You will retain their historical claim data, but their future claims will be processed independently.");
    if (!confirmRemove) return;

    // Remove the affiliation from the junction table
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("doctor_orgs")
        .delete()
        .eq("doctor_id", doctorId)
        .eq("org_id", user.id);
    }

    // Set the doctor's parent_org_id back to null (for backward compatibility)
    await supabase.from("profiles").update({ parent_org_id: null }).eq("id", doctorId);
    setDoctors(doctors.filter(d => d.id !== doctorId));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="mb-6">
        <Link href="/dashboard/provider" className="flex items-center gap-2 text-sm text-[#6b7280] hover:text-[#16a34a] font-medium">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-10 h-10 bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg">
            <Users className="h-5 w-5 text-[#16a34a]" />
          </div>
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0a0a0a]">Manage Medical Staff</h1>
            <p className="text-[#9ca3af] text-sm">Doctors operating under your organization</p>
          </div>
        </div>
      </div>

      {/* Network Invite Code Panel */}
      <div className="bg-white border border-[#e5e7eb] rounded-xl p-6 shadow-sm mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-[#0a0a0a] flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#16a34a]" />
            Organization Invitation
          </h3>
          <p className="text-sm text-[#6b7280] mt-1">
            Share this link or code with doctors so they can link their account to your hospital.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="group relative">

            <div className="relative bg-[#f0fdf4] border border-[#bbf7d0] px-4 py-2 rounded-xl min-w-[120px] flex items-center justify-center shadow-sm overflow-hidden group-hover:border-[#16a34a] transition-all duration-300">
              {orgCode ? (
                <span className="relative font-mono text-xl font-bold text-[#16a34a] tracking-[0.15em]">
                  {orgCode}
                </span>
              ) : (
                <div className="h-6 w-20 bg-[#dcfce7] animate-pulse rounded" />
              )}
            </div>
          </div>

          {orgCode && (
            <button
              onClick={() => {
                const link = `${window.location.origin}/signup?role=doctor&org=${orgCode}`;
                navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
                copied 
                  ? "bg-[#16a34a] text-white shadow-lg shadow-[#16a34a]/20" 
                  : "bg-[#f0fdf4] text-[#16a34a] hover:bg-[#16a34a] hover:text-white border border-[#bbf7d0] hover:border-[#16a34a]"
              }`}
            >
              {copied ? (
                <>
                  <CheckCircle className="h-4 w-4" />
                  Link Copied
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Copy Invite Link
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Staff List */}
      <div className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="animate-pulse">
            <div className="bg-[#f9fafb] border-b border-[#f3f4f6] h-12 flex items-center px-6 gap-4">
              <div className="h-2.5 bg-[#e5e7eb] rounded-full w-1/4"></div>
              <div className="h-2.5 bg-[#e5e7eb] rounded-full w-1/4"></div>
              <div className="h-2.5 bg-[#e5e7eb] rounded-full w-1/4"></div>
              <div className="h-2.5 bg-[#e5e7eb] rounded-full w-1/4 ml-auto"></div>
            </div>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="px-6 py-5 flex items-center gap-4 border-b border-[#f3f4f6] last:border-0">
                <div className="h-4 bg-[#f3f4f6] rounded w-1/4"></div>
                <div className="h-4 bg-[#f3f4f6] rounded w-1/6"></div>
                <div className="h-4 bg-[#f3f4f6] rounded w-1/3"></div>
                <div className="h-8 bg-[#f3f4f6] rounded w-20 ml-auto"></div>
              </div>
            ))}
          </div>
        ) : doctors.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="h-10 w-10 text-[#d1d5db] mx-auto mb-3" />
            <h3 className="font-bold text-[#0a0a0a]">No doctors linked yet</h3>
            <p className="text-sm text-[#6b7280] mt-1">Share your organization code above with your doctors.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-[#f9fafb] text-left border-b border-[#f3f4f6]">
                <th className="px-6 py-3 text-xs font-medium text-[#9ca3af] uppercase">Doctor Name</th>
                <th className="px-6 py-3 text-xs font-medium text-[#9ca3af] uppercase">Specialty</th>
                <th className="px-6 py-3 text-xs font-medium text-[#9ca3af] uppercase">Email</th>
                <th className="px-6 py-3 text-xs font-medium text-[#9ca3af] uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f3f4f6]">
              {doctors.map((doctor) => (
                <tr key={doctor.id} className="hover:bg-[#f9fafb]">
                  <td className="px-6 py-4 text-sm font-bold text-[#0a0a0a]">{doctor.organization_name}</td>
                  <td className="px-6 py-4 text-sm text-[#6b7280]">{doctor.config_json?.specialty || "General"}</td>
                  <td className="px-6 py-4 text-sm text-[#6b7280]">{doctor.contact_email || "N/A"}</td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => handleRemoveDoctor(doctor.id)}
                      className="text-red-500 hover:text-red-700 text-sm font-medium flex items-center justify-end gap-1 ml-auto"
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}