# Frontend Feature → Backend Route Requirements

Dokumen ini dibuat dari pembacaan struktur fitur di folder frontend (`src/app/pages/**`) untuk memetakan route API yang diperlukan secara lengkap dan terkelompok.

Base API: `/api`

---

## 1) Authentication & Session
Sumber frontend:
- `pages/auth/AuthPage.tsx`
- `contexts/AuthContext.tsx`
- `pages/auth/VerificationPage.tsx`

### Route dibutuhkan
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`

### Status
- ✅ Sudah ada dan dipakai frontend auth context.

---

## 2) User Profile, Settings, Identity
Sumber frontend:
- `pages/common/SettingsPage.tsx`
- `pages/auth/VerificationPage.tsx`
- `pages/auth/EmiratesIDVerificationPage.tsx`

### Route dibutuhkan
- `GET /users/:id`
- `PATCH /users/:id`
- `PUT /users/:id/identity`
- `POST /verifications/submissions`
- `GET /verifications/submissions`
- `PATCH /verifications/submissions/:id/review`

### Status
- ✅ Sudah ada.
- ⚠️ Integrasi upload file verification masih metadata-level (belum object storage).

---

## 3) Marketplace (Listing discovery & detail)
Sumber frontend:
- `pages/marketplace/MarketplacePage.tsx`
- `pages/marketplace/MarketplaceDetailPage.tsx`
- `pages/marketplace/MarketPlaceGaragePage.tsx`

### Route dibutuhkan
- `GET /listings` (filter, search, pagination)
- `GET /listings/:id`
- `GET /listings/:id/media` *(opsional endpoint terpisah, saat ini via include di detail)*

### Status
- ✅ `GET /listings`, `GET /listings/:id` sudah ada.

---

## 4) Seller Listing Management
Sumber frontend:
- `pages/seller/PostListingPage.tsx`
- `pages/seller/EditListingPage.tsx`
- `pages/seller/ListingPage.tsx`
- `pages/seller/ManageListingDetailPage.tsx`

### Route dibutuhkan
- `POST /listings` (create listing)
- `PATCH /listings/:id` (edit listing)
- `DELETE /listings/:id`
- `POST /listings/:id/media`
- `POST /listings/:id/maintenance-logs`
- `GET /listings/:id`
- `GET /listings?sellerId=...` *(recommended untuk page listing seller)*

### Status
- ✅ Create/edit/detail sudah terkoneksi untuk PostListing & EditListing.
- ✅ media dan maintenance endpoint tersedia.
- ⚠️ Filter `sellerId` di list endpoint direkomendasikan sebagai peningkatan berikutnya.

---

## 5) Group Buying, Workspace, Offer
Sumber frontend:
- `pages/group/CreateGroupPage.tsx`
- `pages/group/GroupWorkspacePage.tsx`
- `pages/group/JointOfferCreatorPage.tsx`
- `pages/group/OfferReviewPage.tsx`
- `pages/group/SocialPage.tsx`

### Route dibutuhkan
- `GET /groups`
- `POST /groups`
- `GET /groups/:id`
- `POST /groups/:id/members`
- `POST /groups/:id/invitations`
- `PATCH /groups/invitations/:invitationId`
- `GET /offers`
- `POST /offers`
- `PATCH /offers/:id`
- `PATCH /offers/:id/participants/:userId`

### Status
- ✅ Sudah tersedia.
- ✅ Frontend flow utama sudah terkoneksi ke backend untuk:
	- create group (`CreateGroupPage` → `POST /groups`)
	- create offer letter (`JointOfferCreatorPage` → `POST /offers` + `PATCH /offers/:id`)
	- review approval member (`OfferReviewPage` → `PATCH /offers/:id/participants/:userId`)
	- send offer to seller (`OfferReviewPage` admin action → `PATCH /offers/:id` status `PENDING_SELLER_REVIEW`)
- ⚠️ Invite member & group chat masih UI-local (belum full realtime backend flow).

---

## 6) Rental Flow
Sumber frontend:
- `pages/rental/RentalPage.tsx`
- `pages/rental/RentalBookingPage.tsx`
- `pages/rental/ActiveRentalPage.tsx`
- `pages/rental/RentalContractPage.tsx`

### Route dibutuhkan
- `GET /rentals`
- `POST /rentals`
- `PATCH /rentals/:id/status`
- `GET /listings?listingType=RENT`

### Status
- ✅ Sudah tersedia.
- ⚠️ Contract-specific endpoint belum dedicated (masih domain umum).

---

## 7) Chat & Notifications
Sumber frontend:
- `pages/group/ChatWithSellerPage.tsx`
- komponen notif/modal/header

### Route dibutuhkan
- `GET /conversations`
- `POST /conversations`
- `GET /conversations/:id/messages`
- `POST /conversations/:id/messages`
- `GET /notifications/:userId`
- `POST /notifications`
- `PATCH /notifications/:id/read`
- `PATCH /notifications/user/:userId/read-all`

### Status
- ✅ Sudah tersedia.

---

## 8) Promotions & Payments
Sumber frontend:
- `pages/common/PromotionPage.tsx`
- seller promote action

### Route dibutuhkan
- `GET /promotions`
- `POST /promotions`
- `PATCH /promotions/:id/status`
- `GET /payments`
- `POST /payments`
- `PATCH /payments/:id/status`

### Status
- ✅ Sudah tersedia.

---

## 9) Admin Dashboard & Analytics
Sumber frontend:
- `pages/admin/AdminDashboardPage.tsx`
- `pages/admin/AnalyticsPage.tsx`
- `pages/admin/tabs/*`

### Route dibutuhkan
- `GET /admin/dashboard-overview`
- `GET /admin/dashboard-charts?range=7D|30D|90D|1Y`
- `GET /admin/moderation-queue`
- `GET /verifications/submissions` (queue badge/doc review)
- `PATCH /verifications/submissions/:id/review`
- `GET /users`
- `PATCH /users/:id`
- `GET /listings`
- `PATCH /listings/:id`

### Status
- ✅ Endpoint dashboard admin + chart sudah ada.

---

## 10) Seller Dashboard & Analytics
Sumber frontend:
- `pages/seller/DashboardPage.tsx`

### Route dibutuhkan
- `GET /users/:id/dashboard/seller`
- `GET /users/:id/dashboard/seller/charts?range=7D|30D|90D|1Y`
- `GET /listings?sellerId=...`

### Status
- ✅ endpoint dashboard seller + chart sudah ada.
- ⚠️ filter `sellerId` untuk list listing direkomendasikan.

---

## 11) Garage
Sumber frontend:
- `pages/garage/MyGaragePage.tsx`
- `pages/garage/AddToGaragePage.tsx`

### Route dibutuhkan (recommended)
- `GET /garage/:userId`
- `POST /garage`
- `DELETE /garage/:id`

### Status
- ⚠️ Belum ada route dedicated garage (model DB sudah ada: `GarageAsset`).

---

## 12) Contract Domain
Sumber frontend:
- `pages/group/ContractPreviewPage.tsx`
- `pages/group/ContractualObligationsPage.tsx`
- `pages/rental/RentalContractPage.tsx`

### Route dibutuhkan (recommended)
- `GET /contracts/:id`
- `POST /contracts`
- `PATCH /contracts/:id/status`
- `POST /contracts/:id/signatures`

### Status
- ⚠️ Belum ada route dedicated contract (model DB sudah ada: `Contract`, `ContractSignature`).

---

## Ringkasan Prioritas Development Lanjutan
1. Tambah route dedicated `garage`.
2. Tambah route dedicated `contracts`.
3. Tambah filter `sellerId` pada `GET /listings`.
4. Integrasi upload file/media ke storage (S3/Cloudinary) agar URL media bukan data URL/object URL.
