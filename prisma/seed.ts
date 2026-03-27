import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../src/config/env";
import { carListings } from "../../frontend/src/app/data/cars";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

const toInt = (value?: string) => {
  if (!value) return undefined;
  const parsed = Number(String(value).replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const categoryMap = {
  cars: "CARS",
  trucks: "TRUCKS",
  bikes: "BIKES",
  parts: "PARTS",
  plates: "PLATES",
} as const;

const assetClassMap = {
  cars: "CAR",
  trucks: "TRUCK",
  bikes: "BIKE",
  parts: "PART",
  plates: "PLATE",
} as const;

async function main() {
  const passwordHash = await bcrypt.hash("Clover@12345", 12);
  const adminPasswordHash = await bcrypt.hash("Admin@12345", 12);
  const keeperEmails = ["admin@roamer.ae", "travclover@gmail.com"];

  await prisma.user.deleteMany({
    where: {
      email: {
        notIn: keeperEmails,
      },
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@roamer.ae" },
    update: {
      fullName: "Roamer Admin",
      phone: "+971500000001",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      status: "ACTIVE",
      isEmailVerified: true,
    },
    create: {
      fullName: "Roamer Admin",
      email: "admin@roamer.ae",
      phone: "+971500000001",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      status: "ACTIVE",
      isEmailVerified: true,
    },
  });

  const clover = await prisma.user.upsert({
    where: { email: "travclover@gmail.com" },
    update: {
      fullName: "Trav Clover",
      phone: "+971500000000",
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    },
    create: {
      fullName: "Trav Clover",
      email: "travclover@gmail.com",
      phone: "+971500000000",
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    },
  });

  await prisma.listing.deleteMany({ where: { sellerId: clover.id } });

  for (const car of carListings) {
    const category = categoryMap[car.category];
    const assetClass = assetClassMap[car.category];

    const listing = await prisma.listing.create({
      data: {
        sellerId: clover.id,
        assetClass,
        category,
        listingType: car.listingType === "rent" ? "RENT" : "SELL",
        status: "ACTIVE",
        moderationStatus: "APPROVED",
        reviewedById: admin.id,
        reviewedAt: new Date(),
        verificationLevel:
          car.verificationLevel === "roamer"
            ? "ROAMER"
            : car.verificationLevel === "third_party"
              ? "THIRD_PARTY"
              : "NONE",
        verificationType:
          car.verificationLevel === "roamer"
            ? "ROAMER"
            : car.verificationLevel === "third_party"
              ? "THIRD_PARTY"
              : "NONE",
        availabilityStatus: car.availabilityStatus === "booked" ? "BOOKED" : "AVAILABLE",
        title: `${car.make} ${car.model}`,
        make: car.make,
        model: car.model,
        year: car.year,
        description: car.description,
        condition: car.condition === "new" ? "NEW" : "USED",
        bodyType: car.bodyType,
        mileageKm: toInt(car.mileage),
        locationArea: car.location,
        locationCity: "Dubai",
        locationCountry: "UAE",
        engine: car.engine,
        engineShape: car.engineConfiguration,
        engineCylinders: car.engineCylinders,
        forcedInduction: car.forcedInduction,
        transmission: car.transmission,
        fuelType: car.fuel,
        horsepower: car.horsepower,
        torqueNm: toInt(car.torque),
        accelerationZeroTo100: car.acceleration,
        quarterMile: car.quarterMile,
        regionSpec: car.region ?? car.specs,
        exteriorColor: undefined,
        seatingCapacity: car.seatingCapacity,
        priceSellAed: car.listingType === "sell" ? car.price : undefined,
        rentPriceDayAed: car.listingType === "rent" ? car.price : undefined,
        responseRatePercent: toInt(car.responseRate),
        dealerName: car.dealer,
        dealerLogoUrl: car.dealerLogo,
        groupsActive: 0,
        publishedAt: new Date(),
      },
    });

    const mediaUrls = [car.image, ...(car.gallery ?? [])].filter(Boolean);
    const uniqueMediaUrls = Array.from(new Set(mediaUrls));

    if (uniqueMediaUrls.length > 0) {
      await prisma.listingMedia.createMany({
        data: uniqueMediaUrls.map((url, index) => ({
          listingId: listing.id,
          mediaType: index === 0 ? "COVER_IMAGE" : "GALLERY_IMAGE",
          url,
          sortOrder: index,
        })),
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Seed complete. User: ${clover.email} | Admin: ${admin.email}`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
