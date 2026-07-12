"use client";

import { useState, useEffect, useRef } from "react";

/* =================================================================
   Takestwo Studio — Admin Panel
   Login + Project management (create/edit/delete, upload images)
   + Inquiry inbox. Single client component.
   ================================================================= */

type Image = { id: string; url: string; caption: string | null; order: number };
type Project = {
  id: string;
  title: string;
  category: string;
  coverImage: string;
  description: string | null;
  order: number;
  published: boolean;
  createdAt: string;
  images: Image[];
};
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

const API = (p: string) => `/api${p}`;

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"projects" | "inquiries">("projects");

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
      <div className="flex gap-2 mb-8 border-b border-white/10">
        <TabBtn active={tab === "projects"} onClick={() => setTab("projects")}>Projects</TabBtn>
        <TabBtn active={tab === "inquiries"} onClick={() => setTab("inquiries")}>Inquiries</TabBtn>
      </div>

      {tab === "projects" ? <ProjectsTab /> : <InquiriesTab />}
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
        <p className="text-white/30 text-[10px] mt-8 text-center">Default password: takes-two-admin-2024</p>
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

  if (editing) {
    return <ProjectEditor project={editing === "new" ? null : editing} onClose={() => { setEditing(null); refreshRef.current(); }} />;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <p className="text-[10px] tracking-[0.3em] uppercase text-white/40">{projects.length} Projects</p>
        <button onClick={() => setEditing("new")}
          className="text-[11px] tracking-[0.2em] uppercase border border-white/30 px-4 py-2 hover:bg-white hover:text-black transition-colors">
          + New Project
        </button>
      </div>

      {loading ? <p className="text-white/50">Loading…</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map(p => (
            <div key={p.id} className="border border-white/10 p-4 flex gap-4">
              <img src={p.coverImage} alt={p.title} className="w-20 h-20 object-cover flex-shrink-0 bg-white/5" />
              <div className="flex-1 min-w-0">
                <h3 className="font-serif text-lg truncate">{p.title}</h3>
                <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 mt-1">
                  {p.category} · {p.images.length} img{p.images.length !== 1 ? "s" : ""} · {p.published ? "Published" : "Draft"}
                </p>
                <div className="flex gap-3 mt-3">
                  <button onClick={() => setEditing(p)} className="text-[10px] tracking-[0.2em] uppercase text-white/70 hover:text-white">Edit</button>
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

/* ---------------- Project Editor ---------------- */
function ProjectEditor({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const [title, setTitle] = useState(project?.title || "");
  const [category, setCategory] = useState(project?.category || "advertising");
  const [coverImage, setCoverImage] = useState(project?.coverImage || "");
  const [description, setDescription] = useState(project?.description || "");
  const [order, setOrder] = useState(project?.order ?? 0);
  const [published, setPublished] = useState(project?.published ?? true);
  const [images, setImages] = useState<Image[]>(project?.images || []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const pid = project?.id;

  async function saveProject(): Promise<string | null> {
    setSaving(true);
    const body = { title, category, coverImage, description, order, published };
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
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(API("/upload"), { method: "POST", body: fd });
      if (r.ok) { const j = await r.json(); urls.push(j.url); }
    }
    setUploading(false);

    if (asCover && urls[0]) setCoverImage(urls[0]);

    if (!asCover && pid && urls.length) {
      // add as gallery images
      for (const u of urls) {
        await fetch(API(`/projects/${pid}/images`), {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u })
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
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />
            Published
          </label>

          {/* Cover image */}
          <Field label="Cover Image">
            <div className="flex gap-3 items-start">
              {coverImage && <img src={coverImage} alt="cover" className="w-24 h-24 object-cover bg-white/5" />}
              <div className="flex-1">
                <input value={coverImage} onChange={e => setCoverImage(e.target.value)} placeholder="/shoots/x.jpg or upload" className="adm-field mb-2" />
                <input type="file" accept="image/*" onChange={e => e.target.files && uploadFiles(e.target.files, true)} disabled={uploading} className="text-[10px] text-white/50" />
              </div>
            </div>
          </Field>

          <button onClick={handleSave} disabled={saving}
            className="border border-white/30 px-6 py-3 text-[11px] tracking-[0.3em] uppercase hover:bg-white hover:text-black transition-colors disabled:opacity-50">
            {saving ? "Saving…" : pid ? "Update Project" : "Create Project"}
          </button>
        </div>

        {/* Right: gallery images */}
        <div>
          <Field label={`Gallery Images (${images.length})`}>
            {!pid ? (
              <p className="text-white/40 text-sm">Save the project first, then upload gallery images.</p>
            ) : (
              <>
                <input type="file" accept="image/*" multiple onChange={e => e.target.files && uploadFiles(e.target.files, false)} disabled={uploading} className="text-[10px] text-white/50 mb-4" />
                <div className="grid grid-cols-3 gap-3">
                  {images.map(img => (
                    <div key={img.id} className="relative group">
                      <img src={img.url} alt={img.caption || ""} className="w-full aspect-square object-cover bg-white/5" />
                      <button onClick={() => removeImage(img.id)} className="absolute top-1 right-1 bg-black/70 text-white w-6 h-6 text-sm opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                    </div>
                  ))}
                  {images.length === 0 && <p className="text-white/30 text-sm col-span-3">No gallery images yet.</p>}
                </div>
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
