"use client";

import { useParams } from "next/navigation";
import { EmployeeForm } from "../../../../components/hr/employee-form";

export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  return <EmployeeForm key={id} id={id} />;
}
