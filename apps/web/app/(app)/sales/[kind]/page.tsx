"use client";

import { notFound, useParams } from "next/navigation";
import { OrderList } from "../../../../components/sales/order-list";
import { ORDER_KINDS, type OrderKind } from "../../../../lib/resources";

export default function OrderListPage() {
  const { kind } = useParams<{ kind: string }>();
  if (!(kind in ORDER_KINDS)) notFound();
  return <OrderList key={kind} kind={kind as OrderKind} />;
}
