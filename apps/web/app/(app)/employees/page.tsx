"use client";

import { ListView } from "../../../components/list-view";
import { findResource } from "../../../lib/resources";

/** Daftar/kanban karyawan tetap memakai tampilan generik; form memakai halaman khusus. */
export default function EmployeesPage() {
  return <ListView resource={findResource("employees")!} />;
}
