import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * PATCH  /api/clients/[id]   — admin, update name/logo/order
 * DELETE /api/clients/[id]   — admin, delete client
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name;
  if (typeof body.logo === "string") data.logo = body.logo || null;
  if (typeof body.order === "number") data.order = body.order;
  const client = await db.client.update({ where: { id }, data });
  return NextResponse.json({ client });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await db.client.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
