import { NextResponse } from "next/server";

/**
 * GET /api/debug — diagnostic endpoint
 */
export async function GET() {
  const fs = require("fs");
  const path = require("path");

  const debug: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || "not set",
    databaseUrl: process.env.DATABASE_URL || "NOT SET",
    adminToken: process.env.ADMIN_TOKEN ? "SET (hidden)" : "NOT SET",
    port: process.env.PORT || "not set",
    cwd: process.cwd(),
  };

  // Check database path
  const dbUrl = process.env.DATABASE_URL || "";
  const dbPath = dbUrl.replace("file:", "").replace(/^\/\//, "");
  const dbDir = path.dirname(dbPath);

  debug.dbPath = dbPath;
  debug.dbDir = dbDir;
  debug.dbPathExists = fs.existsSync(dbPath);
  debug.dbDirExists = fs.existsSync(dbDir);

  try {
    fs.accessSync(dbDir, fs.constants.W_OK);
    debug.dbDirWritable = true;
  } catch {
    debug.dbDirWritable = false;
  }

  // List files in cwd
  try {
    debug.filesInCwd = fs.readdirSync(process.cwd()).slice(0, 20);
  } catch (e) {
    debug.filesInCwd = ["error: " + (e as Error).message];
  }

  // Check env files
  try {
    const allFiles = fs.readdirSync(process.cwd());
    debug.envFiles = allFiles.filter((f: string) => f.startsWith(".env"));
  } catch (e) {
    debug.envFiles = ["error: " + (e as Error).message];
  }

  // Try database connection
  try {
    const { PrismaClient } = require("@prisma/client");
    const db = new PrismaClient();
    const sectionCount = await db.siteSection.count();
    debug.dbConnection = "OK";
    debug.sectionCount = sectionCount;
    await db.$disconnect();
  } catch (e) {
    debug.dbConnection = "FAILED: " + (e as Error).message;
  }

  return NextResponse.json(debug, { status: 200 });
}
