import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * POST /api/inquiries   — public, create an inquiry from the contact form.
 * GET  /api/inquiries   — admin, list all inquiries (newest first).
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { firstName, lastName, phone, email, message } = body;
  if (!firstName || !lastName || !phone || !email || !message) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }
  const inquiry = await db.inquiry.create({
    data: { firstName, lastName, phone, email, message },
  });
  return NextResponse.json({ inquiry }, { status: 201 });
}

export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = req.nextUrl.searchParams.get("status");
  const where: { status?: string } = {};
  if (status) where.status = status;
  const inquiries = await db.inquiry.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ inquiries });
}
