/**
 * Seed the database with the existing 14 Takestwo Studio images as projects.
 * Run with: bun run seed
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("Seeding Takestwo Studio projects...");

  // Clean slate
  await db.projectImage.deleteMany();
  await db.project.deleteMany();

  const advertisingProjects = [
    { title: "Still — 01", cover: "/shoots/ad1.webp", imgs: ["/shoots/ad1.webp"] },
    { title: "Still — 02", cover: "/shoots/ad2.webp", imgs: ["/shoots/ad2.webp"] },
    { title: "Automotive", cover: "/shoots/ad3.webp", imgs: ["/shoots/ad3.webp"] },
    { title: "Still — 03", cover: "/shoots/ad4.webp", imgs: ["/shoots/ad4.webp"] },
    { title: "Still — 04", cover: "/shoots/ad5.webp", imgs: ["/shoots/ad5.webp"] },
    { title: "Still — 05", cover: "/shoots/ad6.webp", imgs: ["/shoots/ad6.webp"] },
    { title: "Still — 06", cover: "/shoots/ad7.webp", imgs: ["/shoots/ad7.webp"] },
  ];

  const foodProjects = [
    { title: "Cover Story", cover: "/shoots/fb1.jpg", imgs: ["/shoots/fb1.jpg"] },
    { title: "Dreem", cover: "/shoots/fb2.jpg", imgs: ["/shoots/fb2.jpg"] },
    { title: "Beverage — 01", cover: "/shoots/fb3.jpg", imgs: ["/shoots/fb3.jpg"] },
    { title: "Studio — 01", cover: "/shoots/fb4.jpg", imgs: ["/shoots/fb4.jpg"] },
    { title: "French Cocoa", cover: "/shoots/fb5.jpg", imgs: ["/shoots/fb5.jpg"] },
    { title: "Cover II", cover: "/shoots/fb6.jpg", imgs: ["/shoots/fb6.jpg"] },
    { title: "Editorial", cover: "/shoots/fb7.jpg", imgs: ["/shoots/fb7.jpg"] },
  ];

  let order = 0;
  for (const p of advertisingProjects) {
    const proj = await db.project.create({
      data: { title: p.title, category: "advertising", coverImage: p.cover, order: order++, published: true },
    });
    let io = 0;
    for (const url of p.imgs) {
      await db.projectImage.create({ data: { projectId: proj.id, url, order: io++ } });
    }
    console.log(`  + [advertising] ${p.title}`);
  }

  order = 0;
  for (const p of foodProjects) {
    const proj = await db.project.create({
      data: { title: p.title, category: "food-beverage", coverImage: p.cover, order: order++, published: true },
    });
    let io = 0;
    for (const url of p.imgs) {
      await db.projectImage.create({ data: { projectId: proj.id, url, order: io++ } });
    }
    console.log(`  + [food-beverage] ${p.title}`);
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
