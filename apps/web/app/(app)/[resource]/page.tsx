"use client";

import { notFound, useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ListView } from "../../../components/list-view";
import { findResource } from "../../../lib/resources";

export default function ResourceListPage() {
  return (
    <Suspense>
      <ResourceList />
    </Suspense>
  );
}

function ResourceList() {
  const { resource } = useParams<{ resource: string }>();
  const role = useSearchParams().get("role") ?? undefined;
  const def = findResource(resource);
  if (!def) notFound();
  return <ListView key={`${def.path}:${role ?? ""}`} resource={def} role={role} />;
}
