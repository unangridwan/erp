"use client";

import { notFound, useParams } from "next/navigation";
import { PurchaseList } from "../../../../components/purchase/purchase-list";
import { PURCHASE_KINDS, type PurchaseKind } from "../../../../lib/resources";

export default function PurchaseListPage() {
  const { kind } = useParams<{ kind: string }>();
  if (!(kind in PURCHASE_KINDS)) notFound();
  return <PurchaseList key={kind} kind={kind as PurchaseKind} />;
}
