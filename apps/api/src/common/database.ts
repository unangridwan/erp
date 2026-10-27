import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { createDb, withTenant, type Db } from "@erp/db";
import { pendingMigrations } from "@erp/db/migrate";
import { CONFIG, loadConfig, type AppConfig } from "../config.js";
import { currentContext } from "./request-context.js";

/** Koneksi pemilik schema. Hanya untuk operasi lintas tenant (signup, login lookup). */
export const OWNER_DB = Symbol("OWNER_DB");

@Injectable()
export class TenantDb {
  constructor(@Inject(OWNER_DB) private readonly db: Db) {}

  /** Jalankan dalam transaksi ber-RLS untuk tenant pemanggil saat ini. */
  run<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return withTenant(this.db, currentContext().tenantId, fn);
  }

  /** Jalankan untuk tenant tertentu (mis. saat login, sebelum konteks request ada). */
  runAs<T>(tenantId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, fn);
  }
}

@Injectable()
class DbLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Database");

  constructor(
    @Inject("PG_CLIENT") private readonly client: { end(): Promise<void> },
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Peringatkan bila kode lebih baru dari skema database (mis. `pnpm db:setup` belum dijalankan setelah git pull). */
  async onApplicationBootstrap() {
    const pending = await pendingMigrations(this.config.databaseUrl).catch(() => []);
    if (pending.length)
      this.logger.error(
        `Database belum dimigrasi (${pending.length} tertunda: ${pending.join(", ")}). ` +
          "Hentikan server lalu jalankan `pnpm db:setup`; tanpa itu banyak halaman akan error 500.",
      );
  }

  async onApplicationShutdown() {
    await this.client.end();
  }
}

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: "PG_HANDLE",
      inject: [CONFIG],
      useFactory: (config: AppConfig) => createDb(config.databaseUrl, { onnotice: () => {} }),
    },
    { provide: OWNER_DB, inject: ["PG_HANDLE"], useFactory: (h: ReturnType<typeof createDb>) => h.db },
    { provide: "PG_CLIENT", inject: ["PG_HANDLE"], useFactory: (h: ReturnType<typeof createDb>) => h.client },
    DbLifecycle,
    TenantDb,
  ],
  exports: [CONFIG, OWNER_DB, TenantDb],
})
export class DatabaseModule {}
