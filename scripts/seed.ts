/**
 * Seed the database with the existing 14 Takestwo Studio images as projects.
 * Run with: bun run seed
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("Seeding Takestwo Studio projects...");

  // Only seed placeholder projects if there are NONE yet (never wipe existing work)
  const existingCount = await db.project.count();
  if (existingCount > 0) {
    console.log(`Skipping project seed — ${existingCount} projects already exist (not wiping).`);
    return;
  }

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

async function seedSectionsAndClients() {
  const db = new PrismaClient();
  const sections = [
    { key: "overview", label: "Overview", order: 0 },
    { key: "advertising", label: "Advertising", order: 1 },
    { key: "food-beverage", label: "Food & Beverage", order: 2 },
    { key: "about", label: "About", order: 3 },
    { key: "contact", label: "Contact Us", order: 4 },
    { key: "clients", label: "Clients", order: 5 },
  ];
  for (const s of sections) {
    await db.siteSection.upsert({ where: { key: s.key }, create: s, update: {} });
  }
  console.log("Seeded site sections.");

  // site settings (key/value)
  const settings: { key: string; value: string }[] = [
    { key: "heroTitle", value: "Two perspectives. One frame." },
    { key: "heroSubtitle", value: "Takes Two Studio" },
    { key: "heroTag", value: "Advertising & Food & Beverage — Cairo" },
    { key: "logo", value: "/brand/logo.webp" },
    { key: "theme", value: "dark" }, // "dark" | "light"
    { key: "footerName", value: "Takes Two Studio" },
    { key: "footerSubtitle", value: "Advertising & Food & Beverage Photography" },
    // Portfolio header texts
    { key: "portfolioEyebrow", value: "Selected Works" },
    { key: "portfolioHeading", value: "The full archive. Every project, one frame at a time." },
    { key: "portfolioHint", value: "Click any project to open its full gallery." },
    { key: "advertisingHeading", value: "Advertising campaigns, stills & commercials." },
    { key: "foodBeverageHeading", value: "Food & Beverage, appetite in every frame." },
    // About page texts
    { key: "aboutEyebrow", value: "The Studio" },
    { key: "aboutHeading", value: "About Takes Two" },
    { key: "aboutBody", value: "Takes Two Studio was founded by two creative Egyptian photographers — Mohamed Medhat and Ahmed Okasha — who embarked on this artistic journey from the very beginning of their studies in the visual arts.\n\nPhotography has always been their favorite medium; they have dedicated themselves to mastering the craft since 2017. After exploring many genres, they discovered their true calling in creating compelling still visuals for advertising campaigns, television commercials, and food & beverage imagery.\n\nAs a team of two, they blend artistic perspective with technical precision — completing one another's strengths and pushing the boundaries of creativity while ensuring attention to detail in every project." },
    { key: "aboutCapabilities", value: "Advertising Campaigns, TV Commercials, Food & Beverage, Product Stills, Automotive, Beverage, Creative Direction, Post-Production" },
    { key: "aboutQuote", value: "Two perspectives. One frame." },
    { key: "aboutLocation", value: "Cairo · Egypt" },
    // Clients page texts
    { key: "clientsEyebrow", value: "Trusted By" },
    { key: "clientsHeading", value: "Our Clients" },
    { key: "clientsSubtext", value: "Brands and publications we've had the privilege of creating with." },
    // Contact page texts
    { key: "contactEyebrow", value: "Get in Touch" },
    { key: "contactHeading", value: "For bookings & inquiries." },
  ];
  for (const s of settings) {
    const existing = await db.siteSetting.findUnique({ where: { key: s.key } });
    if (!existing) {
      await db.siteSetting.create({ data: s });
    }
  }
  console.log("Seeded site settings.");

  // sample clients (only if none exist)
  const existingClients = await db.client.count();
  if (existingClients === 0) {
    const clients = ["Vogue", "Harper's Bazaar", "Chanel", "Dior", "Canon", "Numéro", "Saint Laurent", "Elle"];
    let co = 0;
    for (const name of clients) {
      await db.client.create({ data: { name, order: co++ } });
    }
    console.log("Seeded sample clients.");
  }
  await db.$disconnect();
}

async function runAll() {
  await main();
  await seedSectionsAndClients();
}

runAll()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
