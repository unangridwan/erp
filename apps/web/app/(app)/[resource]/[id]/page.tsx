"use client";

import { notFound, useParams } from "next/navigation";
import { FormView } from "../../../../components/form-view";
import { findResource } from "../../../../lib/resources";

export default function ResourceFormPage() {
  const { resource, id } = useParams<{ resource: string; id: string }>();
  const def = findResource(resource);
  if (!def) notFound();
  return <FormView key={`${def.path}/${id}`} resource={def} id={id} />;
}
