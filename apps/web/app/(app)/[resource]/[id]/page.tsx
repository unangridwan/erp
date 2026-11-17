"use client";

import { notFound, useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FormView } from "../../../../components/form-view";
import { findResource } from "../../../../lib/resources";

export default function ResourceFormPage() {
  return (
    <Suspense>
      <ResourceForm />
    </Suspense>
  );
}

function ResourceForm() {
  const { resource, id } = useParams<{ resource: string; id: string }>();
  const role = useSearchParams().get("role") ?? undefined;
  const def = findResource(resource);
  if (!def) notFound();
  return <FormView key={`${def.path}/${id}`} resource={def} id={id} role={role} />;
}
