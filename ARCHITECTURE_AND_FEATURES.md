# Roamer Backend Architecture & Features (Updated)

## Table of Contents
1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture & Folder Structure](#architecture--folder-structure)
4. [Key Features (Latest State)](#key-features-latest-state)
5. [Database Models](#database-models)
6. [API Endpoints Summary](#api-endpoints-summary)
7. [Recent Changes & Improvements](#recent-changes--improvements)
8. [Rental Feature Deep Dive](#rental-feature-deep-dive)

---

## Project Overview

**Roamer Backend** is an Express.js + TypeScript backend serving as the source of truth for a comprehensive peer-to-peer vehicle marketplace and rental platform. The platform supports:

- **Vehicle Listings**: Sell, rent cars, trucks, bikes, parts, and plates
- **Group Buying**: Multiple users pooling together to negotiate better prices
- **Joint Offers**: Collective offer submission with participant approval
- **Rental Booking**: Full-cycle rental lifecycle management
- **Seller Dashboard**: Real-time metrics and analytics
- **Admin Dashboard**: Moderation, overview, and platform metrics
- **Chat & Notifications**: Real-time messaging and alerts
- **Verification System**: Multi-document identity verification
- **Payments**: Integration hooks for payment processing
- **Promotions**: Banner advertising for listings

---

## Technology Stack

```json
{
  "runtime": "Node.js + TypeScript",
  "framework": "Express.js v5",
  "database": "PostgreSQL with Prisma ORM v7.5.0",
  "auth": "JWT + bcryptjs",
  "realtime": "Socket.IO v4",
  "file-upload": "Multer v2",
  "validation": "Zod v4"
}
```

**Key Dependencies:**
- `@prisma/client` - Database ORM
- `@prisma/adapter-pg` - PostgreSQL adapter for Prisma
- `express` - HTTP server framework
- `jsonwebtoken` - JWT authentication
- `socket.io` - Real-time events
- `zod` - Request validation
- `bcryptjs` - Password hashing

---

## Architecture & Folder Structure

```
backend/
├── src/
│   ├── index.ts                    # Entry point with cron scheduling
│   ├── app.ts                      # Express app configuration
│   ├── config/
│   │   └── env.ts                 # Environment variable schema
│   ├── routes/                     # HTTP route definitions
│   │   ├── index.ts               # Main router setup
│   │   ├── auth.ts                # Auth endpoints
│   │   ├── users.ts               # User management
│   │   ├── listings.ts            # Listing CRUD + view tracking
│   │   ├── rentals.ts             # Rental booking lifecycle
│   │   ├── groups.ts              # Group buying
│   │   ├── offers.ts              # Joint offers
│   │   ├── conversations.ts       # Chat messages
│   │   ├── notifications.ts       # Notifications
│   │   ├── garage.ts              # User garage assets
│   │   ├── payments.ts            # Payment tracking
│   │   ├── promotions.ts          # Promotion campaigns
│   │   ├── verifications.ts       # ID verification
│   │   ├── admin.ts               # Admin dashboard
│   │   ├── health.ts              # Health check
│   │   └── utils.ts               # Shared utilities
│   ├── controllers/                # Business logic layer
│   │   ├── listings.controller.ts # Listing ops + viewsCount tracking
│   │   ├── rentals.controller.ts  # Rental lifecycle state machine
│   │   ├── garage.controller.ts   # Garage asset management + backfill logic
│   │   ├── users.controller.ts    # User profile + seller/admin dashboards
│   │   ├── [other controllers]    # 14 total controllers for each domain
│   │   └── dashboard.utils.ts     # Shared chart range helpers
│   ├── lib/
│   │   ├── prisma.ts              # Prisma client singleton
│   │   └── auth.ts                # JWT token generation
│   ├── middlewares/
│   │   └── auth.ts                # requireAuth middleware
│   ├── socket/
│   │   └── index.ts               # Socket.IO server setup
│   └── uploads/                    # Static file storage
│       ├── listings/
│       └── conversations/
├── prisma/
│   ├── schema.prisma              # Database schema (17 models)
│   └── seed.ts                    # Database seeding
├── package.json
├── tsconfig.json
├── README.md                      # Quick start guide
└── ARCHITECTURE_AND_FEATURES.md   # This file
```

---

## Key Features (Latest State)

### 1. **Authentication & User Management**
- **Endpoints**: Register, login, logout, profile update
- **Auth Method**: JWT stored in httpOnly cookies
- **Password**: Bcrypt with salt rounds
- **Verification**: Email/phone verification status tracking
- **Roles**: USER (default), ADMIN
- **User Status**: ACTIVE, PENDING, SUSPENDED

### 2. **Listings (Cars, Trucks, Bikes, Parts, Plates)**
- **CRUD Operations**: Create, read, update, delete listings
- **Listing Types**: SELL or RENT
- **Status Tracking**: DRAFT → ACTIVE → PAUSED / SOLD / EXPIRED / ARCHIVED
- **Media Management**: Support for cover images, gallery, 360° garage photos, documents (Mulkiya, inspection)
- **Maintenance Logs**: Track service history with dates and maintenance items
- **Rental Pricing**: Separate day/week/month/year rates for rental listings
- **🆕 View Tracking**: 
  - `POST /listings/:id/view` endpoint increments `viewsCount`
  - Creates `LISTING_VIEW` analytics events atomically
  - Real-time metrics visible in seller dashboard

### 3. **Garage System**
- **Asset Types**: SAVED (wishlist), OWNED (purchased from platform), RENTED (active rentals)
- **Latest Value Tracking**: Stores `currentValue` for market insights
- **🆕 Backfill Logic for SOLD Listings**:
  - When seller updates latest price on SOLD listing
  - System auto-creates OWNED assets from accepted offer participants if missing
  - Ensures legacy SOLD listings can still be updated
  - Uses `skipDuplicates: true` to prevent race conditions

### 4. **Group Buying**
- **Group Creation**: Multiple users join to negotiate collectively
- **Status**: FORMING → ACTIVE → COMPLETED / CANCELLED
- **Membership**: Admin (creator) + Members
- **Invitations**: Pending/Accepted/Declined/Expired statuses
- **Target Price**: Group can negotiate downward from listing price

### 5. **Joint Offers**
- **Offer Status Flow**: DRAFT → PENDING_MEMBER_APPROVAL → PENDING_SELLER_REVIEW → ACCEPTED / REJECTED / EXPIRED
- **Participants**: Multiple group members approve before seller sees offer
- **Member Decision**: Each participant votes APPROVED / REJECTED / PENDING
- **Seller Review**: Seller can accept/reject collective offer

### 6. **Rental Booking Lifecycle** ⭐ (See detailed section below)
- **Status States**: REQUESTED → APPROVED → ACTIVE → COMPLETED / REJECTED / CANCELLED / EXPIRED
- **Payment Flow**: Seller approves → Renter submits manual payment → Seller confirms → Dispatch → Renter confirms received → Rental ACTIVE
- **Auto Expiration**: Cron job (every 10 min) expires unpaid approved rentals after 24h
- **Availability Management**: Toggles listing between AVAILABLE/BOOKED
- **Duration Handling**: Supports DAY/WEEK/MONTH/YEAR units
- **Metadata Storage**: Bank account, payment dates, shipping dates in serialized JSON notes

### 7. **Conversations & Messages**
- **Channel Types**: DIRECT (user-to-user), GROUP (group chat), SUPPORT (admin support)
- **Message Types**: TEXT, IMAGE, FILE, SYSTEM
- **Participants**: Track who joined conversation and last read time
- **Auto-create**: Conversations created when rental/group/offer initiated

### 8. **Notifications**
- **Types**: LISTING, GROUP, OFFER, SYSTEM, MESSAGE, RENTAL, VERIFICATION, PROMOTION
- **Priority**: LOW, NORMAL, HIGH, URGENT
- **Tracking**: Read status with read timestamps
- **Auto-generate**: Created for key lifecycle events (rental approval, payment status, etc)

### 9. **Seller Dashboard**
- **Overview**: Listing count, active groups, offers received, rentals
- **Charts**: Configurable by range (7D, 30D, 90D, 1Y)
  - Active listings over time
  - Group formation trends
  - Revenue from rentals
  - New inquiries/messages
- **Real-time Metrics**: Views count, saves, inquiries via analytics events
- **Endpoint**: `GET /users/:id/dashboard/seller` + `GET /users/:id/dashboard/seller/charts`

### 10. **Admin Dashboard**
- **Overview**: Total users, listings, active rentals, completed transactions
- **Charts**: Platform-wide metrics (registrations, listings, revenue)
- **Moderation Queue**: Listings/offers pending review
- **Endpoints**: `GET /admin/dashboard-overview` + `GET /admin/dashboard-charts` + `GET /admin/moderation-queue`

### 11. **Verification System**
- **Document Types**: EMIRATES_ID_FRONT, EMIRATES_ID_BACK, DRIVING_LICENSE, PASSPORT, SELFIE
- **Submission Workflow**: User submits docs → Admin reviews → APPROVED / REJECTED / EXPIRED
- **Verification Status**: UNVERIFIED → PENDING → APPROVED / REJECTED
- **Identity Profile**: Stores extracted data (ID number, expiry, address, nationality)

### 12. **Payments & Promotions**
- **Payment Purpose**: RENTAL, LISTING_FEE, COMMISSION, PROMOTION, SECURITY_DEPOSIT
- **Status**: PENDING → PAID / FAILED / REFUNDED
- **Promotions**: Banner ads for listings with packaged pricing and slot management

### 13. **Analytics**
- **Event Types**: LISTING_VIEW, LISTING_SAVE, LISTING_INQUIRY, GROUP_CREATED, OFFER_SUBMITTED, OFFER_ACCEPTED, RENTAL_REQUESTED, RENTAL_CONFIRMED, CHAT_MESSAGE, PROMOTION_PURCHASED, USER_VERIFIED
- **Tracking**: Actor user, listing ID, metadata, timestamp
- **Usage**: Dashboard metrics, seller insights, platform analytics

---

## Database Models

### Core Models (17 total)

```
User
  ↓
UserIdentityProfile, VerificationSubmission, VerificationDocument

Listing
  ├─→ ListingMedia, ListingMaintenanceLog
  ├─→ Group → GroupMember, GroupInvitation
  ├─→ JointOffer → OfferParticipant
  ├─→ RentalBooking → Contract, Conversation
  ├─→ GarageAsset
  └─→ AnalyticsEvent

Payment, Message, Notification, PromotionCampaign
```

**Key Fields for AI Understanding:**
- `Listing.viewsCount` - Incremented on each `POST /listings/:id/view`
- `Listing.availabilityStatus` - Toggles between AVAILABLE/BOOKED/UNAVAILABLE
- `RentalBooking.notes` - Stores metadata as serialized JSON (payment dates, bank account)
- `RentalBooking.status` - State machine with auto-expiry cron
- `GarageAsset` - Unique constraint on `(userId, listingId, assetType)`
- `AnalyticsEvent.eventType` - Enum for tracking user behaviors

---

## API Endpoints Summary

### Auth (`/api/auth`)
```
POST   /auth/register             # Sign up new user
POST   /auth/login                # Login (JWT cookie)
GET    /auth/me                   # Current user profile
POST   /auth/logout               # Clear cookie
```

### Users (`/api/users`)
```
GET    /users                     # List all users (admin)
GET    /users/:id                 # Get user profile
PATCH  /users/:id                 # Update profile
PUT    /users/:id/identity        # Upsert identity profile
GET    /users/:id/dashboard/seller       # Seller overview
GET    /users/:id/dashboard/seller/charts # Seller charts
```

### Listings (`/api/listings`)
```
GET    /listings                  # List with filters
POST   /listings                  # Create listing
GET    /listings/:id              # Get detail
PATCH  /listings/:id              # Update listing
DELETE /listings/:id              # Delete listing
POST   /listings/:id/media        # Upload media
POST   /listings/:id/maintenance-logs   # Add maintenance log
POST   /listings/:id/view         # 🆕 Track view (increments viewsCount)
```

### Rentals (`/api/rentals`)
```
GET    /rentals?listingId=...    # List rentals (filtered)
POST   /rentals                   # Create rental request
PATCH  /rentals/:id/status        # Seller: approve/reject
POST   /rentals/:id/payment       # Renter: submit payment
POST   /rentals/:id/payment/confirm    # Seller: confirm payment
POST   /rentals/:id/dispatch      # Seller: dispatch vehicle
POST   /rentals/:id/receive       # Renter: confirm received
```

### Garage (`/api/garage`)
```
GET    /garage/my-assets          # List user's garage assets
PATCH  /garage/:listingId/latest-value   # 🆕 Update latest price (with backfill)
```

### Groups (`/api/groups`)
```
GET    /groups                    # List groups
POST   /groups                    # Create group
GET    /groups/:id                # Get group detail
POST   /groups/:id/members        # Add member
POST   /groups/:id/invitations    # Invite users
PATCH  /groups/invitations/:invitationId # Accept/reject invite
```

### Offers (`/api/offers`)
```
GET    /offers                    # List offers
POST   /offers                    # Create offer
PATCH  /offers/:id                # Update offer
PATCH  /offers/:id/participants/:userId # Participant decision
```

### Conversations, Notifications, Payments, Promotions, Verifications, Admin, Health
```
See docs/API_REFERENCE_CONTROLLERS.md for detailed mappings
```

---

## Recent Changes & Improvements

### 🆕 View Tracking Feature (Latest)
**File**: `src/controllers/listings.controller.ts`

```typescript
export const trackListingView = async (req: Request, res: Response) => {
  const listingId = String(req.params.id);
  
  const result = await prisma.$transaction(async (tx) => {
    // Increment viewsCount atomically
    const updated = await tx.listing.update({
      where: { id: listingId },
      data: { viewsCount: { increment: 1 } },
    });

    // Create analytics event
    await tx.analyticsEvent.create({
      data: {
        eventType: "LISTING_VIEW",
        listingId,
        actorUserId: req.user?.id,
      },
    });

    return updated;
  });

  return res.json({ listingId: result.id, viewsCount: result.viewsCount });
};
```

**Route**: `POST /listings/:id/view`

**Integration Points**:
- Frontend: MarketplaceDetailPage, MarketPlaceGaragePage auto-fire this on load
- Seller Dashboard: Displays `viewsCount` in metrics
- No authentication required (anonymous views tracked)

---

### 🆕 Garage Asset Backfill for SOLD Listings (Latest)
**File**: `src/controllers/garage.controller.ts`

```typescript
export const updateGarageLatestValue = async (req: Request, res: Response) => {
  const { listingId } = req.params;
  
  // Verify listing is SOLD
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { status: true },
  });
  
  if (listing?.status !== "SOLD") {
    return res.status(400).json({ message: "Listing must be SOLD to update" });
  }

  // Count existing OWNED assets
  const existingOwnedCount = await prisma.garageAsset.count({
    where: { listingId, assetType: "OWNED" },
  });

  // 🆕 BACKFILL: If no OWNED assets, create from accepted offer participants
  if (existingOwnedCount === 0) {
    const acceptedParticipants = await prisma.offerParticipant.findMany({
      where: {
        offer: { listingId, status: "ACCEPTED" },
      },
      select: { userId: true },
      distinct: ["userId"],
    });

    if (acceptedParticipants.length > 0) {
      await prisma.garageAsset.createMany({
        data: acceptedParticipants.map((p: { userId: string }) => ({
          userId: p.userId,
          listingId,
          assetType: "OWNED" as const,
          currentValue: null,
          notes: "Auto-backfilled from accepted offer participants",
        })),
        skipDuplicates: true,
      });
    }
  }

  // Now update currentValue via raw SQL
  const { newValue } = req.body;
  await prisma.$executeRaw`
    UPDATE "GarageAsset"
    SET "currentValue" = ${newValue}
    WHERE "listingId" = ${listingId}
    AND "assetType" = 'OWNED'
  `;

  return res.json({ message: "Latest value updated successfully" });
};
```

**Problem Solved**: Legacy SOLD listings that predate the garage system couldn't be updated because no OWNED asset records existed.

**Solution**: Auto-create these records from accepted offer data on first update attempt.

---

## Rental Feature Deep Dive

### Complete Rental Lifecycle

```
Renter discovers listing → Creates RentalBooking (REQUESTED)
                          ↓
                    Seller Reviews
                          ↓
                   Decision: APPROVE / REJECT
                   ├─→ REJECTED: Renter notified, ends
                   └─→ APPROVED: 24h payment deadline created
                          ↓
                    Renter submits bank account (within 24h)
                          ↓
                    Seller verifies payment received
                          ↓
                   Decision: CONFIRM / REJECT
                   ├─→ REJECT: Renter resubmit, others in queue
                   └─→ CONFIRM: Other pending requests auto-REJECTED
                          ↓
                    Seller dispatches vehicle (sets shippedAt)
                          ↓
                    Renter confirms received → Status = ACTIVE
                    Rental timer starts (startDate = received date)
                          ↓
                    Auto-completion: When endDate elapsed → COMPLETED
                          ↓
                    Analytics: RENTAL_CONFIRMED event recorded
```

### Database Schema
```typescript
model RentalBooking {
  id                 String         // Unique booking ID
  listingId          String         // Which vehicle
  renterId           String         // Who's renting
  status             RentalStatus   // State machine
  
  // Duration config
  durationUnit       RentalDurationUnit  // DAY|WEEK|MONTH|YEAR
  durationCount      Int            // How many units
  
  // Pricing
  rateAppliedAed     Decimal        // Price per unit
  subtotalAed        Decimal        // duration * rate
  securityDepositAed Decimal        // Safety hold
  totalAed           Decimal        // subtotal + deposit
  
  // Timing
  startDate          DateTime       // Rental begins
  endDate            DateTime       // Calculated or set on receive
  approvedAt         DateTime?      // When seller approved
  rejectedAt         DateTime?      // When seller rejected
  
  // Metadata (serialized JSON)
  notes              String?        // Stores { bankAccountNumber, paymentSubmittedAt, paymentDeadlineAt, shippedAt, receivedAt }
  
  listing            Listing        // FK to vehicle
  renter             User           // FK to renter
  contract           Contract?      // Optional digital contract
  conversation       Conversation?  // Chat channel
  payments           Payment[]      // Associated payments
}
```

### Key Backend Functions

**1. Create Rental Request**
```typescript
export const createRental = async (req, res) => {
  // Validation:
  // - Listing must exist and be type RENT
  // - Seller cannot rent own listing
  // - Status must not be SOLD
  // - No other ACTIVE rental currently
  
  const rental = await prisma.rentalBooking.create({
    data: { ...payload, startDate: new Date(payload.startDate), ... }
  });
  
  // Notify seller: new request
  await prisma.notification.create({
    userId: seller.id,
    body: "New rental request. Please review..."
  });
};
```

**2. Seller Approves Rental**
```typescript
export const sellerDecisionRental = async (req, res) => {
  // If REJECT: Set status = REJECTED, notify renter
  
  // If APPROVE:
  // - Check no other unpaid APPROVED exists
  // - Set deadline = now + 24 hours
  // - Create notifications for renter and other pending requesters
  // - Other pending requests get DISABLED notification
};
```

**3. Auto-Expiry (Cron)**
```typescript
const expireUnpaidApprovedRentals = async () => {
  // Every 10 minutes, check:
  // - Find all APPROVED rentals
  // - If paymentDeadlineAt has passed AND paymentSubmittedAt is null
  // - Update status = EXPIRED
  // - Notify both seller and renter
};
```

**4. Renter Submits Payment**
```typescript
export const submitRentalPayment = async (req, res) => {
  // Only allowed if status = APPROVED
  // Check deadline not expired
  // Store bankAccountNumber in notes.paymentSubmittedAt
  // Notify seller to verify
};
```

**5. Seller Confirms Payment**
```typescript
export const confirmRentalPayment = async (req, res) => {
  if (!confirmed) {
    // Clear payment fields, renter must resubmit
  } else {
    // Set paymentConfirmedAt in notes
    // Auto-REJECT all other PENDING requests for same listing
    // Notify approved renter + rejected renters
  }
};
```

**6. Dispatch & Receive**
```typescript
export const dispatchRental = async (req, res) => {
  // Set shippedAt in notes
  // Notify renter to confirm when received
};

export const confirmRentalReceived = async (req, res) => {
  // Recalculate endDate based on now (received) + duration
  // Set status = ACTIVE
  // Set listing availabilityStatus = BOOKED
  // Notify both parties: rental now active
};
```

**7. Auto-Completion (Cron)**
```typescript
const completeElapsedActiveRentals = async () => {
  // Every 10 minutes, check:
  // - Find all ACTIVE rentals where endDate <= now
  // - Update status = COMPLETED
  // - Set listing availabilityStatus = AVAILABLE
};
```

### Frontend Integration

**Rental Discovery Page** (`RentalPage.tsx`)
- Filters listings with `listingType: RENT` and `status: ACTIVE`
- Displays rental price (day/week/month/year based on selected unit)
- Date range picker for booking duration

**Rental Booking Page** (`RentalBookingPage.tsx`)
- Shows vehicle details and legal terms (payment model 4.0.2)
- Duration selector (DAY/WEEK/MONTH/YEAR) with auto-unit switching
- Calculates: `rentalTotal = price * durationMultiplier + securityDeposit`
- Requires verification before creating request
- Calls `POST /rentals` with pricing payload

**Active Rental Page** (`ActiveRentalPage.tsx`)
- Shows real-time countdown timer (decrements every second)
- Displays remaining rental hours:minutes
- Vehicle location and plate number
- Current phase: WAITING (before active) → LIVE (during active rental)
- Shows day X of Y progress

**Seller Rental Management**
- View pending rental requests
- Approve/reject with one-tap decision
- Track payment status and deadline
- Dispatch button (after payment confirmed)
- Renter cannot see until payment confirmed

---

## Request/Response Pattern

All endpoints follow this structure:

**Request Validation (Zod)**:
```typescript
const payload = z.object({
  fieldName: z.string().min(1),
  amount: z.number().positive(),
  decision: z.enum(["APPROVE", "REJECT"]),
}).parse(req.body);
```

**Error Responses**:
```typescript
400 { message: "Validation failed" }              // ZodError
400 { message: "Field required" }                 // Business logic
403 { message: "Not authorized" }                 // Permission denied
404 { message: "Resource not found" }             // Not exist
500 { message: "Internal server error" }          // Unexpected
```

**Success Response**:
```typescript
res.status(200 or 201).json(resultData);
```

---

## Running the Backend

```bash
# Install dependencies
npm install

# Setup database
npm run prisma:generate
npm run prisma:migrate

# Seed with test data
npm run seed

# Start development server (with auto-reload)
npm run dev

# Build for production
npm run build

# Start production
npm start

# View database GUI
npm run prisma:studio
```

**Health Check**: `GET http://localhost:3000/health`

**Expected Response**:
```json
{
  "name": "roamer-backend",
  "version": "1.0.0",
  "status": "running"
}
```

---

## Environment Variables

```bash
# .env
DATABASE_URL="postgresql://user:pass@localhost:5432/roamer"
JWT_SECRET="your-jwt-secret-key"
PORT=3000
CORS_ORIGINS="http://localhost:5173,http://localhost:3000"
VITE_API_BASE_URL="http://localhost:3000/api"
```

---

## Notes for AI & Developers

1. **Always use `prisma.$transaction()`** for multi-step operations to ensure atomicity
2. **View tracking is intentionally unauthenticated** to count all views (including anonymously)
3. **Garage backfill uses `skipDuplicates: true`** to safely handle concurrent updates
4. **Rental cron runs every 10 minutes** (configurable in `index.ts`)
5. **All timestamps are UTC** via Prisma defaults
6. **Soft deletes are not used** - use explicit status fields instead
7. **Notifications are fire-and-forget** - failures don't block main flow
8. **Socket.IO is scaffolded** but not yet integrated with real-time events

---

**Last Updated**: March 2026  
**Status**: Production-ready with view tracking and garage backfill features
