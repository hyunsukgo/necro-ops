import type { Config } from "drizzle-kit";
import path from "path";

const dbUrl = process.env["DATABASE_URL"] ?? "./necro-ops.db";
const dbPath = path.isAbsolute(dbUrl)
  ? dbUrl
  : path.resolve(process.cwd(), dbUrl);

const config: Config = {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
  verbose: true,
  strict: true,
};

export default config;
