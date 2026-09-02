# Aspadani Project — Web Manajemen Pribadi (Kanban) · Implementation Plan

> **For Hermes:** eksekusi milestone demi milestone, jangan lompat. Status: **DEPLOYED (v1)** — M0–M5 selesai & terverifikasi 2026-09-01/02; M6 deploy ke https://aspadani-project.aspadani.workers.dev (migrasi remote ✅, secret APP_PASSWORD diisi user).
> Disusun 2026-09-01. Klaim stack diverifikasi ke Context7 (bagian *Sumber verifikasi* di bawah).
> Keputusan 2026-09-01: alternatif **htmx + Alpine.js dievaluasi dan ditolak** — DnD (fitur inti kanban) memaksa htmx+SortableJS punya dua pemilik DOM; Alpine tak menyentuh drag sama sekali; jalur SPA selaras tujuan belajar full-stack TS. **Svelte SPA terkunci.**

**Goal:** Aplikasi manajemen pribadi bergaya Kanban — buat project dalam hitungan detik, isi task inline, geser kartu antar kolom — berjalan penuh di Cloudflare Workers (free tier), nanti diakses via subdomain aspadani.id.

**Architecture:** SPA Svelte 5 + Hono API di **satu** Worker. Static asset (output build Vite) dilayani Cloudflare Assets dengan SPA fallback; request `/api/*` diteruskan ke Hono yang bicara ke D1. Single-user, auth password + cookie sesi.

**Tech Stack:** Bun (toolchain), TypeScript, Svelte 5 (runes) + Vite + `@cloudflare/vite-plugin`, Hono, Cloudflare D1 + drizzle-orm/drizzle-kit, svelte-dnd-action (drag & drop), wrangler (dev + deploy).

---

## 1. Keputusan desain (dan koreksi dari diskusi)

| # | Keputusan | Alasan / koreksi terhadap brief awal |
|---|---|---|
| 1 | **Board per project**, bukan satu board global | Brief "project → todolist" jika dilempar ke satu board global akan berantakan begitu project >3. Setiap project punya papan sendiri; dashboard berisi daftar project. |
| 2 | **Buat project = 1 field nama + Enter.** Buat task = inline input di kolom + Enter | Brief: "mudah membuat project dan todolist". Tanpa modal, tanpa wizard. Detil (catatan, prioritas, due date) diisi belakangan lewat panel kartu. |
| 3 | **Svelte SPA, bukan Hono SSR** | Fungsionalitasnya 100% interaktif (drag&drop, optimistic update) — SSR tak menambah nilai, hanya menambah kompleksitas. Hono murni jadi API. Static asset dilayani Cloudflare Assets dengan `not_found_handling: "single-page-application"` (terverifikasi Context7) — fallback `/` → `index.html`, semua request non-asset tidak menyentuh Worker sama sekali (hemat kuota request). |
| 4 | **Satu Worker** untuk API + asset | Satu deploy, satu log, satu custom domain. Route conflict dihindari karena SPA fallback ada di layer Assets (bukan route Hono). |
| 5 | **Auth: password tunggal + cookie sesi.** Better Auth DITOLAK untuk v1 | Better Auth (OAuth, multi-user, tabel user/account/session) overkill untuk aplikasi single-user — menambah ~5 tabel dan konsep OAuth untuk satu pengguna. Password disimpan sebagai `wrangler secret`; sesi = tabel `sessions` (token hash, revokeable). Cloudflare Access bisa jadi upgrade opsional saat domain aktif — dicatat, bukan di-scope. |
| 6 | **DnD: svelte-dnd-action** | Terverifikasi Context7: pola kanban multi-zone (`type` sama antar kolom, `consider`/`finalize`) terdokumentasi lengkap, 411 snippet (terbanyak di kelasnya). Risiko Svelte 5 event syntax dicatat di bagian risiko; fallback jika macet: tombol naik/turun (tetap fungsional tanpa drag). |
| 7 | **Drizzle-orm + drizzle-kit** untuk D1 | Konsisten jalur belajar full-stack TS + type-safe; migrasi di-generate ke folder `drizzle/`, dijalankan via `wrangler d1 migrations apply`. Alternatif raw SQL ditolak karena kehilangan tipe tanpa menghemat banyak konsep. |
| 8 | Timestamps = TEXT ISO/datetime SQLite | Bisa dibaca langsung di konsol D1; cukup untuk personal tool (tanpa lebar-kurang UTC epoch juggling). |
| 9 | "Selesai" = property kolom (`is_done`), bukan flag di task | Kartu selesai = berada di kolom bertanda `is_done`. Dashboard menghitung task aktif dari situ. Satu sumber kebenaran. |
| 10 | Reorder = array order → batch reindex | `PATCH /api/board/:id/order` menerima urutan id hasil drag, server renumber kolom tsb dalam satu `batch()`. Sederhana, cukup untuk skala personal. |

## 2. Peta fitur v1

- **Login** halaman tunggal (password).
- **Dashboard `/`**: daftar project (nama, warna, jumlah task aktif), tombol + (1 field), arsip project, klik → board.
- **Board `/p/:id`**: kolom kanban (default baru: Backlog / Sedang Dikerjakan / Selesai), drag kartu antar kolom + reorder dalam kolom, tambah kolom, rename/hapus kolom, tambah task inline per kolom.
- **Panel detail kartu** (klik): judul, catatan, prioritas (none/low/med/high), due date, hapus.
- **Non-fitur (YAGNI v1):** multi-user, label, komentar, lampiran, notifikasi, filter/pencarian, SSE/realtime, PWA offline.

## 3. Struktur proyek (mengikuti scaffold `bun create hono` template `cloudflare-workers+vite`, lalu disesuaikan)

```
web pribadi aspadani/            ← root = git repo saspadani/aspadani-project
├─ src/
│  ├─ client/                    ← SPA Svelte 5
│  │  ├─ index.html · main.ts · App.svelte
│  │  ├─ lib/                    api.ts, types.ts, state.svelte.ts
│  │  └─ pages/                  Login.svelte, Dashboard.svelte, Board.svelte
│  └─ worker/
│     ├─ index.ts                ← export default { fetch: app.fetch }
│     ├─ app.ts                  ← Hono, mount route /api/*
│     ├─ middleware/auth.ts
│     ├─ routes/                 auth.ts, projects.ts, board.ts, tasks.ts
│     └─ db/                     schema.ts (drizzle), index.ts
├─ drizzle/                      ← migrations SQL (drizzle-kit generate)
├─ wrangler.jsonc
├─ vite.config.ts · svelte.config.js
└─ package.json
```

**wrangler.jsonc (draf; ID D1 diisi di M0):**
```jsonc
{
  "name": "aspadani-project",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "not_found_handling": "single-page-application" },
  "d1_databases": [{ "binding": "DB", "database_name": "aspadani-project",
                     "database_id": "TODO-M0", "migrations_dir": "drizzle" }],
  "observability": { "enabled": true }
}
```

**Scripts package.json:** `dev` = `vite` (plugin Cloudflare: worker + asset hot-reload satu port), `build` = `vite build`, `deploy` = `vite build && wrangler deploy`, `test` = `vitest`.

## 4. Data model (D1, drizzle)

```sql
projects  (id TEXT PK, name TEXT NOT NULL, color TEXT DEFAULT '#6366f1',
           sort INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now')))

columns   (id TEXT PK, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
           name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
           is_done INTEGER NOT NULL DEFAULT 0)

tasks     (id TEXT PK, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
           column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
           title TEXT NOT NULL, notes TEXT DEFAULT '',
           priority TEXT NOT NULL DEFAULT 'none',   -- none|low|med|high
           due_date TEXT,                            -- 'YYYY-MM-DD' | NULL
           sort INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now')))

sessions  (token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL)

-- Index wajib (CPU 10ms Workers):
idx_columns_project ON columns(project_id, sort)
idx_tasks_column    ON tasks(column_id, sort)
idx_tasks_project   ON tasks(project_id)
```

`id` = `crypto.randomUUID()` di sisi aplikasi. Hapus project = hard delete (arsip lewat `archived=1`).

## 5. API (semua JSON; kecuali `/api/login` dijaga middleware sesi)

```
POST   /api/login                 {password} → Set-Cookie ap_session (HttpOnly, Secure, SameSite=Strict, 30d)
POST   /api/logout
GET    /api/me
GET    /api/projects              → [{...project, activeTaskCount}]
POST   /api/projects              {name, color?}            ← buat project + 3 kolom default (1 transaksi batch)
GET    /api/projects/:id/board    → {project, columns, tasks}
PATCH  /api/projects/:id          {name?, color?, archived?, sort?}
DELETE /api/projects/:id
POST   /api/projects/:id/columns  {name}
PATCH  /api/columns/:id           {name?, is_done?, sort?}
DELETE /api/columns/:id
PATCH  /api/board/:projectId/order {columns:[{id,sort}], tasks:[{id,columnId,sort}]}  ← hasil drag
POST   /api/projects/:id/tasks    {title, columnId?}
PATCH  /api/tasks/:id             {title?, notes?, priority?, dueDate?, columnId?, sort?}
DELETE /api/tasks/:id
```

**Auth:** secret `APP_PASSWORD` (`wrangler secret put`). Login: bandingkan konstanta-time, hash token = SHA-256(token), simpan `sessions`, hapus sesi kadaluarsa saat login. Gagal login >5×/IP/menit → 429 (map in-memory, pola dari skill cloudflare-workers).

**Sync client:** optimistic update pada `finalize` drag & submit form; gagal → rollback state + toast. Tanpa SSE/WebSocket (YAGNI untuk 1 user; tab ganda masih aman karena setiap aksi refetch board yang terbuka).

## 6. Roadmap milestone

Setiap milestone: selesai = commit + push + verifikasi yang tertulis. Implementasi internal per-task mengikuti pola TDD ringan (test dulu untuk logic API; UI cukup `svelte-check` + checklist manual).

### M0 — Prasyarat (±30 mnt)
1. `git init` di folder target, remote `origin` = https://github.com/saspadani/aspadani-project.git, push commit awal (README + .gitignore node_modules/dist/.wrangler/.dev.vars).
2. `wrangler login` (browser). Buat DB: `wrangler d1 create aspadani-project` → catat `database_id` → isi wrangler.jsonc.
3. Set secret: `wrangler secret put APP_PASSWORD` (user mengetik sendiri; agent tidak boleh pegang password).
   **Verifikasi:** `wrangler whoami` tampil; `wrangler d1 list` memuat DB; `git ls-remote` OK.

### M1 — Scaffold jalan lokal (±1 jam)
1. `bun create hono` (template `cloudflare-workers+vite`) ke dalam repo → rapikan struktur src/worker + src/client (Svelte, bukan React).
2. vite.config.ts: `plugins: [svelte(), cloudflare()]`; svelte.config.js + `vitePreprocess`; tsconfig strict.
3. Halaman: Hono `GET /api/health` → `{ok:true}`; App.svelte menampilkan "Aspadani Project".
   **Verifikasi:** `bun run dev` → buka localhost, teks tampil; `curl /api/health` 200. Commit + push.

### M2 — D1 + drizzle + migrasi (±1 jam)
1. Install drizzle-orm, drizzle-kit. `src/worker/db/schema.ts` sesuai bagian 4. `drizzle-kit generate` → `drizzle/0001_*.sql`.
2. Local: `wrangler d1 migrations apply aspadani-project --local`.
   **Verifikasi:** `bunx wrangler d1 execute aspadani-project --local --command "SELECT name FROM sqlite_master WHERE type='table'"` memuat 4 tabel. Commit + push.

### M3 — Auth (±1.5 jam)
1. Route login/logout/me + middleware guard semua `/api/*` (401 JSON konsisten).
2. Vitest + `@cloudflare/vitest-pool-workers`: test login sukses/gagal, akses tanpa cookie = 401, logout mencabut sesi.
   **Verifikasi:** test pass; manual: login dari UI → cookie terpasang → refresh tetap masuk. Commit + push.

### M4 — Projects + dashboard (±2 jam)
1. API projects (lihat bagian 5) + test CRUD & transaksi kolom default.
2. UI Dashboard: grid kartu project, form +project (1 field), arsip/hapus, badge jumlah task aktif.
   **Verifikasi:** buat 3 project via UI → muncul + persist setelah refresh (dibaca dari D1, bukan state lokal). Commit + push.

### M5 — Board + tasks + DnD (±3 jam) ← inti
1. API board/tasks/order + test: reorder menjaga `sort` unik & konsisten; pindah kolom mengubah `column_id`.
2. UI Board: kolom, kartu, `svelte-dnd-action` (multi-zone `type:"card"`, `consider`/`finalize`), optimistic + rollback; panel detail kartu; inline add task; tambah/rename/hapus kolom.
   **Verifikasi:** drag kartu antar kolom → refresh → posisi tersimpan; drag dalam kolom → urutan tersimpan; offline/500 simulasi → state rollback. Checklist manual + test API pass. Commit + push.

### M6 — Deploy + polish (±1.5 jam)
1. `bun run deploy` → `https://aspadani-project.<subdomain>.workers.dev`. Terapkan migrasi remote: `wrangler d1 migrations apply aspadani-project --remote`.
2. Polish: empty states, toast error, favicon, meta viewport, responsive (board = scroll horizontal di ponsel).
   **Verifikasi:** buka URL workers.dev dari HP → login → drag kartu dari ponsel berfungsi. Commit + push + tag `v1.0`.

### Pasca-v1 (tidak dijadwalkan)
Custom domain `kanban.aspadani.id` (atau nama lain) — butuh zone aspadani.id di akun Cloudflare yang sama; keputusan `routes` saat itu. Cloudflare Access sebagai alternatif auth. Ekspor/backup D1 berkala.

## 7. Risiko & trade-off (jujur)

1. **svelte-dnd-action × Svelte 5** — snippet Context7 masih memakai sintaks event `on:consider` (Svelte 4); versi terbaru memakai `onconsider`. Diverifikasi saat M5 mulai; kalau tidak kompatibel → turun ke tombol reorder (fitur tetap utuh, hanya tanpa drag).
2. **Optimistic sync tanpa realtime** — dua tab membuka board sama → tab kedua melihat data basi sampai aksi/refetch. Diterima untuk personal tool; solusi murah: refetch board saat `visibilitychange`.
3. **Workers 10ms CPU** — risiko rendah untuk skala ini, tetap disiplin: index terpasang (M2), tanpa `SELECT *` di path panas, reorder via `batch()`.
4. **Free tier** — 100k req/day & D1 5GB jauh melampaui kebutuhan 1 pengguna; bukan bottleneck.
5. **Folder proyek di `Videos\`** — bukan pohon OneDrive, aman dari sinkronisasi node_modules; dikonfirmasi sebelum scaffold.
6. **`wrangler d1 execute --local` saat `bun run dev` hidup** kadang konflik lock SQLite — jalankan migrasi saat dev server berhenti (langkah M2 ditulis demikian).
7. **Single secret auth** — kekuatan = kekuatan password. Minimal 16 karakter acak; rotasi = ganti secret (sesi lama tetap valid sampai habis — acceptable, revoke manual via tabel sessions).

## 8. Pertanyaan terbuka (jawab sebelum M0)

1. **Auth** — setuju password tunggal (secret `APP_PASSWORD`)? Atau menunggu Cloudflare Access ketika domain aktif (berarti v1 tanpa login sendiri, board terbuka di workers.dev — tidak disarankan)?
2. **ORM** — setuju drizzle (bukan raw SQL)?

---

*Sumber verifikasi Context7 (2026-09-01): /websites/developers_cloudflare_workers (asset routing, SPA `not_found_handling`, wrangler deploy), /sveltejs/svelte (runes $state/$derived/$props, vitePreprocess), /isaachagoel/svelte-dnd-action (kanban multi-zone), /websites/hono_dev (template cloudflare-workers+vite, static assets). Lingkungan tercek: bun 1.3.14, git 2.53, folder target ada & kosong, repo GitHub kosong.*
