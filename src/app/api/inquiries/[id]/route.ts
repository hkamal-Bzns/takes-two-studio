import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * PATCH  /api/inquiries/[id]   — admin, update status (new|read|archived)
 * DELETE /api/inquiries/[id]   — admin, delete inquiry
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { status } = await req.json();
  const inquiry = await db.inquiry.update({ where: { id }, data: { status } });
  return NextResponse.json({ inquiry });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await db.inquiry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
