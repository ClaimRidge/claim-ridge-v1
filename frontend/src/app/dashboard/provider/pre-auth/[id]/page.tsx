"use client";

import { useParams } from "next/navigation";
import PreAuthDetailView from "@/components/PreAuthDetailView";

export default function ProviderPreAuthDetailPage() {
  const params = useParams();
  return <PreAuthDetailView id={params.id as string} backHref="/dashboard/provider/pre-auth" />;
}
