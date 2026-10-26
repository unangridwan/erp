import { Injectable } from "@nestjs/common";
import { schema, type Db } from "@erp/db";
import { currentContext } from "../common/request-context.js";

export interface NotificationInput {
  kind: string;
  title: string;
  body?: string | null;
  /** Tautan relatif di aplikasi web, mis. `/hr/approvals`. */
  link?: string | null;
  companyId?: string;
}

/** Notifikasi in-app per user (lonceng di bilah atas). Penerima kosong/duplikat & diri sendiri diabaikan. */
@Injectable()
export class NotificationService {
  async notify(tx: Db, userIds: (string | null | undefined)[], input: NotificationInput) {
    const ctx = currentContext();
    const targets = [...new Set(userIds.filter((u): u is string => !!u && u !== ctx.userId))];
    if (!targets.length) return;
    await tx.insert(schema.notifications).values(
      targets.map((userId) => ({
        companyId: input.companyId ?? ctx.companyId,
        userId,
        kind: input.kind,
        title: input.title.slice(0, 300),
        body: input.body?.slice(0, 2000) ?? null,
        link: input.link ?? null,
      })),
    );
  }
}
