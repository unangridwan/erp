"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LeadForm } from "../../../../../components/crm/lead-form";

function Inner() {
  const { id } = useParams<{ id: string }>();
  const type = useSearchParams().get("type") ?? "opportunity";
  return <LeadForm key={`${id}/${type}`} id={id} newType={type} />;
}

export default function LeadPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
