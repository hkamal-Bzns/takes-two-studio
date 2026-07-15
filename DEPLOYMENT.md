# Deploying Takes Two Studio on Hostinger

A step-by-step guide for first-time deployment via Hostinger's "Deploy Web App" feature.

---

## Before You Start

You'll need:
- A **GitHub account** (free)
- Your **Hostinger hosting plan** with "Deploy Web App" (Node.js) support
- Your domain `takestwostudio.com` connected to Hostinger

---

## Step 1: Put Your Code on GitHub

### 1.1 Create a GitHub repository
1. Go to [github.com](https://github.com) → sign in
2. Click the **"+"** icon (top right) → **"New repository"**
3. Name it: `takes-two-studio`
4. Set it to **Private** (recommended — your code + images)
5. Click **"Create repository"**

### 1.2 Push your code to GitHub
On your computer, open a terminal in the project folder and run:

```bash
# Initialize git (if not already)
git init
git add -A
git commit -m "Takes Two Studio website"

# Connect to your GitHub repo
git branch -M main
git remote add origin https://github.com/YOURUSERNAME/takes-two-studio.git
git push -u origin main
```

> **Note:** The `.gitignore` I created excludes `node_modules/`, `.next/`, and `db/custom.db` — these should NOT be on GitHub (they're generated on the server). Your `public/shoots/` images ARE included.

---

## Step 2: Deploy on Hostinger

### 2.1 Open the Deploy Web App panel
1. Log in to **hPanel** (Hostinger control panel)
2. Find **"Deploy Web App"** (the option with the Node.js icon, shown in your screenshot)
3. Click **"Create App"**

### 2.2 Connect GitHub
1. Choose **"Deploy from GitHub"**
2. Click **"Authorize"** to let Hostinger access your GitHub
3. Select your `takes-two-studio` repository
4. Branch: `main`

### 2.3 Configure the app
Set these settings:

| Setting | Value |
|---------|-------|
| **App name** | `takes-two-studio` |
| **Node.js version** | `20.x` (or the latest available) |
| **Build command** | `npm run build` |
| **Start command** | `npm run start` |
| **Port** | `3000` (Hostinger usually auto-detects) |

### 2.4 Add Environment Variables
In the "Environment Variables" section, add:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `file:/home/YOUR_HOME_PATH/domains/takestwostudio.com/db/custom.db` |
| `ADMIN_TOKEN` | `choose-a-strong-password-here` |
| `NODE_ENV` | `production` |

> **Finding your home path:** hPanel → "Advanced" → "Terminal" → type `echo $HOME` → use that path. Example: `/home/u123456789/domains/takestwostudio.com/db/custom.db`

### 2.5 Deploy
Click **"Deploy"** or **"Create"**. Hostinger will:
1. Clone your repo
2. Run `npm install` (installs dependencies + auto-runs `prisma generate`)
3. Run `npm run build` (builds the Next.js app)
4. Start the app with `npm run start`

This takes 3-5 minutes. You'll see a progress log.

---

## Step 3: Set Up the Database (ONE TIME ONLY)

After the first deploy, you need to create the database tables + seed default data.

### 3.1 Open Terminal
hPanel → **"Advanced"** → **"Terminal"** (or use SSH)

### 3.2 Navigate to your app
```bash
cd /home/YOUR_HOME_PATH/domains/takestwostudio.com/app
# (the exact path is shown in your Deploy Web App panel)
```

### 3.3 Run the setup script
```bash
bash setup.sh
```

This will:
- Create all database tables (projects, images, inquiries, settings, etc.)
- Seed default settings (nav sections, hero text, etc.)
- Seed sample clients

You should see `=== Setup complete! ===` when done.

---

## Step 4: Connect Your Domain + SSL

### 4.1 Domain
Your domain `takestwostudio.com` should auto-connect to the app. If not:
- hPanel → **Domains** → make sure `takestwostudio.com` is added
- The Deploy Web App panel lets you assign the domain to your app

### 4.2 SSL (free HTTPS)
1. hPanel → **SSL** (or "Security" → "SSL")
2. Select your domain
3. Click **"Install SSL"** (Let's Encrypt — free, auto-renews)

---

## Step 5: Test Your Live Site

1. Visit `https://takestwostudio.com` — you should see your site
2. Visit `https://takestwostudio.com/admin` — log in with your `ADMIN_TOKEN` password
3. Check that images load (your `public/shoots/` images are included in the repo)

---

## Importing Your Projects (After Deploy)

Your projects (advertising + F&B) are stored in the database, which is created fresh on the server. To import your 110 projects:

### Option A: Re-run the import
In the server terminal:
```bash
# The seed script won't wipe existing projects (safe)
node scripts/seed.js
```

### Option B: Use the admin panel
1. Go to `https://takestwostudio.com/admin` → Projects → Bulk Import
2. Upload images in batches

### Option C: Export from local DB + import to server
```bash
# On your local machine:
sqlite3 db/custom.db ".dump Project ProjectImage" > projects.sql

# Upload projects.sql to the server, then:
sqlite3 /path/to/server/custom.db < projects.sql
```

---

## Troubleshooting

### "Application Error" or blank page
- Check the Deploy Web App panel → **Logs** for error messages
- Common cause: `DATABASE_URL` path is wrong → fix it in Environment Variables

### Images not showing
- Make sure `public/shoots/` was pushed to GitHub (check your repo)
- If not, upload via hPanel → File Manager → `public/shoots/`

### Admin panel won't let me log in
- Check that `ADMIN_TOKEN` is set correctly in Environment Variables
- The password is whatever you set as `ADMIN_TOKEN`

### Database resets on every deploy
- This happens if `DATABASE_URL` points to a path inside the app folder (which gets overwritten on deploy)
- Fix: use an ABSOLUTE path OUTSIDE the app folder (e.g., `/home/u123/domains/takestwostudio.com/db/custom.db`)
- Create the `db` folder manually: `mkdir -p /home/u123/domains/takestwostudio.com/db`

---

## Quick Reference

| What | Where |
|------|-------|
| Admin panel | `https://takestwostudio.com/admin` |
| Admin password | The value of `ADMIN_TOKEN` env var |
| App logs | hPanel → Deploy Web App → Logs |
| File manager | hPanel → File Manager |
| Terminal | hPanel → Advanced → Terminal |
| Database file | The path in `DATABASE_URL` |
| Your code | GitHub repo `takes-two-studio` |

---

## Need Help?
If you get stuck at any step, tell me:
1. Which step you're on
2. What error message you see (if any)
3. A screenshot of the Hostinger panel

I'll guide you through it!
