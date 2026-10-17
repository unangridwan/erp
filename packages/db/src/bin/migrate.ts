import { loadEnv } from "../load-env.js";
import { migrate } from "../migrate.js";

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL belum di-set (isi di file .env)");
await migrate(url);
