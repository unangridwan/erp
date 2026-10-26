"use client";

import { GoalTree } from "../../../../components/hr/ess-panels";
import { useMe } from "../../../../components/me-context";
import { useI18n } from "../../../../lib/i18n";
import { can } from "../../../../lib/resources";

/** Sasaran bertingkat (perusahaan → departemen → karyawan) dengan progres dari check-in. */
export default function GoalsPage() {
  const { l } = useI18n();
  const me = useMe();
  return (
    <section className="panel">
      <header className="toolbar">
        <h1>{l("Sasaran & KRA", "Goals & KRAs")}</h1>
      </header>
      <p className="muted">
        {l(
          "Progres sasaran induk dihitung dari rata-rata berbobot turunannya; sasaran tanpa turunan diperbarui lewat check-in.",
          "A parent goal's progress is the weighted average of its sub-goals; leaf goals are updated through check-ins.",
        )}
      </p>
      <GoalTree path="/goals" allowCreate={can(me.permissions, "hr.manage")} />
    </section>
  );
}
