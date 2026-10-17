"use client";

import { useParams } from "next/navigation";
import { PricelistForm } from "../../../../../components/sales/pricelist-form";

export default function PricelistPage() {
  const { id } = useParams<{ id: string }>();
  return <PricelistForm key={id} id={id} />;
}
