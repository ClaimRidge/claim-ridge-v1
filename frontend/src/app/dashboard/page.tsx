"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function DashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    const routeUser = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("account_type")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile?.account_type) {
        router.push("/onboarding");
        return;
      }

      if (profile.account_type === "insurance") {
        router.push("/dashboard/insurance");
      } else if (profile.account_type === "provider") {
        router.push("/dashboard/provider");
      } else {
        // Fallback
        router.push("/dashboard/provider");
      }
    };

    routeUser();
  }, [router]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center">
      <div className="animate-spin h-8 w-8 border-4 border-[#16a34a] border-t-transparent rounded-full mb-4" />
      <h2 className="font-display text-xl font-bold text-[#0a0a0a]">Loading your dashboard...</h2>
      <p className="text-[#6b7280] text-sm mt-2">Routing you to the correct workspace</p>
    </div>
  );
}
