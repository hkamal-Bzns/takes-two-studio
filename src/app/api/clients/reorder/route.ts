import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * PATCH /api/clients/reorder
 *   Admin — reorders the clients grid. Body: { order: ["clientId1", ...] }
 *
 * Each client's `order` becomes its index in the array. Both `GET /api/clients`
 * and the public `GET /api/settings` already sort on that column, so the grid
 * follows with no further change.
 *
 * `updateMany` rather than `update`: an id that no longer exists matches
 * nothing and is skipped, instead of aborting the whole transaction because
 * someone deleted a client in another tab mid-drag.
 */
export async function PATCH(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { order } = await req.json();
  if (!Array.isArray(order) || order.length === 0) {
    return NextResponse.json({ error: "order array is required" }, { status: 400 });
  }
  if (!order.every((id) => typeof id === "string" && id !== "")) {
    return NextResponse.json({ error: "order must be an array of client ids" }, { status: 400 });
  }

  await db.$transaction(
    order.map((id: string, i: number) =>
      db.client.updateMany({ where: { id }, data: { order: i } })
    )
  );

  return NextResponse.json({ ok: true, count: order.length });
}
