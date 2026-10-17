import { loadEnv } from "../src/load-env.js";

// Memungkinkan `pnpm test` memakai DATABASE_URL dari .env (mis. di Windows tanpa export manual).
loadEnv();
