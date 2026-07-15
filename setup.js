/**
 * Takes Two Studio — Database Setup (uses Prisma's built-in SQLite driver)
 * ========================================================================
 * No native modules needed. Uses @prisma/client's $executeRawUnsafe to
 * create tables + seed data directly.
 *
 * Run on Hostinger:  node setup.js
 */
const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();

console.log("=== Takes Two Studio — Database Setup ===\n");

async function main() {
  // [1/3] Create all tables via raw SQL (idempotent — IF NOT EXISTS)
  console.log("[1/3] Creating database tables...");
  const statements = [
    `CREATE TABLE IF NOT EXISTS "User" ("id" TEXT PRIMARY KEY NOT NULL, "email" TEXT NOT NULL, "name" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")`,
    `CREATE TABLE IF NOT EXISTS "Project" ("id" TEXT PRIMARY KEY NOT NULL, "title" TEXT NOT NULL, "category" TEXT NOT NULL, "coverImage" TEXT NOT NULL, "description" TEXT, "order" INTEGER NOT NULL DEFAULT 0, "published" BOOLEAN NOT NULL DEFAULT true, "featured" BOOLEAN NOT NULL DEFAULT false, "overview" BOOLEAN NOT NULL DEFAULT false, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS "Project_category_idx" ON "Project"("category")`,
    `CREATE TABLE IF NOT EXISTS "ProjectImage" ("id" TEXT PRIMARY KEY NOT NULL, "projectId" TEXT NOT NULL, "url" TEXT NOT NULL, "caption" TEXT, "order" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE)`,
    `CREATE INDEX IF NOT EXISTS "ProjectImage_projectId_idx" ON "ProjectImage"("projectId")`,
    `CREATE TABLE IF NOT EXISTS "Inquiry" ("id" TEXT PRIMARY KEY NOT NULL, "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL, "phone" TEXT NOT NULL, "email" TEXT NOT NULL, "message" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'new', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS "Inquiry_status_idx" ON "Inquiry"("status")`,
    `CREATE TABLE IF NOT EXISTS "SiteSection" ("id" TEXT PRIMARY KEY NOT NULL, "key" TEXT NOT NULL, "label" TEXT NOT NULL, "visible" BOOLEAN NOT NULL DEFAULT true, "order" INTEGER NOT NULL DEFAULT 0)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "SiteSection_key_key" ON "SiteSection"("key")`,
    `CREATE TABLE IF NOT EXISTS "SiteSetting" ("key" TEXT PRIMARY KEY NOT NULL, "value" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS "Client" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "logo" TEXT, "order" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS "OverviewItem" ("id" TEXT PRIMARY KEY NOT NULL, "url" TEXT NOT NULL, "projectId" TEXT, "caption" TEXT, "order" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS "Video" ("id" TEXT PRIMARY KEY NOT NULL, "title" TEXT NOT NULL, "url" TEXT NOT NULL, "thumbnail" TEXT, "description" TEXT, "category" TEXT NOT NULL DEFAULT 'bts', "published" BOOLEAN NOT NULL DEFAULT true, "order" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  ];
  for (const sql of statements) {
    await db.$executeRawUnsafe(sql);
  }
  console.log("  ✓ All tables created");

  // [2/3] Seed sections
  console.log("\n[2/3] Seeding sections...");
  const sections = [
    { key: "overview", label: "Overview", visible: true, order: 0 },
    { key: "advertising", label: "Advertising", visible: true, order: 1 },
    { key: "food-beverage", label: "Food & Beverage", visible: true, order: 2 },
    { key: "about", label: "About", visible: true, order: 3 },
    { key: "contact", label: "Contact Us", visible: true, order: 4 },
    { key: "clients", label: "Clients", visible: true, order: 5 },
    { key: "bts", label: "BTS", visible: false, order: 6 },
  ];
  for (const s of sections) {
    const existing = await db.siteSection.findUnique({ where: { key: s.key } });
    if (!existing) {
      await db.siteSection.create({ data: s });
    }
  }
  console.log("  ✓ Sections seeded");

  // [3/3] Seed settings + clients
  console.log("\n[3/3] Seeding settings + clients...");
  const settings = [
    ["heroTitle", "Two perspectives. One frame."],
    ["heroSubtitle", "Takes Two Studio"],
    ["heroTag", "Advertising & Food & Beverage — Cairo"],
    ["logo", "/brand/logo.webp"],
    ["theme", "dark"],
    ["footerName", "Takes Two Studio"],
    ["footerSubtitle", "Advertising & Food & Beverage Photography"],
    ["portfolioEyebrow", "Selected Works"],
    ["portfolioHeading", "The full archive. Every project, one frame at a time."],
    ["portfolioHint", "Click any project to open its full gallery."],
    ["advertisingHeading", "Advertising campaigns, stills & commercials."],
    ["foodBeverageHeading", "Food & Beverage, appetite in every frame."],
    ["aboutEyebrow", "The Studio"],
    ["aboutHeading", "About Takes Two"],
    ["aboutBody", "Takes Two Studio was founded by two creative Egyptian photographers — Mohamed Medhat and Ahmed Okasha — who embarked on this artistic journey from the very beginning of their studies in the visual arts.\n\nPhotography has always been their favorite medium; they have dedicated themselves to mastering the craft since 2017. After exploring many genres, they discovered their true calling in creating compelling still visuals for advertising campaigns, television commercials, and food & beverage imagery.\n\nAs a team of two, they blend artistic perspective with technical precision — completing one another's strengths and pushing the boundaries of creativity while ensuring attention to detail in every project."],
    ["aboutCapabilities", "Advertising Campaigns, TV Commercials, Food & Beverage, Product Stills, Automotive, Beverage, Creative Direction, Post-Production"],
    ["aboutQuote", "Two perspectives. One frame."],
    ["aboutLocation", "Cairo · Egypt"],
    ["clientsEyebrow", "Trusted By"],
    ["clientsHeading", "Our Clients"],
    ["clientsSubtext", "Brands and publications we have had the privilege of creating with."],
    ["contactEyebrow", "Get in Touch"],
    ["contactHeading", "For bookings & inquiries."],
  ];
  for (const [key, value] of settings) {
    const existing = await db.siteSetting.findUnique({ where: { key } });
    if (!existing) {
      await db.siteSetting.create({ data: { key, value } });
    }
  }
  console.log("  ✓ Settings seeded");

  const clientCount = await db.client.count();
  if (clientCount === 0) {
    const names = ["Vogue", "Harper's Bazaar", "Chanel", "Dior", "Canon", "Numéro", "Saint Laurent", "Elle"];
    for (let i = 0; i < names.length; i++) {
      await db.client.create({ data: { name: names[i], order: i } });
    }
    console.log("  ✓ Sample clients seeded");
  } else {
    console.log("  ✓ Clients already exist");
  }

  console.log("\n=== Setup complete! ===");
  console.log("Admin: https://takes.takestwostudio.com/admin");
}

main()
  .catch((e) => { console.error("Setup failed:", e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
