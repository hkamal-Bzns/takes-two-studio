import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * PATCH /api/projects/reorder
 *   Admin — reorders projects *within one category*.
 *   Body: { category: "advertising", order: ["projectId1", "projectId2", ...] }
 *
 * Each project's `order` is set to its index in the array, so the two
 * categories keep independent 0..n-1 sequences. `GET /api/projects` sorts on
 * `order` already, so the public site picks this up with no further work.
 *
 * `updateMany` scoped on both id AND category is deliberate: an id belonging to
 * the other category matches nothing and is skipped, rather than being written
 * across categories. A malformed payload therefore cannot scramble the list it
 * was not addressing.
 *
 * Note this renumbers every id it is given to a dense 0..n-1 run. Where the
 * existing data holds duplicate `order` values, the first reorder of a category
 * settles them permanently — projects that were tied may move once.
 */
export async function PATCH(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { category, order } = await req.json();

  if (typeof category !== "string" || category.trim() === "") {
    return NextResponse.json({ error: "category is required" }, { status: 400 });
  }
  if (!Array.isArray(order) || order.length === 0) {
    return NextResponse.json({ error: "order array is required" }, { status: 400 });
  }
  if (!order.every((id) => typeof id === "string" && id !== "")) {
    return NextResponse.json({ error: "order must be an array of project ids" }, { status: 400 });
  }

  await db.$transaction(
    order.map((id: string, i: number) =>
      db.project.updateMany({ where: { id, category }, data: { order: i } })
    )
  );

  return NextResponse.json({ ok: true, category, count: order.length });
}
