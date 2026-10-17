import { loadEnv } from "@erp/db";

// Memungkinkan `pnpm test` memakai DATABASE_URL dari .env (mis. di Windows tanpa export manual).
loadEnv();
