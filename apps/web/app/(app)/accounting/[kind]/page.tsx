"use client";

import { notFound, useParams } from "next/navigation";
import { MoveList } from "../../../../components/accounting/move-list";
import { MOVE_KINDS, type MoveKind } from "../../../../lib/resources";

export default function MoveListPage() {
  const { kind } = useParams<{ kind: string }>();
  if (!(kind in MOVE_KINDS)) notFound();
  return <MoveList key={kind} kind={kind as MoveKind} />;
}
