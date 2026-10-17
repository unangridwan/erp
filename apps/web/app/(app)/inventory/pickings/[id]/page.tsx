"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PickingForm } from "../../../../../components/inventory/picking-form";

function Inner() {
  const { id } = useParams<{ id: string }>();
  const type = useSearchParams().get("type") ?? "internal";
  return <PickingForm key={`${id}/${type}`} id={id} newType={type} />;
}

export default function PickingPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
