"use client";

import { useState, useEffect, useRef } from "react";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, TouchSensor, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* =================================================================
   Takestwo Studio — Admin Panel
   Login + Project management (create/edit/delete, upload images)
   + Inquiry inbox. Single client component.
   ================================================================= */

/**
 * Derivative metadata from the image pipeline. Null on everything uploaded
 * before it existed — readers fall back to the plain url in that case.
 */
type Derivatives = {
  srcsetAvif?: string | null;
  srcsetWebp?: string | null;
  width?: number | null;
  height?: number | null;
};
type Image = {
  id: string;
  url: string;
  caption: string | null;
  order: number;
  /** The untouched upload, when one exists. Null for images that arrived as
   *  pre-built derivatives — an original cannot be recovered from those. */
  masterUrl?: string | null;
  masterBytes?: number | null;
  /** "Sharpest": serve the original at full size in the zoomed lightbox. */
  useMaster?: boolean;
  /** Colour space of the master: "srgb", "untagged", "cmyk", or a profile name.
   *  Null until measured — unknown is not the same as verified sRGB. */
  masterSpace?: string | null;
  /** Belongs to the cover, not the gallery. Shown here so an original can be
   *  attached later, but hidden from the public site and the Overview picker. */
  coverOnly?: boolean;
} & Derivatives;

/** Colour-space labels the admin leaves alone.
 *  Deliberately a local copy rather than an import from `@/lib/images`: that
 *  module pulls in sharp, which must never reach the browser bundle. It mirrors
 *  `colourSpaceIsSafe` there — a null means "not measured yet", which is not a
 *  finding and must not raise a warning. */
function spaceIsSafe(space?: string | null): boolean {
  return !space || space === "srgb" || space === "untagged";
}

/** Human-readable file size for the admin, e.g. "7.2 MB". */
function fmtBytes(n?: number | null): string {
  if (!n || n <= 0) return "—";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
type Project = {
  id: string;
  title: string;
  category: string;
  coverImage: string;
  description: string | null;
  order: number;
  published: boolean;
  featured: boolean;
  overview: boolean;
  createdAt: string;
  images: Image[];
} & Derivatives;
type Inquiry = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  message: string;
  status: string;
  createdAt: string;
};
type SiteSection = {
  id: string;
  key: string;
  label: string;
  visible: boolean;
  order: number;
};
type Client = {
  id: string;
  name: string;
  logo: string | null;
  order: number;
};
/**
 * GET /api/overview enriches each row with the derivatives of whatever image
 * the url points at, so the client can tell a sharp pick from a legacy one.
 * Null srcsetAvif means no derivatives were found — the plain url is rendered.
 */
type OverviewItem = {
  id: string;
  url: string;
  projectId: string | null;
  caption: string | null;
  order: number;
} & Derivatives;

const API = (p: string) => `/api${p}`;

/**
 * Narrowest rung of a srcset, for admin thumbnails.
 *
 * Every image here is drawn at 80-120px, but `url` points at the widest
 * derivative (3200.webp) because that is what the public site and the lightbox
 * want. Rendering the wide one meant the project list alone pulled ~36 MB
 * across ~110 covers to paint 80x80 squares, which is enough to hang the tab.
 *
 * Falls back to the given url when there is no srcset — pre-pipeline images
 * have none, and they are small anyway.
 */
function thumbUrl(url: string, ...srcsets: (string | null | undefined)[]): string {
  for (const set of srcsets) {
    if (!set) continue;
    let best: { u: string; w: number } | null = null;
    for (const part of set.split(",")) {
      const m = part.trim().match(/^(\S+)\s+(\d+)w$/);
      if (m && (!best || Number(m[2]) < best.w)) best = { u: m[1], w: Number(m[2]) };
    }
    if (best) return best.u;
  }
  return url;
}

/** The two portfolio categories, each ordered independently. */
const CATEGORIES = [
  { key: "advertising", label: "Advertising" },
  { key: "food-beverage", label: "Food & Beverage" },
] as const;

/**
 * POST /api/upload used to return { url, filename }. It now returns a manifest
 * describing the stored master and its AVIF/WebP derivatives.
 */
type UploadManifest = {
  id: string;
  master: { url: string; width: number; height: number; bytes: number; format: string };
  srcset: { avif: string; webp: string };
  fallback: string;
  aspectRatio: number;
};

type Uploaded = { url: string } & Required<Derivatives>;

/**
 * Flatten a manifest into the shape the project/image APIs persist.
 *
 * `url` is the widest WebP derivative, not the master — masters are never
 * served to browsers. Anything that only reads `url` keeps working unchanged,
 * which is what lets the public site stay untouched for now.
 */
function fromManifest(j: UploadManifest): Uploaded {
  return {
    url: j?.fallback || j?.master?.url || "",
    srcsetAvif: j?.srcset?.avif || null,
    srcsetWebp: j?.srcset?.webp || null,
    width: j?.master?.width ?? null,
    height: j?.master?.height ?? null,
  };
}

/** Read an upload response, surfacing the API's error message when it failed. */
async function postUpload(file: File): Promise<Uploaded | null> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(API("/upload"), { method: "POST", body: fd });
  if (!r.ok) {
    const msg = await r.json().then(j => j?.error).catch(() => null);
    alert(`Upload failed for ${file.name}: ${msg || r.status}`);
    return null;
  }
  return fromManifest(await r.json());
}

/**
 * Attach an already-uploaded manifest to a project row.
 *
 * `order` is passed explicitly: the route defaults it to 0, so omitting it —
 * as this call used to — left every gallery image tied on 0 and the on-screen
 * order down to whatever SQLite returned.
 *
 * Returns false rather than throwing so callers can report which images
 * failed and keep the rest.
 */
async function attachImage(projectId: string, u: Uploaded, order: number): Promise<boolean> {
  const r = await fetch(API(`/projects/${projectId}/images`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...u, order }),
  });
  return r.ok;
}

/**
 * Gallery images picked before the project exists are uploaded straight away
 * — /api/upload needs no project id — and held client-side until Create
 * produces a row to attach them to. They wear a prefixed temporary id so the
 * grid, drag-to-reorder and remove all work on them unchanged, and so nothing
 * ever sends one of these ids to the server.
 */
const STAGED_PREFIX = "staged:";
const isStaged = (id: string) => id.startsWith(STAGED_PREFIX);

function toStaged(u: Uploaded): Image {
  return {
    id: `${STAGED_PREFIX}${Math.random().toString(36).slice(2, 10)}`,
    caption: null,
    order: 0,
    ...u,
  };
}

/** Widen a staged row back to the manifest shape the images API persists. */
function toManifest(img: Image): Uploaded {
  return {
    url: img.url,
    srcsetAvif: img.srcsetAvif ?? null,
    srcsetWebp: img.srcsetWebp ?? null,
    width: img.width ?? null,
    height: img.height ?? null,
  };
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"projects" | "overview" | "inquiries" | "settings" | "clients" | "site">("projects");

  // check existing session
  useEffect(() => {
    fetch(API("/auth/login")).then(r => r.json()).then(j => setAuthed(j.admin === true));
  }, []);

  if (authed === null) {
    return <Shell><p className="text-white/50">Loading…</p></Shell>;
  }
  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }
  return (
    <Shell>
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-3xl text-white">Takestwo Studio</h1>
          <p className="text-[11px] tracking-[0.3em] uppercase text-white/40 mt-1">Admin Panel</p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-[11px] tracking-[0.2em] uppercase text-white/60 hover:text-white border border-white/20 px-4 py-2">View Site →</a>
          <button onClick={() => { fetch(API("/auth/logout"), { method: "POST" }).then(() => setAuthed(false)); }} className="text-[11px] tracking-[0.2em] uppercase text-white/60 hover:text-white">Logout</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-8 border-b border-white/10 flex-wrap">
        <TabBtn active={tab === "projects"} onClick={() => setTab("projects")}>Projects</TabBtn>
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabBtn>
        <TabBtn active={tab === "inquiries"} onClick={() => setTab("inquiries")}>Inquiries</TabBtn>
        <TabBtn active={tab === "site"} onClick={() => setTab("site")}>Site</TabBtn>
        <TabBtn active={tab === "settings"} onClick={() => setTab("settings")}>Settings</TabBtn>
        <TabBtn active={tab === "clients"} onClick={() => setTab("clients")}>Clients</TabBtn>
      </div>

      {tab === "projects" ? <ProjectsTab /> : tab === "overview" ? <OverviewTab /> : tab === "inquiries" ? <InquiriesTab /> : tab === "site" ? <SiteTab /> : tab === "settings" ? <SettingsTab /> : <ClientsTab />}
    </Shell>
  );
}

/* ---------------- Shell ---------------- */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-10">{children}</div>
    </div>
  );
}

/* ---------------- Login ---------------- */
function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const r = await fetch(API("/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (r.ok) onLogin();
    else setError("Invalid password");
  }

  return (
    <Shell>
      <div className="max-w-sm mx-auto pt-20">
        <div className="text-center mb-10">
          <img src="/brand/logo.webp" alt="Takestwo Studio" className="h-10 w-auto mx-auto mb-6" style={{ filter: "invert(1) brightness(2)" }} />
          <h1 className="font-serif text-2xl">Admin Login</h1>
        </div>
        <form onSubmit={submit} className="space-y-6">
          <div>
            <label className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full bg-transparent border-b border-white/20 pb-3 text-white focus:outline-none focus:border-white transition-colors" required />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full border border-white/30 py-3 text-[11px] tracking-[0.3em] uppercase hover:bg-white hover:text-black transition-colors disabled:opacity-50">
            {loading ? "…" : "Enter"}
          </button>
        </form>
      </div>
    </Shell>
  );
}

/* ---------------- Tab Button ---------------- */
function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-5 py-3 text-[11px] tracking-[0.2em] uppercase border-b-2 transition-colors ${active ? "border-white text-white" : "border-transparent text-white/40 hover:text-white/70"}`}>
      {children}
    </button>
  );
}

/* ---------------- Projects Tab ---------------- */
function ProjectsTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [bulkMode, setBulkMode] = useState(false);

  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      // includeUnpublished so drafts stay reachable here — they are hidden from
      // the public site but must remain editable and orderable.
      const r = await fetch(API("/projects?category=all&includeUnpublished=1"), { cache: "no-store" });
      const j = await r.json();
      setProjects(j.projects || []);
      setLoading(false);
    };
    refreshRef.current = load;
    load();
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  /**
   * Reorder within one category. The two categories keep independent
   * sequences, so only the dragged category's ids are sent.
   */
  async function reorderCategory(category: string, ids: string[]) {
    // Optimistic: splice the new sequence back into the full list so the other
    // category's rows keep their existing positions on screen.
    setProjects(prev => {
      const rank = new Map(ids.map((id, i) => [id, i]));
      return prev.map(p => (rank.has(p.id) ? { ...p, order: rank.get(p.id)! } : p));
    });
    const r = await fetch(API("/projects/reorder"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, order: ids }),
    });
    if (!r.ok) {
      alert("Could not save the new order.");
    }
    refreshRef.current();
  }

  async function remove(id: string) {
    if (!confirm("Delete this project and all its images?")) return;
    await fetch(API(`/projects/${id}`), { method: "DELETE" });
    refreshRef.current();
  }

  async function toggleFeatured(p: Project) {
    await fetch(API(`/projects/${p.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured: !p.featured }),
    });
    refreshRef.current();
  }

  async function toggleOverview(p: Project) {
    await fetch(API(`/projects/${p.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overview: !p.overview }),
    });
    refreshRef.current();
  }

  if (editing) {
    return <ProjectEditor project={editing === "new" ? null : editing} onClose={() => { setEditing(null); refreshRef.current(); }} />;
  }
  if (bulkMode) {
    return <BulkImport onClose={() => setBulkMode(false)} onDone={() => { setBulkMode(false); refreshRef.current(); }} />;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <p className="text-[10px] tracking-[0.3em] uppercase text-white/40">{projects.length} Projects</p>
        <div className="flex gap-3">
          <button onClick={() => setBulkMode(true)}
            className="text-[11px] tracking-[0.2em] uppercase border border-white/20 px-4 py-2 text-white/70 hover:text-white hover:border-white/50 transition-colors">
            Bulk Import
          </button>
          <button onClick={() => setEditing("new")}
            className="text-[11px] tracking-[0.2em] uppercase border border-white/30 px-4 py-2 hover:bg-white hover:text-black transition-colors">
            + New Project
          </button>
        </div>
      </div>

      {loading ? <p className="text-white/50">Loading…</p> : (
        <div className="flex flex-col gap-10">
          {CATEGORIES.map(cat => {
            const inCat = projects
              .filter(p => p.category === cat.key)
              .sort((a, b) => a.order - b.order);
            if (inCat.length === 0) return null;
            // How many projects sit on a position shared with another — not the
            // count of duplicate values, which reads as one project too few.
            const perOrder = new Map<number, number>();
            for (const p of inCat) perOrder.set(p.order, (perOrder.get(p.order) ?? 0) + 1);
            const tied = inCat.filter(p => (perOrder.get(p.order) ?? 0) > 1).length;
            return (
              <section key={cat.key}>
                <div className="flex items-baseline gap-3 mb-3 flex-wrap border-b border-white/10 pb-2">
                  <h3 className="font-serif text-xl">{cat.label}</h3>
                  <span className="text-[10px] tracking-[0.2em] uppercase text-white/40">
                    {inCat.length} · drag ⠿ to reorder (top = first on site)
                  </span>
                  {tied > 0 && (
                    <span className="text-amber-400/90 text-xs">
                      {tied} projects share a position — the first drag here renumbers this category cleanly,
                      so some may settle into place once.
                    </span>
                  )}
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e: DragEndEvent) => {
                    const { active, over } = e;
                    if (!over || active.id === over.id) return;
                    const oldIndex = inCat.findIndex(p => p.id === active.id);
                    const newIndex = inCat.findIndex(p => p.id === over.id);
                    if (oldIndex < 0 || newIndex < 0) return;
                    reorderCategory(cat.key, arrayMove(inCat, oldIndex, newIndex).map(p => p.id));
                  }}
                >
                  <SortableContext items={inCat.map(p => p.id)} strategy={rectSortingStrategy}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {inCat.map((p, i) => (
                        <SortableProjectCard
                          key={p.id}
                          p={p}
                          index={i}
                          onEdit={() => setEditing(p)}
                          onRemove={remove}
                          onToggleOverview={toggleOverview}
                          onToggleFeatured={toggleFeatured}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </section>
            );
          })}
        </div>
      )}
      {!loading && projects.length === 0 && (
        <p className="text-white/50">No projects yet. Click “New Project” to add one.</p>
      )}
    </div>
  );
}

/* Project card, draggable by its ⠿ grip.
   The grip carries the dnd-kit listeners rather than the whole card: this card
   holds four buttons and dragging from anywhere would swallow their clicks. */
function SortableProjectCard({ p, index, onEdit, onRemove, onToggleOverview, onToggleFeatured }: {
  p: Project;
  index: number;
  onEdit: () => void;
  onRemove: (id: string) => void;
  onToggleOverview: (p: Project) => void;
  onToggleFeatured: (p: Project) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
  };
  const border = p.overview
    ? "border-sky-400/40 bg-sky-400/5"
    : p.featured
      ? "border-yellow-400/40 bg-yellow-400/5"
      : "border-white/10";
  return (
    <div ref={setNodeRef} style={style} className={`border p-4 flex gap-3 ${border} ${!p.published ? "opacity-60" : ""}`}>
      <button
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${p.title}`}
        title="Drag to reorder"
        className="flex-shrink-0 self-stretch px-1 text-white/30 hover:text-white/80 cursor-grab active:cursor-grabbing touch-none"
      >⠿</button>
      <span className="flex-shrink-0 self-start text-[10px] text-white/30 font-mono pt-1 w-6 text-right">{String(index + 1).padStart(2, "0")}</span>
      <img src={thumbUrl(p.coverImage, p.srcsetWebp, p.srcsetAvif)} alt={p.title} loading="lazy" decoding="async" width={80} height={80} className="w-20 h-20 object-cover flex-shrink-0 bg-white/5" draggable={false} />
      <div className="flex-1 min-w-0">
        <h3 className="font-serif text-lg truncate flex items-center gap-2 flex-wrap">
          {p.title}
          {!p.published && <span className="text-white/60 text-[9px] tracking-[0.2em] uppercase border border-white/30 px-1.5 py-0.5">Draft</span>}
          {p.overview && <span className="text-sky-400 text-[9px] tracking-[0.2em] uppercase border border-sky-400/40 px-1.5 py-0.5">Overview</span>}
          {p.featured && <span className="text-yellow-400 text-[9px] tracking-[0.2em] uppercase border border-yellow-400/40 px-1.5 py-0.5">★ Slideshow</span>}
        </h3>
        <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 mt-1">
          {p.category} · {p.images.length} img{p.images.length !== 1 ? "s" : ""} · {p.published ? "Published" : "Draft"}
        </p>
        <div className="flex gap-3 mt-3 flex-wrap">
          <button onClick={onEdit} className="text-[10px] tracking-[0.2em] uppercase text-white/70 hover:text-white">Edit</button>
          <button onClick={() => onToggleOverview(p)} className={`text-[10px] tracking-[0.2em] uppercase ${p.overview ? "text-sky-400" : "text-white/50 hover:text-sky-400"}`}>
            {p.overview ? "◆ On Overview" : "◇ Add to Overview"}
          </button>
          <button onClick={() => onToggleFeatured(p)} className={`text-[10px] tracking-[0.2em] uppercase ${p.featured ? "text-yellow-400" : "text-white/50 hover:text-yellow-400"}`}>
            {p.featured ? "★ Slideshow" : "☆ Add to slideshow"}
          </button>
          <button onClick={() => onRemove(p.id)} className="text-[10px] tracking-[0.2em] uppercase text-red-400/70 hover:text-red-400">Delete</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Overview Tab (curate + reorder homepage images) ---------------- */
function OverviewTab() {
  const [items, setItems] = useState<OverviewItem[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  // Defaults on: picking a pre-pipeline image is almost always a mistake, so
  // they are hidden until asked for rather than merely marked.
  const [sharpOnly, setSharpOnly] = useState(true);
  const refreshRef = useRef<() => void>(() => {});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [or, pr] = await Promise.all([
        fetch(API("/overview"), { cache: "no-store" }).then(r => r.json()),
        fetch(API("/projects?category=all"), { cache: "no-store" }).then(r => r.json()),
      ]);
      setItems(or.items || []);
      setAllProjects(pr.projects || []);
      setLoading(false);
    };
    refreshRef.current = load;
    load();
  }, []);

  async function addImage(url: string, projectId: string | null, caption: string | null) {
    await fetch(API("/overview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, projectId, caption }),
    });
    refreshRef.current();
  }

  async function removeItem(id: string) {
    await fetch(API(`/overview/${id}`), { method: "DELETE" });
    refreshRef.current();
  }

  async function linkProject(id: string, projectId: string | null) {
    await fetch(API(`/overview/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    refreshRef.current();
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex(i => i.id === active.id);
    const newIndex = items.findIndex(i => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    await fetch(API("/overview/reorder"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map(i => i.id) }),
    });
  }

  // build a flat list of all available images (cover + gallery) for the picker.
  // `sharp` marks an image that came through the pipeline: it has derivatives,
  // so the grid can serve a responsive srcset instead of one flat file. Images
  // predating the pipeline carry null srcsets and render at whatever size they
  // happen to be — fine as a fallback, but not what you want to pick fresh.
  // `thumb` is the narrowest rung: this picker can list 500+ images, and at the
  // widest derivative that is hundreds of MB to draw a grid of squares.
  const allImages: {
    url: string; thumb: string; projectId: string; title: string; category: string; sharp: boolean;
  }[] = [];
  for (const p of allProjects) {
    // A cover-only cover is a picture the studio never chose to exhibit, so it
    // is not on offer here either — the Overview is the most prominent surface
    // on the site. It stays visible in the project editor.
    const coverIsCoverOnly = p.images.some(i => i.url === p.coverImage && i.coverOnly);
    if (!coverIsCoverOnly) {
      allImages.push({
        url: p.coverImage, thumb: thumbUrl(p.coverImage, p.srcsetWebp, p.srcsetAvif),
        projectId: p.id, title: p.title, category: p.category, sharp: !!p.srcsetAvif,
      });
    }
    for (const img of p.images) {
      if (img.url !== p.coverImage && !img.coverOnly) {
        allImages.push({
          url: img.url, thumb: thumbUrl(img.url, img.srcsetWebp, img.srcsetAvif),
          projectId: p.id, title: p.title, category: p.category, sharp: !!img.srcsetAvif,
        });
      }
    }
  }
  const itemUrls = new Set(items.map(i => i.url));
  const lowResAvailable = allImages.filter(a => !a.sharp).length;
  const byText = pickerFilter
    ? allImages.filter(a => a.title.toLowerCase().includes(pickerFilter.toLowerCase()) || a.category.includes(pickerFilter.toLowerCase()))
    : allImages;
  const filtered = sharpOnly ? byText.filter(a => a.sharp) : byText;

  // Items already in the grid that have no derivatives — worth replacing.
  const lowResItems = items.filter(i => !i.srcsetAvif);

  if (loading) return <p className="text-white/50">Loading…</p>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <div>
          <p className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">{items.length} Images</p>
          <h2 className="font-serif text-2xl">Overview Homepage</h2>
          <p className="text-white/50 text-sm mt-2 max-w-lg">Curate the images shown on the Overview homepage grid. Add any image from any project, then drag to reorder.</p>
        </div>
        <button onClick={() => setShowPicker(s => !s)}
          className="text-[11px] tracking-[0.2em] uppercase border border-white/30 px-4 py-2 hover:bg-white hover:text-black transition-colors">
          {showPicker ? "Close Picker" : "+ Add Images"}
        </button>
      </div>

      {/* Image picker */}
      {showPicker && (
        <div className="border border-white/10 p-4 mb-8">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <input value={pickerFilter} onChange={e => setPickerFilter(e.target.value)} placeholder="Filter by project title or category…" className="flex-1 min-w-[200px] bg-transparent border-b border-white/15 pb-1 text-white text-sm focus:outline-none focus:border-white" />
            <label className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase cursor-pointer select-none">
              <input type="checkbox" checked={sharpOnly} onChange={e => setSharpOnly(e.target.checked)} className="w-4 h-4" />
              <span className={sharpOnly ? "text-emerald-400" : "text-white/50"}>Sharp only</span>
            </label>
            <span className="text-[10px] tracking-[0.2em] uppercase text-white/40">{filtered.length} available</span>
          </div>
          {sharpOnly && lowResAvailable > 0 && (
            <p className="text-white/40 text-xs mb-3">
              {lowResAvailable} low-resolution image{lowResAvailable === 1 ? "" : "s"} hidden — these predate the image
              pipeline and have no responsive derivatives. Untick “Sharp only” to show them.
            </p>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-[400px] overflow-y-auto">
            {filtered.map((img, i) => {
              const added = itemUrls.has(img.url);
              return (
                <button
                  key={img.projectId + img.url + i}
                  disabled={added}
                  onClick={() => addImage(img.url, img.projectId, img.title)}
                  className={`relative group aspect-square overflow-hidden border ${added ? "border-green-400/40 opacity-40 cursor-not-allowed" : "border-white/10 hover:border-white/50 cursor-pointer"}`}
                  title={img.title}
                >
                  <img src={img.thumb} alt={img.title} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  {!img.sharp && (
                    <span className="absolute top-0 left-0 bg-amber-500/90 text-black text-[8px] px-1 py-0.5 tracking-wide" title="No responsive derivatives — predates the image pipeline">Low-res</span>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[8px] px-1 py-0.5 truncate">{img.title}</span>
                  {added ? (
                    <span className="absolute inset-0 flex items-center justify-center text-green-400 text-xs">✓ Added</span>
                  ) : (
                    <span className="absolute inset-0 bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">+ Add</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Current overview items (drag to reorder) */}
      {items.length === 0 ? (
        <p className="text-white/50">No images in the Overview yet. Click “+ Add Images” to curate the homepage grid.</p>
      ) : (
        <>
          <div className="flex items-baseline gap-3 mb-3 flex-wrap">
            <p className="text-[10px] tracking-[0.2em] uppercase text-white/40">Drag to reorder (top = first on page)</p>
            {lowResItems.length > 0 && (
              <p className="text-amber-400/90 text-xs">
                {lowResItems.length} of {items.length} {lowResItems.length === 1 ? "image is" : "images are"} low-resolution
                — marked below. Replace with a sharp version when you have one.
              </p>
            )}
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {items.map((item, i) => (
                  <SortableOverviewItem key={item.id} item={item} index={i} onRemove={removeItem} allProjects={allProjects} onLinkProject={linkProject} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}
    </div>
  );
}

function SortableOverviewItem({ item, index, onRemove, allProjects, onLinkProject }: { item: OverviewItem; index: number; onRemove: (id: string) => void; allProjects: Project[]; onLinkProject: (id: string, projectId: string | null) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [showLinker, setShowLinker] = useState(false);
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
    touchAction: "none",
  };
  const linkedProject = allProjects.find(p => p.id === item.projectId);
  return (
    <div ref={setNodeRef} style={style} className="relative group select-none" {...attributes} {...listeners}>
      <img src={thumbUrl(item.url, item.srcsetWebp, item.srcsetAvif)} alt={item.caption || ""} loading="lazy" decoding="async" className="w-full aspect-square object-cover bg-white/5 pointer-events-none" draggable={false} />
      <span className="absolute top-1 left-1 bg-black/70 text-white/80 text-[9px] w-5 h-5 flex items-center justify-center pointer-events-none">{String(index + 1).padStart(2, "0")}</span>
      <span className="absolute top-1 left-7 bg-black/70 text-white/50 text-[9px] px-1 h-5 flex items-center pointer-events-none">⠿</span>
      {/* No derivatives resolved for this url — it renders as one flat file. */}
      {!item.srcsetAvif && (
        <span
          className="absolute top-1 left-1/2 -translate-x-1/2 bg-amber-500/90 text-black text-[8px] px-1 py-0.5 tracking-wide pointer-events-none"
          title="No responsive derivatives — this image predates the pipeline, or its source is no longer a project image"
        >Low-res</span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(item.id); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-1 right-1 bg-black/70 text-white w-6 h-6 text-sm opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >×</button>
      {/* Link-to-project indicator + control */}
      {item.projectId ? (
        <span className="absolute bottom-0 left-0 right-0 bg-sky-500/80 text-white text-[8px] px-1 py-0.5 truncate pointer-events-none" title={linkedProject?.title}>↗ {linkedProject?.title || "Linked"}</span>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowLinker(s => !s); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute bottom-0 left-0 right-0 bg-black/70 text-white/60 text-[8px] px-1 py-0.5 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
        >+ Link to project</button>
      )}
      {showLinker && (
        <div className="absolute inset-0 bg-black/90 p-2 flex flex-col gap-1 z-20" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <p className="text-white text-[9px] uppercase tracking-wider mb-1">Link to project</p>
          <select
            value={item.projectId || ""}
            onChange={(e) => { onLinkProject(item.id, e.target.value || null); setShowLinker(false); }}
            onClick={(e) => e.stopPropagation()}
            className="bg-neutral-900 text-white text-[10px] p-1 border border-white/20"
          >
            <option value="">— None (no project link) —</option>
            {allProjects.map(p => (
              <option key={p.id} value={p.id}>{p.title} ({p.category})</option>
            ))}
          </select>
          <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowLinker(false); }} className="text-white/50 text-[9px] mt-1 hover:text-white">Close</button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Project Editor ---------------- */
function ProjectEditor({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const [title, setTitle] = useState(project?.title || "");
  const [category, setCategory] = useState(project?.category || "advertising");
  const [coverImage, setCoverImage] = useState(project?.coverImage || "");
  const [description, setDescription] = useState(project?.description || "");
  const [order, setOrder] = useState(project?.order ?? 0);
  const [published, setPublished] = useState(project?.published ?? true);
  const [featured, setFeatured] = useState(project?.featured ?? false);
  const [overview, setOverview] = useState(project?.overview ?? false);
  const [images, setImages] = useState<Image[]>(project?.images || []);
  // Uploaded but not yet attached — see STAGED_PREFIX. Normally empty when
  // editing an existing project; also holds the survivors when an attach
  // fails partway through a create.
  const [staged, setStaged] = useState<Image[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Derivatives for the current cover. Seeded from the project so an edit that
  // doesn't touch the cover doesn't wipe them; replaced on upload, and cleared
  // when the cover path is typed in by hand.
  const [coverDerivatives, setCoverDerivatives] = useState<Required<Derivatives> | null>(
    project?.srcsetAvif
      ? {
          srcsetAvif: project.srcsetAvif,
          srcsetWebp: project.srcsetWebp ?? null,
          width: project.width ?? null,
          height: project.height ?? null,
        }
      : null
  );

  // Held in state, not read straight off the prop: once a create succeeds this
  // has to flip to the new id so a retry after a partial failure updates that
  // project instead of creating a second one.
  const [savedId, setSavedId] = useState<string | null>(project?.id ?? null);
  const pid = savedId;

  // Saved rows first, then anything still waiting to attach.
  const gallery = [...images, ...staged];
  // Images that arrived as pre-built derivatives have no original and cannot
  // get one automatically. Filtering to them is how you work through the ones
  // that actually matter rather than hunting through the whole grid.
  const [onlyMissingMaster, setOnlyMissingMaster] = useState(false);
  const missingMasterCount = images.filter(i => !i.masterUrl).length;
  const coverIsGalleryImage = !!coverImage && gallery.some(i => i.url === coverImage);
  const visibleGallery = onlyMissingMaster ? gallery.filter(i => !i.masterUrl && !isStaged(i.id)) : gallery;

  async function saveProject(): Promise<string | null> {
    // coverDerivatives is set when the cover came from the pipeline. Sending
    // explicit nulls otherwise clears stale srcsets from a previous cover.
    const body = {
      title, category, coverImage, description, order, published, featured, overview,
      ...(coverDerivatives ?? { srcsetAvif: null, srcsetWebp: null, width: null, height: null }),
    };
    const url = pid ? API(`/projects/${pid}`) : API("/projects");
    const method = pid ? "PATCH" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) {
      const msg = await r.json().then(j => j?.error).catch(() => null);
      alert(`Save failed${msg ? `: ${msg}` : ""}`);
      return null;
    }
    const j = await r.json();
    return j.project.id;
  }

  /** Uploads always become gallery images now — a cover is chosen from them. */
  async function uploadFiles(files: FileList) {
    setUploading(true);
    const uploaded: Uploaded[] = [];
    for (const file of Array.from(files)) {
      const u = await postUpload(file);
      if (u) uploaded.push(u);
    }
    setUploading(false);
    if (!uploaded.length) return;

    // With a row in hand the manifests attach immediately; without one they
    // wait in `staged` until Create produces an id.
    if (!pid) {
      setStaged(s => [...s, ...uploaded.map(toStaged)]);
      return;
    }

    const failed: Uploaded[] = [];
    for (const [i, u] of uploaded.entries()) {
      if (!(await attachImage(pid, u, images.length + i))) failed.push(u);
    }
    // Previously the attach response went unchecked, so a failure here looked
    // exactly like success until the refresh came back short.
    if (failed.length) {
      alert(`${failed.length} of ${uploaded.length} image(s) could not be added to the project.`);
    }
    const r = await fetch(API(`/projects/${pid}`));
    const j = await r.json();
    setImages(j.project?.images || []);
  }

  /**
   * Promote a gallery image to the cover. Takes the image's own pipeline URL
   * and srcsets rather than re-uploading, so the cover is the same sharp,
   * responsive derivative the gallery already serves. Legacy /shoots/ rows
   * carry null derivatives — that is the documented fallback, not a failure.
   *
   * Local state only: the change lands with "Update Project", like every other
   * field. This is now the only way a cover is chosen.
   */
  function setAsCover(img: Image) {
    setCoverImage(img.url);
    setCoverDerivatives({
      srcsetAvif: img.srcsetAvif ?? null,
      srcsetWebp: img.srcsetWebp ?? null,
      width: img.width ?? null,
      height: img.height ?? null,
    });
  }

  /** Flip one image between Compressed and Sharpest. */
  async function setUseMaster(img: Image, next: boolean) {
    if (!pid || isStaged(img.id)) return;
    const r = await fetch(API(`/projects/${pid}/images/${img.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useMaster: next }),
    });
    if (!r.ok) {
      const msg = await r.json().then(j => j?.error).catch(() => null);
      alert(msg || "Could not change the quality setting.");
      return;
    }
    setImages(list => list.map(i => (i.id === img.id ? { ...i, useMaster: next } : i)));
  }

  /** Attach the studio's original to an image that has none, then re-encode it. */
  async function attachMaster(img: Image, file: File) {
    if (!pid || isStaged(img.id)) return;
    setProgress(`Uploading original for ${img.id.slice(0, 6)}…`);
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(API(`/projects/${pid}/images/${img.id}/master`), { method: "POST", body: fd });
    setProgress(null);
    if (!r.ok) {
      const msg = await r.json().then(j => j?.error).catch(() => null);
      alert(msg || "Could not attach the original.");
      return;
    }
    // Derivatives were rebuilt in place, so the urls are unchanged — but the
    // srcsets and master fields are new, and the browser is holding the old
    // pixels for those urls. Refetch the row and let the cache sort itself out.
    const j = await fetch(API(`/projects/${pid}`)).then(x => x.json());
    setImages(j.project?.images || []);
  }

  async function removeImage(imgId: string) {
    // Staged images have no row to delete — dropping them from the list is
    // the whole operation. Their uploaded files stay in MEDIA_ROOT (follow-up).
    if (isStaged(imgId)) { setStaged(s => s.filter(i => i.id !== imgId)); return; }
    if (!pid) return;
    await fetch(API(`/projects/${pid}/images/${imgId}`), { method: "DELETE" });
    setImages(images.filter(i => i.id !== imgId));
  }

  // Drag-to-reorder
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = gallery.findIndex(i => i.id === active.id);
    const newIndex = gallery.findIndex(i => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(gallery, oldIndex, newIndex);
    // Split the reordered list back into rows and pending uploads. Each keeps
    // its new relative order; staged ones get theirs applied when they attach.
    const savedNext = next.filter(i => !isStaged(i.id));
    setImages(savedNext);
    setStaged(next.filter(i => isStaged(i.id)));
    // persist new order to backend — only rows have ids the server knows
    if (pid && savedNext.length) {
      await fetch(API(`/projects/${pid}/images/reorder`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: savedNext.map(i => i.id) }),
      });
    }
  }

  async function handleSave() {
    // The create route rejects a missing title/category/coverImage with a 400.
    // Checking here keeps a dozen staged images from being met with a bare
    // "Save failed", which reads like the uploads were thrown away.
    const missing = !title.trim() ? "a title"
      : !category ? "a category"
      : !coverImage.trim() ? "a cover image"
      : null;
    if (missing) { alert(`Add ${missing} before saving.`); return; }

    setSaving(true);
    const id = await saveProject();
    if (!id) { setSaving(false); return; }
    setSavedId(id);

    if (staged.length) {
      const failed: Image[] = [];
      for (const [i, img] of staged.entries()) {
        setProgress(`Adding image ${i + 1} of ${staged.length}…`);
        const ok = await attachImage(id, toManifest(img), images.length + i);
        if (!ok) failed.push(img);
      }
      setProgress(null);
      setStaged(failed);
      if (failed.length) {
        // The project itself exists now, so don't close: the editor is in edit
        // mode against it and pressing Update retries only what's left.
        setSaving(false);
        alert(
          `Project saved, but ${failed.length} of ${staged.length} gallery image(s) could not be added. ` +
          `They are still listed — press Update Project to retry them.`
        );
        return;
      }
    }

    setSaving(false);
    alert("Saved");
    onClose();
  }

  return (
    <div>
      <button onClick={onClose} className="text-[11px] tracking-[0.2em] uppercase text-white/50 hover:text-white mb-6">← Back to projects</button>
      <h2 className="font-serif text-2xl mb-8">{pid ? "Edit Project" : "New Project"}</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left: form */}
        <div className="space-y-6">
          <Field label="Title">
            <input value={title} onChange={e => setTitle(e.target.value)} className="adm-field" />
          </Field>
          <Field label="Category">
            <select value={category} onChange={e => setCategory(e.target.value)} className="adm-field">
              <option value="advertising">Advertising</option>
              <option value="food-beverage">Food &amp; Beverage</option>
            </select>
          </Field>
          <Field label="Order (lower shows first)">
            <input type="number" value={order} onChange={e => setOrder(Number(e.target.value))} className="adm-field" />
          </Field>
          <Field label="Description (optional)">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="adm-field resize-none" />
          </Field>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-3 text-sm cursor-pointer">
              <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} className="w-4 h-4" />
              Published
            </label>
            <label className="flex items-center gap-3 text-sm cursor-pointer">
              <input type="checkbox" checked={overview} onChange={e => setOverview(e.target.checked)} className="w-4 h-4" />
              <span className={overview ? "text-sky-400" : ""}>◆ Show on Overview homepage</span>
            </label>
            <label className="flex items-center gap-3 text-sm cursor-pointer">
              <input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} className="w-4 h-4" />
              <span className={featured ? "text-yellow-400" : ""}>★ Featured in slideshow</span>
            </label>
          </div>

          {/* Cover image */}
          {/* The cover is one of the gallery images, chosen with "Set as cover"
              on the tile. It is no longer a separate upload or a typed path:
              both produced covers that existed outside the gallery, with no
              image record, no original on file and no way to offer Sharpest —
              and a typed path is how covers ended up pointing at another
              project's photograph. */}
          <Field label="Cover Image">
            <div className="flex gap-3 items-start">
              {coverImage ? (
                <>
                  <img src={thumbUrl(coverImage, coverDerivatives?.srcsetWebp, coverDerivatives?.srcsetAvif)} alt="cover" loading="lazy" decoding="async" className="w-24 h-24 object-cover bg-white/5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white/60 text-sm">
                      {coverIsGalleryImage ? "Set from the gallery." : "Not one of this project's gallery images."}
                    </p>
                    <p className="text-white/30 text-[11px] mt-1 break-all">{coverImage}</p>
                    {!coverIsGalleryImage && gallery.length > 0 && (
                      <p className="text-amber-400/80 text-[11px] mt-2">
                        Pick a gallery image below with “☆ Set as cover” so the cover has an image
                        record — that is what carries the original and the quality setting.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-white/50 text-sm">
                  {gallery.length > 0
                    ? "No cover yet — choose one with “☆ Set as cover” on any gallery image."
                    : "Add a gallery image first, then set it as the cover."}
                </p>
              )}
            </div>
          </Field>

          <button onClick={handleSave} disabled={saving || uploading}
            className="border border-white/30 px-6 py-3 text-[11px] tracking-[0.3em] uppercase hover:bg-white hover:text-black transition-colors disabled:opacity-50">
            {saving ? (progress ?? "Saving…") : pid ? "Update Project" : "Create Project"}
          </button>
        </div>

        {/* Right: gallery images (drag to reorder) */}
        <div>
          <Field label={`Gallery Images (${gallery.length})${gallery.length > 1 ? " — drag to reorder" : ""}`}>
            <input type="file" accept="image/*" multiple onChange={e => e.target.files && uploadFiles(e.target.files)} disabled={uploading} className="text-[10px] text-white/50 mb-4" />
            {uploading && <p className="text-white/50 text-xs mb-2">Uploading…</p>}
            {!pid && staged.length > 0 && (
              <p className="text-white/50 text-xs mb-2">
                {staged.length} image{staged.length > 1 ? "s" : ""} ready — added when you press Create Project.
              </p>
            )}
            {missingMasterCount > 0 && (
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <button
                  onClick={() => setOnlyMissingMaster(v => !v)}
                  aria-pressed={onlyMissingMaster}
                  className={`text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 border transition-colors ${
                    onlyMissingMaster
                      ? "bg-amber-500/90 text-black border-amber-500"
                      : "border-white/20 text-white/60 hover:text-white hover:border-white/50"
                  }`}
                >{onlyMissingMaster ? "Showing missing originals" : `Missing original (${missingMasterCount})`}</button>
                <span className="text-white/40 text-[11px]">
                  {missingMasterCount} of {images.length} have no original on file — click a
                  ⚠ badge to attach one.
                </span>
              </div>
            )}
            {onlyMissingMaster && visibleGallery.length === 0 ? (
              <p className="text-white/50 text-sm">Every image in this project has its original.</p>
            ) : visibleGallery.length > 0 ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={visibleGallery.map(i => i.id)} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-3 gap-3">
                    {visibleGallery.map(img => (
                      <SortableImage
                        key={img.id}
                        img={img}
                        isCover={!!coverImage && img.url === coverImage}
                        onRemove={removeImage}
                        onSetCover={setAsCover}
                        onSetUseMaster={setUseMaster}
                        onAttachMaster={attachMaster}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <p className="text-white/30 text-sm">No gallery images yet.</p>
            )}
          </Field>
        </div>
      </div>

      <style>{`
        .adm-field { width:100%; background:transparent; border:1px solid rgba(255,255,255,0.15); padding:0.6rem 0.8rem; color:#fff; font-size:14px; }
        .adm-field:focus { outline:none; border-color:rgba(255,255,255,0.5); }
        .adm-field::placeholder { color: rgba(255,255,255,0.3); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">{label}</label>
      {children}
    </div>
  );
}

/* ---------------- Sortable Image (drag-to-reorder) ---------------- */
function SortableImage({ img, isCover, onRemove, onSetCover, onSetUseMaster, onAttachMaster }: {
  img: Image;
  isCover: boolean;
  onRemove: (id: string) => void;
  onSetCover: (img: Image) => void;
  onSetUseMaster: (img: Image, next: boolean) => void;
  onAttachMaster: (img: Image, file: File) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
    touchAction: "none",
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative group select-none ${isCover ? "ring-2 ring-yellow-400" : ""}`}
      {...attributes}
      {...listeners}
    >
      <img src={thumbUrl(img.url, img.srcsetWebp, img.srcsetAvif)} alt={img.caption || ""} loading="lazy" decoding="async" className="w-full aspect-square object-cover bg-white/5 pointer-events-none" draggable={false} />
      <span className="absolute top-1 left-1 bg-black/70 text-white/70 text-[9px] w-5 h-5 flex items-center justify-center pointer-events-none">⠿</span>
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(img.id); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-1 right-1 bg-black/70 text-white w-6 h-6 text-sm opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >×</button>
      {/* Quality state. A missing original is a fact about the image, not a
          failure, so it is stated plainly and offers the fix inline. */}
      {!isStaged(img.id) && (
        img.masterUrl ? (
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onSetUseMaster(img, !img.useMaster); }}
            onPointerDown={(e) => e.stopPropagation()}
            title={
              img.useMaster
                ? `Sharpest — visitors get the original (${img.width ?? "?"}×${img.height ?? "?"}, ${fmtBytes(img.masterBytes)}) when they zoom`
                : `Compressed — visitors get the derivatives. Original on file: ${img.width ?? "?"}×${img.height ?? "?"}, ${fmtBytes(img.masterBytes)}`
            }
            className={`absolute bottom-1 right-1 text-[8px] px-1.5 py-0.5 tracking-wide z-10 ${
              img.useMaster ? "bg-emerald-400/90 text-black" : "bg-black/70 text-white/70 hover:text-white"
            }`}
          >{img.useMaster ? "◆ Sharpest" : "◇ Compressed"}</button>
        ) : (
          <label
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            title="No original on file — attach the studio's original to enable Sharpest and rebuild this image"
            className="absolute bottom-1 right-1 bg-amber-500/90 text-black text-[8px] px-1.5 py-0.5 tracking-wide z-10 cursor-pointer hover:bg-amber-400"
          >
            ⚠ No original
            <input
              type="file" accept="image/*" className="hidden"
              onChange={(e) => e.target.files && e.target.files[0] && onAttachMaster(img, e.target.files[0])}
            />
          </label>
        )
      )}
      {/* Colour-space warning. Derivatives are always converted to sRGB, so
          this never means visitors are seeing wrong colour — it means the
          master was exported for print or in a wide gamut, which is worth
          knowing before a whole shoot arrives the same way. "untagged" is not
          flagged: every browser assumes sRGB for it, and so does the pipeline. */}
      {!isStaged(img.id) && !spaceIsSafe(img.masterSpace) && (
        <span
          title={
            img.masterSpace === "cmyk"
              ? "This master is CMYK — a print file. It converts to sRGB for the web, but the colour will not match what the studio saw. Re-export it as sRGB and attach it again."
              : `This master is tagged "${img.masterSpace}", not sRGB. It converts correctly, but exporting as sRGB avoids the conversion entirely.`
          }
          className="absolute top-1 left-8 bg-orange-500/90 text-black text-[8px] px-1.5 py-0.5 tracking-wide z-10 cursor-help"
        >
          {img.masterSpace === "cmyk" ? "⬤ CMYK master" : "⬤ Not sRGB"}
        </span>
      )}

      {/* Cover control. The badge is status and always visible; the button
          follows the × pattern. Both stop pointer events reaching the wrapper,
          which carries the dnd-kit listeners — without that a click starts a
          drag instead of firing. */}
      {isCover ? (
        <span
          title={
            img.coverOnly
              ? "This is the cover, and only the cover — it is not shown in the project gallery, the lightbox or the Overview picker. Attach the original to rebuild it at full quality."
              : "This gallery image is the project cover"
          }
          className={`absolute bottom-1 left-1 text-[9px] px-1.5 py-0.5 tracking-wide pointer-events-none ${
            img.coverOnly ? "bg-yellow-400/90 text-black outline outline-1 outline-dashed outline-offset-1 outline-yellow-400/60" : "bg-yellow-400 text-black"
          }`}
        >
          {img.coverOnly ? "★ Cover only" : "★ Current cover"}
        </span>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onSetCover(img); }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Use this image as the project cover"
          className="absolute bottom-1 left-1 bg-black/70 text-white/80 text-[9px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-yellow-400 transition-opacity z-10"
        >☆ Set as cover</button>
      )}
    </div>
  );
}

/* ---------------- Bulk Import ---------------- */
type BulkRow = { id: string; url: string; title: string; category: string } & Required<Derivatives>;

function BulkImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [defaultCat, setDefaultCat] = useState("advertising");

  function uid() { return Math.random().toString(36).slice(2, 10); }

  async function handleUpload(files: FileList) {
    setUploading(true);
    const newRows: BulkRow[] = [];
    for (const file of Array.from(files)) {
      const u = await postUpload(file);
      if (u) {
        // default title = filename without extension, cleaned up
        const title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
        newRows.push({ id: uid(), title, category: defaultCat, ...u });
      }
    }
    setUploading(false);
    setRows([...rows, ...newRows]);
  }

  function updateRow(id: string, patch: Partial<BulkRow>) {
    setRows(rows.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: string) {
    setRows(rows.filter(r => r.id !== id));
  }
  function setAllCategory(cat: string) {
    setDefaultCat(cat);
    setRows(rows.map(r => ({ ...r, category: cat })));
  }

  async function createAll() {
    const valid = rows.filter(r => r.title.trim() && r.url);
    if (valid.length === 0) { alert("Add at least one image with a title."); return; }
    setCreating(true);
    const r = await fetch(API("/projects/bulk"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: valid.map(r => ({
          title: r.title.trim(),
          category: r.category,
          url: r.url,
          srcsetAvif: r.srcsetAvif,
          srcsetWebp: r.srcsetWebp,
          width: r.width,
          height: r.height,
        })),
      }),
    });
    setCreating(false);
    if (r.ok) {
      const j = await r.json();
      alert(`Created ${j.created.length} project${j.created.length !== 1 ? "s" : ""}.`);
      onDone();
    } else {
      alert("Bulk create failed.");
    }
  }

  return (
    <div>
      <button onClick={onClose} className="text-[11px] tracking-[0.2em] uppercase text-white/50 hover:text-white mb-6">← Back to projects</button>
      <h2 className="font-serif text-2xl mb-2">Bulk Import</h2>
      <p className="text-white/50 text-sm mb-8 max-w-xl">
        Upload multiple images at once. Each image becomes a new project (with that image as the cover).
        Edit the titles and categories below, then create them all in one click.
      </p>

      {/* Upload + default category */}
      <div className="flex flex-wrap items-center gap-4 mb-8">
        <label className="text-[11px] tracking-[0.2em] uppercase border border-white/30 px-4 py-2 cursor-pointer hover:bg-white hover:text-black transition-colors">
          {uploading ? "Uploading…" : "+ Select Images"}
          <input type="file" accept="image/*" multiple className="hidden" onChange={e => e.target.files && handleUpload(e.target.files)} disabled={uploading} />
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-[0.2em] uppercase text-white/40">Default category:</span>
          <select value={defaultCat} onChange={e => setAllCategory(e.target.value)} className="bg-transparent border border-white/20 px-3 py-1.5 text-sm text-white">
            <option value="advertising" className="bg-neutral-900">Advertising</option>
            <option value="food-beverage" className="bg-neutral-900">Food &amp; Beverage</option>
          </select>
        </div>
      </div>

      {/* Rows */}
      {rows.length > 0 ? (
        <>
          <div className="space-y-3 mb-8">
            {rows.map((r, i) => (
              <div key={r.id} className="flex items-center gap-4 border border-white/10 p-3">
                <span className="text-[10px] tracking-[0.2em] uppercase text-white/30 w-6">{String(i + 1).padStart(2, "0")}</span>
                <img src={thumbUrl(r.url, r.srcsetWebp, r.srcsetAvif)} alt="" loading="lazy" decoding="async" className="w-14 h-14 object-cover bg-white/5 flex-shrink-0" />
                <input
                  value={r.title}
                  onChange={e => updateRow(r.id, { title: e.target.value })}
                  placeholder="Project title"
                  className="flex-1 bg-transparent border-b border-white/15 pb-1 text-white focus:outline-none focus:border-white transition-colors"
                />
                <select
                  value={r.category}
                  onChange={e => updateRow(r.id, { category: e.target.value })}
                  className="bg-transparent border border-white/15 px-2 py-1 text-xs text-white"
                >
                  <option value="advertising" className="bg-neutral-900">Advertising</option>
                  <option value="food-beverage" className="bg-neutral-900">F&amp;B</option>
                </select>
                <button onClick={() => removeRow(r.id)} className="text-white/40 hover:text-red-400 text-lg px-1">×</button>
              </div>
            ))}
          </div>
          <button
            onClick={createAll}
            disabled={creating}
            className="border border-white/30 px-6 py-3 text-[11px] tracking-[0.3em] uppercase hover:bg-white hover:text-black transition-colors disabled:opacity-50"
          >
            {creating ? "Creating…" : `Create ${rows.filter(r => r.title.trim()).length} Project${rows.filter(r => r.title.trim()).length !== 1 ? "s" : ""}`}
          </button>
        </>
      ) : (
        <p className="text-white/30 text-sm">No images selected yet. Click “+ Select Images” to upload.</p>
      )}
    </div>
  );
}

/* ---------------- Inquiries Tab ---------------- */
function InquiriesTab() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const r = await fetch(API("/inquiries"), { cache: "no-store" });
      const j = await r.json();
      setInquiries(j.inquiries || []);
      setLoading(false);
    };
    refreshRef.current = load;
    load();
  }, []);

  async function setStatus(id: string, status: string) {
    await fetch(API(`/inquiries/${id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    refreshRef.current();
  }
  async function remove(id: string) {
    if (!confirm("Delete this inquiry?")) return;
    await fetch(API(`/inquiries/${id}`), { method: "DELETE" });
    refreshRef.current();
  }

  if (loading) return <p className="text-white/50">Loading…</p>;

  const newCount = inquiries.filter(i => i.status === "new").length;

  return (
    <div>
      <p className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-6">{inquiries.length} Inquiries · {newCount} new</p>
      {inquiries.length === 0 ? (
        <p className="text-white/50">No inquiries yet. Submissions from the contact form will appear here.</p>
      ) : (
        <div className="space-y-4">
          {inquiries.map(i => (
            <div key={i.id} className="border border-white/10 p-5">
              <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
                <div>
                  <h3 className="font-serif text-lg">{i.firstName} {i.lastName}</h3>
                  <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 mt-1">
                    {new Date(i.createdAt).toLocaleString()}
                  </p>
                </div>
                <span className={`text-[10px] tracking-[0.2em] uppercase px-2 py-1 ${i.status === "new" ? "bg-green-500/20 text-green-400" : i.status === "read" ? "text-white/50" : "text-white/30"}`}>
                  {i.status}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-white/70 mb-3">
                <a href={`mailto:${i.email}`} className="hover:text-white break-all">{i.email}</a>
                <a href={`tel:${i.phone}`} className="hover:text-white">{i.phone}</a>
              </div>
              <p className="text-sm text-white/80 mb-4 whitespace-pre-wrap border-l-2 border-white/10 pl-4">{i.message}</p>
              <div className="flex gap-3">
                {i.status === "new" && <button onClick={() => setStatus(i.id, "read")} className="text-[10px] tracking-[0.2em] uppercase text-white/60 hover:text-white">Mark Read</button>}
                {i.status !== "archived" && <button onClick={() => setStatus(i.id, "archived")} className="text-[10px] tracking-[0.2em] uppercase text-white/60 hover:text-white">Archive</button>}
                <button onClick={() => remove(i.id)} className="text-[10px] tracking-[0.2em] uppercase text-red-400/70 hover:text-red-400">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Settings Tab (nav section visibility + labels) ---------------- */
function SettingsTab() {
  const [sections, setSections] = useState<SiteSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const originalRef = useRef<string>("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const r = await fetch(API("/settings"), { cache: "no-store" });
      const j = await r.json();
      setSections(j.sections || []);
      originalRef.current = JSON.stringify(j.sections || []);
      setLoading(false);
    };
    load();
  }, []);

  function updateSection(id: string, patch: Partial<SiteSection>) {
    setSections(prev => {
      const next = prev.map(s => (s.id === id ? { ...s, ...patch } : s));
      setDirty(JSON.stringify(next) !== originalRef.current);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const r = await fetch(API("/settings"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections }),
    });
    setSaving(false);
    if (r.ok) {
      const j = await r.json();
      setSections(j.sections);
      originalRef.current = JSON.stringify(j.sections);
      setDirty(false);
      alert("Settings saved. The site navigation has been updated.");
    } else {
      alert("Save failed.");
    }
  }

  if (loading) return <p className="text-white/50">Loading…</p>;

  return (
    <div>
      <p className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">Navigation</p>
      <h2 className="font-serif text-2xl mb-2">Sections &amp; Visibility</h2>
      <p className="text-white/50 text-sm mb-8 max-w-xl">
        Control which pages appear in the site's top navigation. Edit a label, reorder, or hide any
        section — changes apply to the public site instantly after saving.
      </p>

      <div className="space-y-3 mb-8">
        {sections.map((s, i) => (
          <div key={s.id} className="flex items-center gap-4 border border-white/10 p-4">
            <span className="text-[10px] tracking-[0.2em] uppercase text-white/30 w-6">{String(i + 1).padStart(2, "0")}</span>
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[9px] tracking-[0.2em] uppercase text-white/30 mb-1">Label</label>
                <input
                  value={s.label}
                  onChange={e => updateSection(s.id, { label: e.target.value })}
                  className="w-full bg-transparent border-b border-white/15 pb-1 text-white focus:outline-none focus:border-white transition-colors"
                />
              </div>
              <div>
                <label className="block text-[9px] tracking-[0.2em] uppercase text-white/30 mb-1">Key (fixed)</label>
                <input value={s.key} disabled className="w-full bg-transparent border-b border-white/10 pb-1 text-white/40 text-sm" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={s.visible}
                onChange={e => updateSection(s.id, { visible: e.target.checked })}
                className="w-4 h-4"
              />
              <span className={s.visible ? "text-white" : "text-white/40"}>{s.visible ? "Visible" : "Hidden"}</span>
            </label>
          </div>
        ))}
      </div>

      <button
        onClick={save}
        disabled={saving || !dirty}
        className="border border-white/30 px-6 py-3 text-[11px] tracking-[0.3em] uppercase hover:bg-white hover:text-black transition-colors disabled:opacity-40"
      >
        {saving ? "Saving…" : dirty ? "Save Changes" : "Saved"}
      </button>
    </div>
  );
}

/* ---------------- Site Tab (hero text, logo, theme) ---------------- */
function SiteTab() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const originalRef = useRef<string>("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const r = await fetch(API("/settings"), { cache: "no-store" });
      const j = await r.json();
      const s = j.siteSettings || {};
      setSettings(s);
      originalRef.current = JSON.stringify(s);
      setLoading(false);
    };
    load();
  }, []);

  /** Upload a new site icon. The server writes the whole set and records the
   *  version, so this saves immediately rather than waiting for Save Changes —
   *  the file is already on disk by the time the response comes back. */
  async function uploadIcon(file: File) {
    setUploadingIcon(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(API("/icon"), { method: "POST", body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok) { alert(j?.error || "Could not use that image."); return; }
      // Update the stored value without marking the form dirty: it is saved.
      setSettings(prev => {
        const next = { ...prev, siteIcon: j.siteIcon };
        originalRef.current = JSON.stringify(next);
        setDirty(false);
        return next;
      });
    } finally {
      setUploadingIcon(false);
    }
  }

  function set(key: string, value: string) {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      setDirty(JSON.stringify(next) !== originalRef.current);
      return next;
    });
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    const u = await postUpload(file);
    setUploadingLogo(false);
    // SiteSetting stores a bare string, so only the fallback url is kept. The
    // derivatives still exist on disk if the logo ever moves to <picture>.
    if (u) set("logo", u.url);
  }

  async function save() {
    setSaving(true);
    const r = await fetch(API("/settings"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteSettings: settings }),
    });
    setSaving(false);
    if (r.ok) {
      const j = await r.json();
      setSettings(j.siteSettings);
      originalRef.current = JSON.stringify(j.siteSettings);
      setDirty(false);
      alert("Site settings saved. The changes are now live.");
    } else {
      alert("Save failed.");
    }
  }

  if (loading) return <p className="text-white/50">Loading…</p>;

  return (
    <div className="max-w-2xl">
      <p className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">Site</p>
      <h2 className="font-serif text-2xl mb-2">Hero, Logo &amp; Theme</h2>
      <p className="text-white/50 text-sm mb-8">
        Edit the text shown over the homepage slideshow, replace the studio logo, and switch the site between dark and light modes.
      </p>

      {/* Hero text */}
      <div className="space-y-6 mb-10">
        <h3 className="text-[10px] tracking-[0.3em] uppercase text-white/40 pb-2 border-b border-white/10">Slideshow Text</h3>
        <Field label="Eyebrow (small text above heading)">
          <input value={settings.heroSubtitle || ""} onChange={e => set("heroSubtitle", e.target.value)} className="adm-field" placeholder="Takes Two Studio" />
        </Field>
        <Field label="Main heading">
          <input value={settings.heroTitle || ""} onChange={e => set("heroTitle", e.target.value)} className="adm-field" placeholder="Two perspectives. One frame." />
          <p className="text-white/30 text-[10px] mt-1">Tip: use a period to create a line break, e.g. “Two perspectives. One frame.”</p>
        </Field>
        <Field label="Tagline (small text below heading)">
          <input value={settings.heroTag || ""} onChange={e => set("heroTag", e.target.value)} className="adm-field" placeholder="Advertising & Food & Beverage — Cairo" />
        </Field>
      </div>

      {/* Logo */}
      <div className="space-y-4 mb-10">
        <h3 className="text-[10px] tracking-[0.3em] uppercase text-white/40 pb-2 border-b border-white/10">Logo</h3>
        <div className="flex items-center gap-5">
          <div className="w-24 h-24 flex items-center justify-center bg-white/5 p-2 flex-shrink-0">
            <img src={settings.logo || "/brand/logo.webp"} alt="logo preview" className="max-w-full max-h-full object-contain" />
          </div>
          <div className="flex-1">
            <input value={settings.logo || ""} onChange={e => set("logo", e.target.value)} className="adm-field mb-2" placeholder="/brand/logo.webp" />
            <label className="text-[10px] tracking-[0.2em] uppercase text-white/50 cursor-pointer hover:text-white">
              {uploadingLogo ? "Uploading…" : "Upload new logo"}
              <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files && uploadLogo(e.target.files[0])} disabled={uploadingLogo} />
            </label>
          </div>
        </div>
      </div>

      {/* Footer / Brand text */}
      <div className="space-y-6 mb-10">
        <h3 className="text-[10px] tracking-[0.3em] uppercase text-white/40 pb-2 border-b border-white/10">Footer & Brand Text</h3>
        <Field label="Footer studio name (shown beside logo in footer)">
          <input value={settings.footerName || ""} onChange={e => set("footerName", e.target.value)} className="adm-field" placeholder="Takes Two Studio" />
        </Field>
        <Field label="Footer subtitle">
          <input value={settings.footerSubtitle || ""} onChange={e => set("footerSubtitle", e.target.value)} className="adm-field" placeholder="Advertising & Food & Beverage Photography" />
        </Field>
      </div>

      {/* Theme */}
      <div className="space-y-4 mb-10">
        <h3 className="text-[10px] tracking-[0.3em] uppercase text-white/40 pb-2 border-b border-white/10">Theme</h3>
        <div className="flex gap-3">
          {(["dark", "light"] as const).map(t => (
            <button
              key={t}
              onClick={() => set("theme", t)}
              className={`px-5 py-3 text-[11px] tracking-[0.2em] uppercase border transition-colors ${
                settings.theme === t
                  ? "border-white bg-white text-black"
                  : "border-white/20 text-white/60 hover:text-white hover:border-white/50"
              }`}
            >
              {t === "dark" ? "Dark Mode" : "Light Mode"}
            </button>
          ))}
        </div>
        <p className="text-white/30 text-[10px]">Sets the default site theme. Visitors can still toggle it from the header.</p>
      </div>

      {/* Portfolio texts */}
      <div className="space-y-6 mb-10">
        <h3 className="text-[10px] tracking-[0.3em] uppercase text-white/40 pb-2 border-b border-white/10">Portfolio Page Text</h3>
        <Field label="Overview eyebrow">
          <input value={settings.portfolioEyebrow || ""} onChange={e => set("portfolioEyebrow", e.target.value)} className="adm-field" placeholder="Selected Works" />
        </Field>
        <Field label="Overview heading (use a period to split into two lines)">
          <input value={settings.portfolioHeading || ""} onChange={e => set("portfolioHeading", e.target.value)} className="adm-field" placeholder="The full archive. Every project, one frame at a time." />
        </Field>
        <Field label="Overview hint text">
          <input value={settings.portfolioHint || ""} onChange={e => set("portfolioHint", e.target.value)} className="adm-field" placeholder="Click any project to open its full gallery." />
        </Field>
        <Field label="Advertising heading">
          <input value={settings.advertisingHeading || ""} onChange={e => set("advertisingHeading", e.target.value)} className="adm-field" placeholder="Advertising campaigns, stills & commercials." />
        </Field>
        <Field label="Food & Beverage heading">
          <input value={settings.foodBeverageHeading || ""} onChange={e => set("foodBeverageHeading", e.target.value)} className="adm-field" placeholder="Food & Beverage, appetite in every frame." />
        </Field>
      </div>

      {/* About texts */}
      <div className="space-y-6 mb-10">
        <h3 className="text-[10px] tracking-[0.3em] uppercase text-white/40 pb-2 border-b border-white/10">About Page Text</h3>
        <Field label="Eyebrow">
          <input value={settings.aboutEyebrow || ""} onChange={e => set("aboutEyebrow", e.target.value)} className="adm-field" placeholder="The Studio" />
        </Field>
        <Field label="Heading">
          <input value={settings.aboutHeading || ""} onChange={e => set("aboutHeading", e.target.value)} className="adm-field" placeholder="About Takes Two" />
        </Field>
        <Field label="Body (separate paragraphs with a blank line)">
          <textarea value={settings.aboutBody || ""} onChange={e => set("aboutBody", e.target.value)} rows={6} className="adm-field resize-none" placeholder="Takes Two Studio was founded by..." />
        </Field>
        <Field label="Capabilities (comma-separated list)">
          <input value={settings.aboutCapabilities || ""} onChange={e => set("aboutCapabilities", e.target.value)} className="adm-field" placeholder="Advertising Campaigns, TV Commercials, Food & Beverage, ..." />
        </Field>
        <Field label="Quote (use a period to split into two lines)">
          <input value={settings.aboutQuote || ""} onChange={e => set("aboutQuote", e.target.value)} className="adm-field" placeholder="Two perspectives. One frame." />
        </Field>
        <Field label="Location text (under the photo, leave blank to hide)">
          <input value={settings.aboutLocation || ""} onChange={e => set("aboutLocation", e.target.value)} className="adm-field" placeholder="Cairo · Egypt" />
        </Field>
      </div>

      <RegeneratePanel />

      {/* Clients + Contact texts */}
      <div className="space-y-6 mb-10">
        <h3 className="text-[10px] tracking-[0.3em] uppercase text-white/40 pb-2 border-b border-white/10">Clients & Contact Text</h3>
        <Field label="Clients eyebrow">
          <input value={settings.clientsEyebrow || ""} onChange={e => set("clientsEyebrow", e.target.value)} className="adm-field" placeholder="Trusted By" />
        </Field>
        <Field label="Clients heading">
          <input value={settings.clientsHeading || ""} onChange={e => set("clientsHeading", e.target.value)} className="adm-field" placeholder="Our Clients" />
        </Field>
        <Field label="Clients subtext">
          <input value={settings.clientsSubtext || ""} onChange={e => set("clientsSubtext", e.target.value)} className="adm-field" placeholder="Brands and publications we've worked with." />
        </Field>
        <Field label="Clients font size (px)">
          <input
            type="number" min={10} max={48} step={1}
            value={settings.clientsFontSize ?? ""}
            onChange={e => set("clientsFontSize", e.target.value)}
            className="adm-field"
            placeholder="18"
          />
          <p className="text-white/30 text-[11px] mt-1">
            Size of the client names in the grid. Logos scale with it, so the two kinds of cell stay
            consistent. Leave blank for the default of 18px; values are clamped to 10–48.
          </p>
        </Field>
        <Field label="Site icon (favicon)">
          <div className="flex items-center gap-4">
            <img
              key={settings.siteIcon || "default"}
              src={`/api/icon/favicon-32.png?v=${settings.siteIcon || "default"}`}
              alt=""
              width={32}
              height={32}
              className="w-8 h-8 bg-white/5 shrink-0"
            />
            <label className={`text-[11px] tracking-[0.2em] uppercase border border-white/30 px-4 py-2 cursor-pointer hover:bg-white hover:text-black transition-colors ${uploadingIcon ? "opacity-40 pointer-events-none" : ""}`}>
              {uploadingIcon ? "Generating…" : "Upload icon"}
              <input
                type="file"
                accept="image/png,image/svg+xml,image/jpeg,image/webp"
                className="hidden"
                onChange={e => e.target.files?.[0] && uploadIcon(e.target.files[0])}
              />
            </label>
          </div>
          <p className="text-white/30 text-[11px] mt-2">
            One square image, PNG or SVG, 512×512 or larger. From it the app writes
            favicon.ico (16 and 32), a 32px PNG, a 180px Apple touch icon, and 192/512
            icons for the web manifest. Until you upload one, the site keeps the icon it
            has. A non-square image is fitted rather than cropped, so nothing is cut off.
          </p>
        </Field>
        <Field label="Contact eyebrow">
          <input value={settings.contactEyebrow || ""} onChange={e => set("contactEyebrow", e.target.value)} className="adm-field" placeholder="Get in Touch" />
        </Field>
        <Field label="Contact heading (use a period to split into two lines)">
          <input value={settings.contactHeading || ""} onChange={e => set("contactHeading", e.target.value)} className="adm-field" placeholder="For bookings & inquiries." />
        </Field>
        <Field label="Bookings 1 — label">
          <input value={settings.contactBookingsALabel ?? ""} onChange={e => set("contactBookingsALabel", e.target.value)} className="adm-field" placeholder="Bookings — Mohamed" />
        </Field>
        <Field label="Bookings 1 — email">
          <input value={settings.contactBookingsAEmail ?? ""} onChange={e => set("contactBookingsAEmail", e.target.value)} className="adm-field" placeholder="M.medhat@takestwostudio.com" />
        </Field>
        <Field label="Bookings 2 — label">
          <input value={settings.contactBookingsBLabel ?? ""} onChange={e => set("contactBookingsBLabel", e.target.value)} className="adm-field" placeholder="Bookings — Okasha" />
        </Field>
        <Field label="Bookings 2 — email">
          <input value={settings.contactBookingsBEmail ?? ""} onChange={e => set("contactBookingsBEmail", e.target.value)} className="adm-field" placeholder="Okasha@takestwostudio.com" />
        </Field>
        <Field label="Cairo — label">
          <input value={settings.contactCairoLabel ?? ""} onChange={e => set("contactCairoLabel", e.target.value)} className="adm-field" placeholder="Cairo, Egypt" />
        </Field>
        <Field label="Cairo — phone numbers (separate with commas)">
          <input value={settings.contactCairoPhones ?? ""} onChange={e => set("contactCairoPhones", e.target.value)} className="adm-field" placeholder="+20 110 090 0617, +20 114 321 9416" />
        </Field>
        <Field label="Riyadh — label">
          <input value={settings.contactRiyadhLabel ?? ""} onChange={e => set("contactRiyadhLabel", e.target.value)} className="adm-field" placeholder="Riyadh, KSA" />
        </Field>
        <Field label="Riyadh — phone numbers (separate with commas)">
          <input value={settings.contactRiyadhPhones ?? ""} onChange={e => set("contactRiyadhPhones", e.target.value)} className="adm-field" placeholder="+966 56 742 2977" />
        </Field>
        <Field label="WhatsApp number">
          <input value={settings.contactWhatsapp ?? ""} onChange={e => set("contactWhatsapp", e.target.value)} className="adm-field" placeholder="+966 56 742 2977" />
          <p className="text-white/30 text-[11px] mt-1">
            Shown as the WhatsApp link under the Riyadh numbers. Clear it to hide the link.
          </p>
        </Field>
        <Field label="Studio Management — label">
          <input value={settings.contactManagementLabel ?? ""} onChange={e => set("contactManagementLabel", e.target.value)} className="adm-field" placeholder="Studio Management" />
        </Field>
        <Field label="Studio Management — name">
          <input value={settings.contactManagementName ?? ""} onChange={e => set("contactManagementName", e.target.value)} className="adm-field" placeholder="Hazem Kamal" />
        </Field>
        <Field label="Studio Management — email">
          <input value={settings.contactManagementEmail ?? ""} onChange={e => set("contactManagementEmail", e.target.value)} className="adm-field" placeholder="Hazem@takestwostudio.com" />
        </Field>
      </div>

      <button
        onClick={save}
        disabled={saving || !dirty}
        className="border border-white/30 px-6 py-3 text-[11px] tracking-[0.3em] uppercase hover:bg-white hover:text-black transition-colors disabled:opacity-40"
      >
        {saving ? "Saving…" : dirty ? "Save Changes" : "Saved"}
      </button>
    </div>
  );
}

/* ---------------- Image maintenance ----------------
   Re-encodes derivatives from their masters so existing images pick up the
   higher AVIF quality on the large rungs. Batched: one 4500px master is ~15s of
   AVIF on this hosting, so a single request over the whole library would be
   killed long before it finished. Regeneration is in place — same urls — so a
   run stopped halfway leaves a consistent site. */
function RegeneratePanel() {
  const [stats, setStats] = useState<{ total: number; withMaster: number; withoutMaster: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [failures, setFailures] = useState<{ id: string; error: string }[]>([]);
  const [finished, setFinished] = useState(false);
  const stopRef = useRef(false);

  // Same shape as the other tabs: the loader is defined inside the effect and
  // exposed through a ref, so nothing calls setState straight from the effect
  // body.
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    const load = async () => {
      const r = await fetch(API("/images/regenerate"), { cache: "no-store" });
      if (r.ok) setStats(await r.json());
    };
    refreshRef.current = load;
    load();
  }, []);

  async function linkExistingMasters() {
    const r = await fetch(API("/images/regenerate"), { method: "PUT" });
    const j = await r.json().catch(() => null);
    alert(j ? `Scanned ${j.scanned} images, linked ${j.linked} original${j.linked === 1 ? "" : "s"}.` : "Scan failed.");
    refreshRef.current();
  }

  /** Measure the colour space of masters that have not been checked yet.
   *  Loops in batches like `run()` does, for the same reason, but each batch is
   *  only reading file headers so it finishes quickly. */
  async function checkColourSpaces() {
    let measured = 0;
    for (;;) {
      const r = await fetch(API("/images/regenerate"), { method: "PATCH" });
      const j = await r.json().catch(() => null);
      if (!j || !r.ok) { alert("Colour-space check failed."); return; }
      measured += j.measured;
      if (j.finished) break;
    }
    alert(
      measured === 0
        ? "Every original on file has already been checked."
        : `Checked ${measured} original${measured === 1 ? "" : "s"}. Any that are not sRGB now carry a warning in the project editor.`
    );
    refreshRef.current();
  }

  async function run() {
    setRunning(true); setDone(0); setFailures([]); setFinished(false); stopRef.current = false;
    let cursor: string | null = null;
    // Sequential by design: the point of batching is to stay inside the
    // hosting's CPU budget, which parallel batches would defeat.
    for (;;) {
      if (stopRef.current) break;
      const r = await fetch(API("/images/regenerate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cursor }),
      });
      if (!r.ok) { alert("Regeneration failed — stopping."); break; }
      const j = await r.json();
      setDone(d => d + j.processed);
      setRemaining(j.remaining);
      if (j.failed?.length) setFailures(f => [...f, ...j.failed]);
      cursor = j.cursor;
      if (j.finished) { setFinished(true); break; }
    }
    setRunning(false);
    refreshRef.current();
  }

  return (
    <div className="space-y-4 mb-10">
      <h3 className="text-[10px] tracking-[0.3em] uppercase text-white/40 pb-2 border-b border-white/10">Image Maintenance</h3>
      <p className="text-white/50 text-sm max-w-xl">
        Re-encodes existing images from their originals so they pick up the higher quality on the
        large sizes. Runs in small batches; you can stop and resume at any time, and the site stays
        consistent throughout because images keep their existing addresses.
      </p>

      {stats && (
        <div className="flex gap-6 flex-wrap text-sm">
          <span className="text-white/60">{stats.total} pipeline images</span>
          <span className="text-emerald-400/90">{stats.withMaster} with an original</span>
          <span className="text-amber-400/90">{stats.withoutMaster} without</span>
        </div>
      )}
      {stats && stats.withoutMaster > 0 && (
        <p className="text-amber-400/80 text-xs max-w-xl">
          The {stats.withoutMaster} without an original are skipped — they arrived as finished
          images and no original was ever on the server. Re-encoding those from their own output
          would make them worse, not better. Attach originals from the project editor to bring them in.
        </p>
      )}

      <div className="flex gap-3 flex-wrap items-center">
        <button
          onClick={run}
          disabled={running || !stats || stats.withMaster === 0}
          className="text-[11px] tracking-[0.2em] uppercase border border-white/30 px-4 py-2 hover:bg-white hover:text-black transition-colors disabled:opacity-40"
        >{running ? "Regenerating…" : "Regenerate derivatives"}</button>
        {running && (
          <button
            onClick={() => { stopRef.current = true; }}
            className="text-[11px] tracking-[0.2em] uppercase border border-amber-400/50 text-amber-400 px-4 py-2 hover:bg-amber-400 hover:text-black transition-colors"
          >Stop after this batch</button>
        )}
        <button
          onClick={linkExistingMasters}
          disabled={running}
          className="text-[11px] tracking-[0.2em] uppercase text-white/50 hover:text-white disabled:opacity-40"
        >Re-scan for originals</button>
        <button
          onClick={checkColourSpaces}
          disabled={running}
          title="Read each original's colour profile. Reads file headers only — it does not re-encode anything."
          className="text-[11px] tracking-[0.2em] uppercase text-white/50 hover:text-white disabled:opacity-40"
        >Check colour spaces</button>
      </div>

      {(running || done > 0) && (
        <p className="text-white/60 text-sm">
          {done} regenerated{remaining !== null && ` · ${remaining} to go`}
          {finished && " · finished"}
        </p>
      )}
      {failures.length > 0 && (
        <div className="text-red-400/80 text-xs">
          <p>{failures.length} failed:</p>
          <ul className="list-disc pl-5">
            {failures.slice(0, 5).map(f => <li key={f.id}>{f.id.slice(0, 8)} — {f.error}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------- Clients Tab ---------------- */
function ClientsTab() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newLogo, setNewLogo] = useState("");
  const [adding, setAdding] = useState(false);

  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const r = await fetch(API("/clients"), { cache: "no-store" });
      const j = await r.json();
      setClients(j.clients || []);
      setLoading(false);
    };
    refreshRef.current = load;
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    const r = await fetch(API("/clients"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), logo: newLogo.trim() || null }),
    });
    setAdding(false);
    if (r.ok) {
      setNewName(""); setNewLogo("");
      refreshRef.current();
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this client?")) return;
    await fetch(API(`/clients/${id}`), { method: "DELETE" });
    refreshRef.current();
  }

  async function uploadLogo(id: string, file: File) {
    const u = await postUpload(file);
    if (u) {
      // Client.logo is a bare string too — fallback url only.
      await fetch(API(`/clients/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logo: u.url }),
      });
      refreshRef.current();
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  /** Drag order becomes the order on the public grid. Optimistic, then saved. */
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = clients.findIndex(c => c.id === active.id);
    const newIndex = clients.findIndex(c => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(clients, oldIndex, newIndex);
    setClients(next);
    const r = await fetch(API("/clients/reorder"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map(c => c.id) }),
    });
    if (!r.ok) alert("Could not save the new order.");
    refreshRef.current();
  }

  if (loading) return <p className="text-white/50">Loading…</p>;

  return (
    <div>
      <p className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">{clients.length} Clients</p>
      <h2 className="font-serif text-2xl mb-2">Clients</h2>
      <p className="text-white/50 text-sm mb-8 max-w-xl">
        Add the brands and publications your studio has worked with. They appear on the public Clients page.
      </p>

      {/* Add form */}
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 mb-8 border border-white/10 p-4">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[9px] tracking-[0.2em] uppercase text-white/30 mb-1">Name</label>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Vogue" className="w-full bg-transparent border-b border-white/15 pb-1 text-white focus:outline-none focus:border-white transition-colors" />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[9px] tracking-[0.2em] uppercase text-white/30 mb-1">Logo URL (optional)</label>
          <input value={newLogo} onChange={e => setNewLogo(e.target.value)} placeholder="/uploads/vogue.png" className="w-full bg-transparent border-b border-white/15 pb-1 text-white focus:outline-none focus:border-white transition-colors" />
        </div>
        <button type="submit" disabled={adding} className="text-[11px] tracking-[0.2em] uppercase border border-white/30 px-4 py-2 hover:bg-white hover:text-black transition-colors disabled:opacity-50">
          {adding ? "…" : "+ Add"}
        </button>
      </form>

      {/* List */}
      {clients.length === 0 ? (
        <p className="text-white/50">No clients yet. Add one above.</p>
      ) : (
        <>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 mb-3">
            Drag ⠿ to reorder — this is the order they appear on the public grid
          </p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={clients.map(c => c.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {clients.map((c, i) => (
                  <SortableClientCard
                    key={c.id}
                    c={c}
                    index={i}
                    onRemove={remove}
                    onUploadLogo={uploadLogo}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}
    </div>
  );
}

/* Client row, draggable by its ⠿ grip. The grip carries the listeners rather
   than the card, so the delete button and the upload-logo file input keep
   working — a card-wide drag would swallow both. */
function SortableClientCard({ c, index, onRemove, onUploadLogo }: {
  c: Client;
  index: number;
  onRemove: (id: string) => void;
  onUploadLogo: (id: string, file: File) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="border border-white/10 p-4 flex items-center gap-3">
      <button
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${c.name}`}
        title="Drag to reorder"
        className="flex-shrink-0 px-1 text-white/30 hover:text-white/80 cursor-grab active:cursor-grabbing touch-none"
      >⠿</button>
      <span className="text-[10px] tracking-[0.2em] uppercase text-white/30">{String(index + 1).padStart(2, "0")}</span>
      {c.logo ? (
        <img src={c.logo} alt={c.name} loading="lazy" decoding="async" className="w-12 h-12 object-contain bg-white/5 p-1" draggable={false} />
      ) : (
        <div className="w-12 h-12 flex items-center justify-center bg-white/5 font-serif text-lg italic text-white/60">{c.name.charAt(0)}</div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-serif text-lg truncate">{c.name}</p>
        <label className="text-[9px] tracking-[0.2em] uppercase text-white/30 cursor-pointer hover:text-white/60">
          Upload logo
          <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files && onUploadLogo(c.id, e.target.files[0])} />
        </label>
      </div>
      <button onClick={() => onRemove(c.id)} className="text-white/40 hover:text-red-400 text-lg px-1">×</button>
    </div>
  );
}
