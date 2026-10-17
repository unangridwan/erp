import { seedRegions } from "../seed-regions.js";
import { runWithDatabase } from "./run.js";

await runWithDatabase(async (url) => {
  console.log(`regions: ${await seedRegions(url)} baris`);
});
