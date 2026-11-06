import { Injectable } from "@nestjs/common";
import { and, eq, inArray, schema, type Db } from "@erp/db";
import { currentContext } from "../common/request-context.js";

export interface NotificationInput {
  kind: string;
  title: string;
  body?: string | null;
  /** Tautan relatif di aplikasi web, mis. `/hr/approvals`. */
  link?: string | null;
  companyId?: string;
}

/**
 * Notifikasi in-app per user (lonceng di bilah atas) + email lewat outbox. Penerima kosong/duplikat & diri sendiri
 * diabaikan.
 */
@Injectable()
export class NotificationService {
  async notify(tx: Db, userIds: (string | null | undefined)[], input: NotificationInput) {
    const ctx = currentContext();
    const targets = [...new Set(userIds.filter((u): u is string => !!u && u !== ctx.userId))];
    if (!targets.length) return;
    // Email dikirim job pengirim setelah transaksi selesai (outbox) untuk pengguna aktif yang mengizinkan email.
    const emailable = new Set(
      (
        await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(
            and(
              inArray(schema.users.id, targets),
              eq(schema.users.active, true),
              eq(schema.users.notifyEmail, true),
              eq(schema.users.kind, "human"),
            ),
          )
      ).map((u) => u.id),
    );
    await tx.insert(schema.notifications).values(
      targets.map((userId) => ({
        emailState: emailable.has(userId) ? ("pending" as const) : null,
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
