"use client";

import { notFound, useParams } from "next/navigation";
import { PickingList } from "../../../../components/inventory/picking-list";
import { PICKING_KINDS, type PickingKind } from "../../../../lib/resources";

export default function PickingListPage() {
  const { kind } = useParams<{ kind: string }>();
  if (!(kind in PICKING_KINDS)) notFound();
  return <PickingList key={kind} kind={kind as PickingKind} />;
}
