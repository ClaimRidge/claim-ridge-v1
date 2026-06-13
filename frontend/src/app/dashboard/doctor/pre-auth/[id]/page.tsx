"use client";

import { useParams } from "next/navigation";
import PreAuthDetailView from "@/components/PreAuthDetailView";

export default function DoctorPreAuthDetailPage() {
  const params = useParams();
  return <PreAuthDetailView id={params.id as string} backHref="/dashboard/doctor/pre-auth" />;
}
