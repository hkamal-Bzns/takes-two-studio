/**
 * The admin route must never be prerendered or CDN-cached.
 *
 * `admin/page.tsx` is a "use client" component, so Next was free to prerender
 * it at build time and the CDN in front of the app cached that HTML with
 * `s-maxage=31536000` — a year. Only one build is kept on disk, so as soon as
 * the next deploy landed, that cached HTML pointed at chunk filenames that no
 * longer existed. The browser got 404s for its JavaScript, React never
 * hydrated, and the page sat on "Loading…" forever.
 *
 * Route segment config has to live in a server file, which a "use client" page
 * cannot be — hence this layout. `force-dynamic` makes the segment render per
 * request, so the HTML always references the build that is actually deployed.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
