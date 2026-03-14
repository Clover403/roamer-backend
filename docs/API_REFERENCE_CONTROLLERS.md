# API Reference & Controller Map

Base URL: `/api`

## Health
- `GET /health` → route-level handler (DB connectivity check)

## Auth
- `POST /auth/register` → `register()`
- `POST /auth/login` → `login()`
- `GET /auth/me` → `me()`
- `POST /auth/logout` → `logout()`

Controller: `src/controllers/auth.controller.ts`

## Users
- `GET /users` → `listUsers()`
- `GET /users/:id` → `getUserById()`
- `PATCH /users/:id` → `updateUserById()`
- `PUT /users/:id/identity` → `upsertUserIdentity()`
- `GET /users/:id/dashboard/seller` → `getSellerDashboardOverview()`
- `GET /users/:id/dashboard/seller/charts` → `getSellerDashboardCharts()`

Controller: `src/controllers/users.controller.ts`

## Verifications
- `POST /verifications/submissions` → `createVerificationSubmission()`
- `GET /verifications/submissions` → `listVerificationSubmissions()`
- `PATCH /verifications/submissions/:id/review` → `reviewVerificationSubmission()`

Controller: `src/controllers/verifications.controller.ts`

## Listings
- `GET /listings` → `listListings()`
- `POST /listings` → `createListing()`
- `GET /listings/:id` → `getListingById()`
- `PATCH /listings/:id` → `updateListingById()`
- `DELETE /listings/:id` → `deleteListingById()`
- `POST /listings/:id/media` → `addListingMedia()`
- `POST /listings/:id/maintenance-logs` → `addMaintenanceLog()`

Controller: `src/controllers/listings.controller.ts`

## Groups
- `GET /groups` → `listGroups()`
- `POST /groups` → `createGroup()`
- `GET /groups/:id` → `getGroupById()`
- `POST /groups/:id/members` → `addGroupMember()`
- `POST /groups/:id/invitations` → `createGroupInvitation()`
- `PATCH /groups/invitations/:invitationId` → `updateInvitationStatus()`

Controller: `src/controllers/groups.controller.ts`

## Offers
- `GET /offers` → `listOffers()`
- `POST /offers` → `createOffer()`
- `PATCH /offers/:id` → `updateOffer()`
- `PATCH /offers/:id/participants/:userId` → `updateOfferParticipantDecision()`

Controller: `src/controllers/offers.controller.ts`

## Rentals
- `GET /rentals` → `listRentals()`
- `POST /rentals` → `createRental()`
- `PATCH /rentals/:id/status` → `updateRentalStatus()`

Controller: `src/controllers/rentals.controller.ts`

## Conversations
- `GET /conversations` → `listConversations()`
- `POST /conversations` → `createConversation()`
- `GET /conversations/:id/messages` → `listConversationMessages()`
- `POST /conversations/:id/messages` → `createConversationMessage()`

Controller: `src/controllers/conversations.controller.ts`

## Notifications
- `GET /notifications/:userId` → `listNotificationsByUser()`
- `POST /notifications` → `createNotification()`
- `PATCH /notifications/:id/read` → `markNotificationAsRead()`
- `PATCH /notifications/user/:userId/read-all` → `markAllNotificationsAsRead()`

Controller: `src/controllers/notifications.controller.ts`

## Promotions
- `GET /promotions` → `listPromotions()`
- `POST /promotions` → `createPromotion()`
- `PATCH /promotions/:id/status` → `updatePromotionStatus()`

Controller: `src/controllers/promotions.controller.ts`

## Payments
- `GET /payments` → `listPayments()`
- `POST /payments` → `createPayment()`
- `PATCH /payments/:id/status` → `updatePaymentStatus()`

Controller: `src/controllers/payments.controller.ts`

## Admin
- `GET /admin/dashboard-overview` → `getAdminDashboardOverview()`
- `GET /admin/dashboard-charts` → `getAdminDashboardCharts()`
- `GET /admin/moderation-queue` → `getAdminModerationQueue()`

Controller: `src/controllers/admin.controller.ts`

---

## Query Parameter Dashboard
Semua endpoint charts mendukung query:
- `range=7D|30D|90D|1Y`
- default: `30D`

Helper range ada di:
- `src/controllers/dashboard.utils.ts`

---

## Catatan Return Data
Agar frontend chart mudah consume, endpoint charts konsisten return:

```json
{
  "range": "30D",
  "labels": ["2026-03-01", "2026-03-02"],
  "series": {
    "metricA": [12, 9],
    "metricB": [2, 4]
  }
}
```

Format ini wajib dipertahankan saat menambah metric baru.
