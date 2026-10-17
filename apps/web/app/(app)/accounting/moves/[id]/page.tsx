"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { MoveForm } from "../../../../../components/accounting/move-form";

function Inner() {
  const { id } = useParams<{ id: string }>();
  const type = useSearchParams().get("type") ?? "entry";
  return <MoveForm key={`${id}/${type}`} id={id} newType={type} />;
}

export default function MovePage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
