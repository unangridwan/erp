"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { OrderForm } from "../../../../../components/sales/order-form";

function Inner() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  return (
    <OrderForm
      key={id}
      id={id}
      leadId={search.get("leadId") ?? undefined}
      partnerId={search.get("partnerId") ?? undefined}
    />
  );
}

export default function OrderPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
