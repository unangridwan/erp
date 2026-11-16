"use client";

import { useParams } from "next/navigation";
import { Account360 } from "../../../../../components/crm/account-360";

export default function AccountPage() {
  const { id } = useParams<{ id: string }>();
  return <Account360 key={id} id={id} />;
}
