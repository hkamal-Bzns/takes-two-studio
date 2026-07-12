import { redirect } from "next/navigation";

/**
 * The user-facing site is a lightning-fast single-file SPA located at
 * /public/index.html (HTML5 + Tailwind CDN + Vanilla JS). We serve it at the
 * root `/` route by redirecting to the static asset.
 */
export default function Home() {
  redirect("/index.html");
}
