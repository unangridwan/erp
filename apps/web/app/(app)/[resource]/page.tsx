"use client";

import { notFound, useParams } from "next/navigation";
import { ListView } from "../../../components/list-view";
import { findResource } from "../../../lib/resources";

export default function ResourceListPage() {
  const { resource } = useParams<{ resource: string }>();
  const def = findResource(resource);
  if (!def) notFound();
  return <ListView key={def.path} resource={def} />;
}
