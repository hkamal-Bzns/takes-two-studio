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
type Image = { id: string; url: string; caption: string | null; order: number } & Derivatives;
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
type OverviewItem = {
  id: string;
  url: string;
  projectId: string | null;
  caption: string | null;
  order: number;
};

const API = (p: string) => `/api${p}`;

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
      const r = await fetch(API("/projects?category=all"), { cache: "no-store" });
      const j = await r.json();
      setProjects(j.projects || []);
      setLoading(false);
    };
    refreshRef.current = load;
    load();
  }, []);

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map(p => (
            <div key={p.id} className={`border p-4 flex gap-4 ${p.overview ? "border-sky-400/40 bg-sky-400/5" : p.featured ? "border-yellow-400/40 bg-yellow-400/5" : "border-white/10"}`}>
              <img src={p.coverImage} alt={p.title} className="w-20 h-20 object-cover flex-shrink-0 bg-white/5" />
              <div className="flex-1 min-w-0">
                <h3 className="font-serif text-lg truncate flex items-center gap-2 flex-wrap">
                  {p.title}
                  {p.overview && <span className="text-sky-400 text-[9px] tracking-[0.2em] uppercase border border-sky-400/40 px-1.5 py-0.5">Overview</span>}
                  {p.featured && <span className="text-yellow-400 text-[9px] tracking-[0.2em] uppercase border border-yellow-400/40 px-1.5 py-0.5">★ Slideshow</span>}
                </h3>
                <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 mt-1">
                  {p.category} · {p.images.length} img{p.images.length !== 1 ? "s" : ""} · {p.published ? "Published" : "Draft"}
                </p>
                <div className="flex gap-3 mt-3 flex-wrap">
                  <button onClick={() => setEditing(p)} className="text-[10px] tracking-[0.2em] uppercase text-white/70 hover:text-white">Edit</button>
                  <button onClick={() => toggleOverview(p)} className={`text-[10px] tracking-[0.2em] uppercase ${p.overview ? "text-sky-400" : "text-white/50 hover:text-sky-400"}`}>
                    {p.overview ? "◆ On Overview" : "◇ Add to Overview"}
                  </button>
                  <button onClick={() => toggleFeatured(p)} className={`text-[10px] tracking-[0.2em] uppercase ${p.featured ? "text-yellow-400" : "text-white/50 hover:text-yellow-400"}`}>
                    {p.featured ? "★ Slideshow" : "☆ Add to slideshow"}
                  </button>
                  <button onClick={() => remove(p.id)} className="text-[10px] tracking-[0.2em] uppercase text-red-400/70 hover:text-red-400">Delete</button>
                </div>
              </div>
            </div>
          ))}
          {projects.length === 0 && <p className="text-white/50 col-span-2">No projects yet. Click “New Project” to add one.</p>}
        </div>
      )}
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

  // build a flat list of all available images (cover + gallery) for the picker
  const allImages: { url: string; projectId: string; title: string; category: string }[] = [];
  for (const p of allProjects) {
    allImages.push({ url: p.coverImage, projectId: p.id, title: p.title, category: p.category });
    for (const img of p.images) {
      if (img.url !== p.coverImage) {
        allImages.push({ url: img.url, projectId: p.id, title: p.title, category: p.category });
      }
    }
  }
  const itemUrls = new Set(items.map(i => i.url));
  const filtered = pickerFilter
    ? allImages.filter(a => a.title.toLowerCase().includes(pickerFilter.toLowerCase()) || a.category.includes(pickerFilter.toLowerCase()))
    : allImages;

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
          <div className="flex items-center gap-3 mb-4">
            <input value={pickerFilter} onChange={e => setPickerFilter(e.target.value)} placeholder="Filter by project title or category…" className="flex-1 bg-transparent border-b border-white/15 pb-1 text-white text-sm focus:outline-none focus:border-white" />
            <span className="text-[10px] tracking-[0.2em] uppercase text-white/40">{filtered.length} available</span>
          </div>
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
                  <img src={img.url} alt={img.title} className="w-full h-full object-cover" />
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
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 mb-3">Drag to reorder (top = first on page)</p>
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
      <img src={item.url} alt={item.caption || ""} className="w-full aspect-square object-cover bg-white/5 pointer-events-none" draggable={false} />
      <span className="absolute top-1 left-1 bg-black/70 text-white/80 text-[9px] w-5 h-5 flex items-center justify-center pointer-events-none">{String(index + 1).padStart(2, "0")}</span>
      <span className="absolute top-1 left-7 bg-black/70 text-white/50 text-[9px] px-1 h-5 flex items-center pointer-events-none">⠿</span>
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
  const [saving, setSaving] = useState(false);
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

  const pid = project?.id;

  async function saveProject(): Promise<string | null> {
    setSaving(true);
    // coverDerivatives is set when the cover came from the pipeline. Sending
    // explicit nulls otherwise clears stale srcsets from a previous cover.
    const body = {
      title, category, coverImage, description, order, published, featured, overview,
      ...(coverDerivatives ?? { srcsetAvif: null, srcsetWebp: null, width: null, height: null }),
    };
    const url = pid ? API(`/projects/${pid}`) : API("/projects");
    const method = pid ? "PATCH" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { alert("Save failed"); return null; }
    const j = await r.json();
    return j.project.id;
  }

  async function uploadFiles(files: FileList, asCover: boolean) {
    if (!pid && !asCover) { alert("Save the project first before adding gallery images."); return; }
    setUploading(true);
    const uploaded: Uploaded[] = [];
    for (const file of Array.from(files)) {
      const u = await postUpload(file);
      if (u) uploaded.push(u);
    }
    setUploading(false);

    if (asCover && uploaded[0]) {
      const { url, ...derivatives } = uploaded[0];
      setCoverImage(url);
      setCoverDerivatives(derivatives);
    }

    if (!asCover && pid && uploaded.length) {
      // add as gallery images, carrying each manifest's derivatives
      for (const u of uploaded) {
        await fetch(API(`/projects/${pid}/images`), {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(u)
        });
      }
      // refresh images
      const r = await fetch(API(`/projects/${pid}`));
      const j = await r.json();
      setImages(j.project?.images || []);
    }
  }

  async function removeImage(imgId: string) {
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
    const oldIndex = images.findIndex(i => i.id === active.id);
    const newIndex = images.findIndex(i => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newImages = arrayMove(images, oldIndex, newIndex);
    setImages(newImages);
    // persist new order to backend
    if (pid) {
      await fetch(API(`/projects/${pid}/images/reorder`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: newImages.map(i => i.id) }),
      });
    }
  }

  async function handleSave() {
    const id = await saveProject();
    if (id) { alert("Saved"); onClose(); }
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
          <Field label="Cover Image">
            <div className="flex gap-3 items-start">
              {coverImage && <img src={coverImage} alt="cover" className="w-24 h-24 object-cover bg-white/5" />}
              <div className="flex-1">
                {/* Typing a path by hand points at an image with no manifest,
                    so any derivatives from a previous cover must be dropped. */}
                <input value={coverImage} onChange={e => { setCoverImage(e.target.value); setCoverDerivatives(null); }} placeholder="/shoots/x.jpg or upload" className="adm-field mb-2" />
                <input type="file" accept="image/*" onChange={e => e.target.files && uploadFiles(e.target.files, true)} disabled={uploading} className="text-[10px] text-white/50" />
              </div>
            </div>
          </Field>

          <button onClick={handleSave} disabled={saving}
            className="border border-white/30 px-6 py-3 text-[11px] tracking-[0.3em] uppercase hover:bg-white hover:text-black transition-colors disabled:opacity-50">
            {saving ? "Saving…" : pid ? "Update Project" : "Create Project"}
          </button>
        </div>

        {/* Right: gallery images (drag to reorder) */}
        <div>
          <Field label={`Gallery Images (${images.length})${images.length > 1 ? " — drag to reorder" : ""}`}>
            {!pid ? (
              <p className="text-white/40 text-sm">Save the project first, then upload gallery images.</p>
            ) : (
              <>
                <input type="file" accept="image/*" multiple onChange={e => e.target.files && uploadFiles(e.target.files, false)} disabled={uploading} className="text-[10px] text-white/50 mb-4" />
                {uploading && <p className="text-white/50 text-xs mb-2">Uploading…</p>}
                {images.length > 0 ? (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={images.map(i => i.id)} strategy={rectSortingStrategy}>
                      <div className="grid grid-cols-3 gap-3">
                        {images.map(img => (
                          <SortableImage key={img.id} img={img} onRemove={removeImage} />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <p className="text-white/30 text-sm">No gallery images yet.</p>
                )}
              </>
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
function SortableImage({ img, onRemove }: { img: Image; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
    touchAction: "none",
  };
  return (
    <div ref={setNodeRef} style={style} className="relative group select-none" {...attributes} {...listeners}>
      <img src={img.url} alt={img.caption || ""} className="w-full aspect-square object-cover bg-white/5 pointer-events-none" draggable={false} />
      <span className="absolute top-1 left-1 bg-black/70 text-white/70 text-[9px] w-5 h-5 flex items-center justify-center pointer-events-none">⠿</span>
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(img.id); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-1 right-1 bg-black/70 text-white w-6 h-6 text-sm opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >×</button>
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
                <img src={r.url} alt="" className="w-14 h-14 object-cover bg-white/5 flex-shrink-0" />
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
        <Field label="Contact eyebrow">
          <input value={settings.contactEyebrow || ""} onChange={e => set("contactEyebrow", e.target.value)} className="adm-field" placeholder="Get in Touch" />
        </Field>
        <Field label="Contact heading (use a period to split into two lines)">
          <input value={settings.contactHeading || ""} onChange={e => set("contactHeading", e.target.value)} className="adm-field" placeholder="For bookings & inquiries." />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {clients.map((c, i) => (
            <div key={c.id} className="border border-white/10 p-4 flex items-center gap-3">
              <span className="text-[10px] tracking-[0.2em] uppercase text-white/30">{String(i + 1).padStart(2, "0")}</span>
              {c.logo ? (
                <img src={c.logo} alt={c.name} className="w-12 h-12 object-contain bg-white/5 p-1" />
              ) : (
                <div className="w-12 h-12 flex items-center justify-center bg-white/5 font-serif text-lg italic text-white/60">{c.name.charAt(0)}</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-serif text-lg truncate">{c.name}</p>
                <label className="text-[9px] tracking-[0.2em] uppercase text-white/30 cursor-pointer hover:text-white/60">
                  Upload logo
                  <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files && uploadLogo(c.id, e.target.files[0])} />
                </label>
              </div>
              <button onClick={() => remove(c.id)} className="text-white/40 hover:text-red-400 text-lg px-1">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
