"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthImage } from "../../../../components/auth-image";
import { errorText } from "../../../../components/hr/hr-panels";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

interface Node {
  id: string;
  name: string;
  jobName: string | null;
  departmentName: string | null;
  hasPhoto: boolean;
  reports: Node[];
}

function Branch({ node }: { node: Node }) {
  return (
    <li>
      <span className="org-node">
        {node.hasPhoto && <AuthImage path={`/employees/${node.id}/photo`} alt="" className="org-photo" />}
        <span className="org-text">
          <Link href={`/employees/${node.id}`}>{node.name}</Link>
          <small className="muted">
            {[node.jobName, node.departmentName].filter(Boolean).join(" · ") || "—"}
          </small>
        </span>
      </span>
      {node.reports.length > 0 && (
        <ul>
          {node.reports.map((r) => (
            <Branch key={r.id} node={r} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Struktur organisasi dari atasan langsung karyawan aktif. */
export default function OrgChartPage() {
  const { l } = useI18n();
  const [tree, setTree] = useState<Node[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Node[]>("/hr/org-chart").then(setTree, (e) => setError(errorText(e)));
  }, []);
  return (
    <div className="panel">
      <header className="toolbar">
        <h1>{l("Struktur Organisasi", "Org Chart")}</h1>
      </header>
      <p className="muted">
        {l(
          'Disusun dari isian "Atasan" pada data karyawan aktif.',
          'Built from the "Manager" field of active employees.',
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {tree && (
        <ul className="org-tree">
          {tree.map((n) => (
            <Branch key={n.id} node={n} />
          ))}
        </ul>
      )}
    </div>
  );
}
