import { migrate } from "../migrate.js";
import { runWithDatabase } from "./run.js";

await runWithDatabase(migrate);
