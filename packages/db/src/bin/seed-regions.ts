import { loadEnv } from "../load-env.js";
import { seedRegions } from "../seed-regions.js";

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL belum di-set (isi di file .env)");
console.log(`regions: ${await seedRegions(url)} baris`);
