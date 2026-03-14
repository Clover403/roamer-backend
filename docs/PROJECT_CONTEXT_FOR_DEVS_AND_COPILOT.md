# Roamer Backend Context (for Developer & AI Copilot)

## 1) Tujuan Backend Saat Ini
Backend ini disiapkan untuk **menjadi source of truth** semua fitur di frontend Roamer, dengan stack:
- Express + TypeScript
- Prisma ORM + PostgreSQL
- Socket.IO (sudah scaffold)

Status saat ini:
- Endpoint sudah modular per domain.
- Controller sudah dipisah dari route (clean separation).
- Belum ada koneksi langsung ke frontend (sesuai request).

---

## 2) Struktur Arsitektur

## 2.1 Folder utama
- `src/routes` → deklarasi endpoint HTTP
- `src/controllers` → business logic tiap fitur
- `src/lib/prisma.ts` → prisma client singleton
- `src/socket` → setup socket (real-time chat/notif)

## 2.2 Pattern request
1. Request masuk ke route.
2. Route panggil controller via `asyncHandler`.
3. Controller validasi payload (Zod), query Prisma, kirim response JSON.

---

## 3) Domain Fitur yang Dicakup
Domain backend sudah disejajarkan dengan fitur frontend:

1. Auth & User Profile
2. Identity/Verification (Emirates ID, DL, Passport, Selfie)
3. Listings (sell/rent) + media + maintenance log
4. Group Buying + Invitation + Membership
5. Joint Offer + participant approval
6. Rental booking lifecycle
7. Conversations + Messages
8. Notifications
9. Promotions (banner ads)
10. Payments
11. Admin Dashboard (overview + charts + moderation queue)
12. Seller Dashboard (overview + charts)

---

## 4) Dashboard Contracts (penting untuk frontend integration)

## 4.1 Seller Dashboard
Endpoint:
- `GET /api/users/:id/dashboard/seller`
- `GET /api/users/:id/dashboard/seller/charts?range=7D|30D|90D|1Y`

Response overview memuat:
- `summary`: listing counts, pending rental requests, group/offer stats, unread convo, revenue
- `recent`: list rental terbaru + offer terbaru

Response charts memuat:
- `labels`: bucket harian (ISO date)
- `series`: `views`, `inquiries`, `offers`, `bookings`, `revenueAed`

## 4.2 Admin Dashboard
Endpoint:
- `GET /api/admin/dashboard-overview`
- `GET /api/admin/dashboard-charts?range=7D|30D|90D|1Y`
- `GET /api/admin/moderation-queue`

Response charts memuat:
- `series`: `listings`, `users`, `verifications`, `listingInquiries`, `revenueAed`

---

## 5) Konvensi Implementasi Lanjutan

1. **Tambahkan endpoint baru lewat controller dulu**, route hanya wiring.
2. Semua payload input pakai Zod.
3. Jangan akses prisma langsung dari route.
4. Query dashboard harus pakai date range helper agar konsisten.
5. Untuk endpoint yang dipakai chart, selalu kirim:
   - `range`
   - `labels`
   - `series` object

---

## 6) Catatan Penting untuk Tim

1. **Auth sudah JWT + httpOnly cookie** (`bcrypt` password hashing + cookie session token).
2. **RBAC belum enforcement penuh** (role ADMIN/USER baru di level data).
3. **Realtime event emission** (socket) belum dihubungkan ke controller message/notification.
4. **Error handler global** masih generic; next step bisa tambah formatter untuk Zod/Prisma errors.

---

## 7) Suggested Next Steps (Prioritas)

1. Tambah middleware auth + role guard.
2. Tambah service layer untuk logika kompleks (pricing, fee engine, approval flow).
3. Tambah pagination/filter di endpoint list besar (groups, offers, rentals, notifications).
4. Tambah endpoint contracts/garage/analytics kalau frontend mulai consume data real.
5. Tambah test:
   - unit test controller
   - integration test API (supertest)

---

## 8) Ringkasan untuk AI Copilot
Jika melanjutkan coding:
- cek `src/routes/*.ts` untuk endpoint,
- implementasi logic ada di `src/controllers/*.ts`,
- model data acuan ada di `prisma/schema.prisma`,
- jangan ubah frontend dari workspace ini kecuali diminta.

Fokus utama backend saat ini adalah **kelengkapan endpoint + kesiapan dashboard data**.
