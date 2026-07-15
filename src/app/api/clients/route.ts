import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * GET  /api/clients   — public, list clients (ordered)
 * POST /api/clients   — admin, create a client. Body: { name, logo?, order? }
 */
export async function GET() {
  const clients = await db.client.findMany({ orderBy: { order: "asc" } });
  return NextResponse.json({ clients });
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { name, logo, order } = await req.json();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const count = await db.client.count();
  const client = await db.client.create({
    data: { name, logo: logo ?? null, order: typeof order === "number" ? order : count },
  });
  return NextResponse.json({ client }, { status: 201 });
}
