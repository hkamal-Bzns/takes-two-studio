#!/bin/bash
# ============================================================
# Takes Two Studio — Post-Deploy Setup Script
# ============================================================
# Run this ONCE after your first deploy on Hostinger.
# It creates the database + seeds default settings/sections.
#
# HOW TO RUN on Hostinger:
#   1. hPanel → "Advanced" → "Terminal" (or SSH)
#   2. cd to your app directory (shown in the Deploy Web App panel)
#   3. bash setup.sh
# ============================================================

set -e

echo "=== Takes Two Studio — Setup ==="
echo ""

# 1. Install dependencies (Hostinger may do this automatically)
echo "[1/4] Installing dependencies..."
npm install

# 2. Generate Prisma client
echo "[2/4] Generating Prisma client..."
npx prisma generate

# 3. Create database tables
echo "[3/4] Creating database tables..."
npx prisma db push

# 4. Seed default settings + sections + sample clients
echo "[4/4] Seeding default data..."
node -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
async function main() {
  // sections
  const sections = [
    { key: 'overview', label: 'Overview', order: 0 },
    { key: 'advertising', label: 'Advertising', order: 1 },
    { key: 'food-beverage', label: 'Food & Beverage', order: 2 },
    { key: 'about', label: 'About', order: 3 },
    { key: 'contact', label: 'Contact Us', order: 4 },
    { key: 'clients', label: 'Clients', order: 5 },
    { key: 'bts', label: 'BTS', visible: false, order: 6 },
  ];
  for (const s of sections) {
    await db.siteSection.upsert({ where: { key: s.key }, create: { visible: true, ...s }, update: {} });
  }
  console.log('  sections: OK');

  // settings
  const settings = [
    ['heroTitle', 'Two perspectives. One frame.'],
    ['heroSubtitle', 'Takes Two Studio'],
    ['heroTag', 'Advertising & Food & Beverage — Cairo'],
    ['logo', '/brand/logo.webp'],
    ['theme', 'dark'],
    ['footerName', 'Takes Two Studio'],
    ['footerSubtitle', 'Advertising & Food & Beverage Photography'],
    ['portfolioEyebrow', 'Selected Works'],
    ['portfolioHeading', 'The full archive. Every project, one frame at a time.'],
    ['portfolioHint', 'Click any project to open its full gallery.'],
    ['advertisingHeading', 'Advertising campaigns, stills & commercials.'],
    ['foodBeverageHeading', 'Food & Beverage, appetite in every frame.'],
    ['aboutEyebrow', 'The Studio'],
    ['aboutHeading', 'About Takes Two'],
    ['aboutQuote', 'Two perspectives. One frame.'],
    ['aboutLocation', 'Cairo · Egypt'],
    ['clientsEyebrow', 'Trusted By'],
    ['clientsHeading', 'Our Clients'],
    ['clientsSubtext', 'Brands and publications we have had the privilege of creating with.'],
    ['contactEyebrow', 'Get in Touch'],
    ['contactHeading', 'For bookings & inquiries.'],
  ];
  for (const [k, v] of settings) {
    const ex = await db.siteSetting.findUnique({ where: { key: k } });
    if (!ex) await db.siteSetting.create({ data: { key: k, value: v } });
  }
  console.log('  settings: OK');

  // sample clients (only if none)
  const cc = await db.client.count();
  if (cc === 0) {
    const names = ['Vogue', \"Harper's Bazaar\", 'Chanel', 'Dior', 'Canon', 'Numéro', 'Saint Laurent', 'Elle'];
    for (let i = 0; i < names.length; i++) await db.client.create({ data: { name: names[i], order: i } });
    console.log('  clients: OK');
  } else {
    console.log('  clients: already exist, skipping');
  }
  console.log('');
  console.log('=== Setup complete! ===');
  console.log('Your site is ready. Visit your domain to see it.');
  console.log('Admin panel: https://yourdomain.com/admin (password = your ADMIN_PASSWORD env var)');
  console.log('ADMIN_PASSWORD and SESSION_SECRET must both be set, or login returns 500.');
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.\$disconnect());
"

echo ""
echo "=== Done! ==="
