"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { ArrowLeft, Save, Loader2, CheckCircle2, Sparkles, ShieldCheck } from "lucide-react";

type Mode = "off" | "shadow" | "advisory" | "auto_both";

interface AutomationConfig {
  mode: Mode;
  confidence_threshold: number;
  auto_decision_max_amount: number;
  always_review_specialties: string[];
  always_review_cpts: string[];
  auto_revocation_window_hours: number;
}

const MODE_DESCRIPTION: Record<Mode, { title: string; body: string }> = {
  off: {
    title: "Off",
    body: "No AI runs on pre-auth. Every request goes straight to your manual queue. Default.",
  },
  shadow: {
    title: "Shadow",
    body: "The AI runs and records a recommendation, but every request still goes to your manual queue. Use this to measure agreement with your reviewers before turning the switch on.",
  },
  advisory: {
    title: "Advisory",
    body: "The AI's recommendation is shown next to each queue row. Your reviewer still decides every request.",
  },
  auto_both: {
    title: "Auto-decide (approve + deny)",
    body: "When the AI is at or above the confidence threshold AND every cited policy passage verifies, it auto-approves or auto-denies the request. Anything else escalates to your manual queue.",
  },
};

const DEFAULT_CONFIG: AutomationConfig = {
  mode: "off",
  confidence_threshold: 0.9,
  auto_decision_max_amount: 5000,
  always_review_specialties: [],
  always_review_cpts: [],
  auto_revocation_window_hours: 72,
};

export default function PreAuthAutomationSettingsPage() {
  const supabase = createClient();
  const [config, setConfig] = useState<AutomationConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Free-text mirrors for the list inputs (comma-separated). Kept separate from
  // the canonical arrays so users can type intermediate states like "33945, ".
  const [specialtiesText, setSpecialtiesText] = useState("");
  const [cptsText, setCptsText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Not signed in.");
        return;
      }
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/insurer/pre-auth-automation`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!res.ok) throw new Error("Failed to load automation config.");
      const json = await res.json();
      const cfg: AutomationConfig = { ...DEFAULT_CONFIG, ...json.config };
      setConfig(cfg);
      setSpecialtiesText((cfg.always_review_specialties || []).join(", "));
      setCptsText((cfg.always_review_cpts || []).join(", "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load automation config.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const payload: AutomationConfig = {
        ...config,
        always_review_specialties: specialtiesText
          .split(",").map(s => s.trim()).filter(Boolean),
        always_review_cpts: cptsText
          .split(",").map(s => s.trim()).filter(Boolean),
      };
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/insurer/pre-auth-automation`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail || "Failed to save automation config.");
      }
      const json = await res.json();
      setConfig({ ...DEFAULT_CONFIG, ...json.config });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save automation config.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-[#0A1628] mb-3" />
        <p className="text-sm text-[#6b7280]">Loading automation settings…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link href="/dashboard/insurance/settings" className="inline-flex items-center text-sm text-[#6b7280] hover:text-[#0a0a0a] mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to settings
      </Link>

      <div className="mb-6">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0a0a0a] tracking-tight">
          Pre-Auth Automation
        </h1>
        <p className="text-sm text-[#6b7280] mt-1 max-w-2xl">
          Control how aggressively the AI advisor decides on pre-authorisation requests for your organisation. We strongly recommend starting in <strong>Shadow</strong> mode to compare the AI&apos;s recommendations against your reviewers before enabling auto-decisions.
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Settings saved.
        </div>
      )}

      {/* Mode selector */}
      <div className="bg-white border border-[#e5e7eb] rounded-xl p-5 shadow-sm mb-6">
        <h2 className="font-bold text-[#0a0a0a] mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#00B4A6]" /> Mode
        </h2>
        <div className="space-y-2">
          {(Object.keys(MODE_DESCRIPTION) as Mode[]).map(m => {
            const active = config.mode === m;
            const meta = MODE_DESCRIPTION[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => setConfig(c => ({ ...c, mode: m }))}
                className={`w-full text-left border rounded-lg p-3 transition-all ${active ? "border-[#0A1628] bg-[#f8fafc] ring-2 ring-[#0A1628]/10" : "border-[#e5e7eb] hover:border-[#d1d5db]"}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full border ${active ? "bg-[#0A1628] border-[#0A1628]" : "bg-white border-[#d1d5db]"}`} />
                  <span className="font-bold text-sm text-[#0a0a0a]">{meta.title}</span>
                </div>
                <p className="text-xs text-[#6b7280] mt-1 ml-5 leading-relaxed">{meta.body}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Thresholds */}
      <div className="bg-white border border-[#e5e7eb] rounded-xl p-5 shadow-sm mb-6">
        <h2 className="font-bold text-[#0a0a0a] mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#00B4A6]" /> Auto-decision guardrails
        </h2>
        <p className="text-xs text-[#6b7280] mb-4 leading-relaxed">
          Applied only when mode is set to <strong>Auto-decide</strong>. Anything that fails a guardrail escalates to your manual queue.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">
              Confidence threshold (0–1)
            </label>
            <Input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={config.confidence_threshold}
              onChange={(e) => setConfig(c => ({ ...c, confidence_threshold: Number(e.target.value) }))}
            />
            <p className="text-[11px] text-[#9ca3af] mt-1">
              The AI must be at or above this confidence to auto-decide. We recommend 0.90.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">
              Cost ceiling (auto-decision max amount)
            </label>
            <Input
              type="number"
              step={50}
              min={0}
              value={config.auto_decision_max_amount}
              onChange={(e) => setConfig(c => ({ ...c, auto_decision_max_amount: Number(e.target.value) }))}
            />
            <p className="text-[11px] text-[#9ca3af] mt-1">
              Requests above this estimated cost always escalate. Set 0 to disable the ceiling.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-[#374151] mb-1">
              Always-review specialties
            </label>
            <Input
              value={specialtiesText}
              onChange={(e) => setSpecialtiesText(e.target.value)}
              placeholder="e.g. Oncology, Transplant, Psychiatry"
            />
            <p className="text-[11px] text-[#9ca3af] mt-1">
              Comma-separated. Pre-auth requests from these specialties always go to your manual queue.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-[#374151] mb-1">
              Always-review CPT codes
            </label>
            <Input
              value={cptsText}
              onChange={(e) => setCptsText(e.target.value)}
              placeholder="e.g. 33945, 47135"
            />
            <p className="text-[11px] text-[#9ca3af] mt-1">
              Comma-separated CPT codes that always go to your manual queue, regardless of AI confidence.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">
              Auto-decision revocation window (hours)
            </label>
            <Input
              type="number"
              step={1}
              min={0}
              value={config.auto_revocation_window_hours}
              onChange={(e) => setConfig(c => ({ ...c, auto_revocation_window_hours: Number(e.target.value) }))}
            />
            <p className="text-[11px] text-[#9ca3af] mt-1">
              SLA for your reviewers to override an auto-decision before it is treated as final.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button onClick={handleSave} loading={saving} className="gap-2">
          <Save className="h-4 w-4" /> Save automation settings
        </Button>
      </div>
    </div>
  );
}
