/**
 * Seed script — `npm run db:seed`
 *
 * Creates:
 *   • the single admin user (from ADMIN_EMAIL / ADMIN_PASSWORD)
 *   • the site-settings row (from SITE_NAME / WHATSAPP_NUMBER / CONTACT_EMAIL)
 *   • 8 sample استراحات with amenities, gallery placeholders, blocked dates
 *   • a handful of reviews and booking requests so the admin dashboard has data
 *
 * Idempotent: safe to re-run. Listings are matched by slug and updated rather
 * than duplicated, so re-seeding after editing this file refreshes the samples.
 * Re-running does NOT wipe listings you created yourself in the dashboard.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/* -------------------------------------------------------------------------- */
/* helpers (duplicated from src/lib so the seed has no bundler dependency)     */
/* -------------------------------------------------------------------------- */

const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g;

function slugify(input: string): string {
  return (
    input
      .trim()
      .replace(TASHKEEL, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .toLowerCase()
      .replace(/[^ء-غف-يa-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "listing"
  );
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today in Gulf time, so seeded "future" dates are future for a UAE viewer. */
function todayISO(): string {
  return toISO(new Date(Date.now() + 4 * 3600_000));
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toISO(dt);
}

/**
 * Blocked days are generated as offsets from *today* rather than fixed dates,
 * so the calendar always demonstrates the booked/available states no matter
 * when the project is cloned. (The design's prototype hardcoded July 2026 and
 * would have shown an all-past calendar a month later.)
 */
function blockedDates(offsets: number[]): string[] {
  const base = todayISO();
  return offsets.map((o) => addDays(base, o));
}

/* -------------------------------------------------------------------------- */
/* sample data                                                                */
/* -------------------------------------------------------------------------- */

type SeedListing = {
  name: string;
  city: string;
  area: string;
  /**
   * English name/area/description. Filled in for every seeded rest house on
   * purpose: the demo catalogue is what an operator judges the English site by,
   * and a half-Arabic English page reads as a bug rather than as a field they
   * forgot to fill in. Owner-created listings start with these blank and fall
   * back to Arabic — see `localizeListing()` in src/lib/listings.ts.
   */
  nameEn: string;
  areaEn: string;
  descriptionEn: string;
  pricePerNight: number;
  weekendPrice: number;
  capacity: number;
  rating: number;
  reviewsCount: number;
  bookingsCount: number;
  categories: string[];
  amenities: string[];
  verified: boolean;
  featured: boolean;
  lat: number;
  lng: number;
  blocked: number[];
  description: string;
  ownerName: string;
};

const LISTINGS: SeedListing[] = [
  {
    name: "استراحة الرمال الذهبية",
    nameEn: "Golden Sands Rest House",
    city: "dubai",
    area: "لهباب – دبي",
    areaEn: "Lahbab – Dubai",
    pricePerNight: 1800,
    weekendPrice: 2300,
    capacity: 60,
    rating: 4.9,
    reviewsCount: 128,
    bookingsCount: 214,
    categories: ["family", "swim", "lux"],
    amenities: ["pool", "wifi", "ac", "park", "bbq", "kitchen", "majlis", "kids", "wc", "cctv", "palm", "fire"],
    verified: true,
    featured: true,
    lat: 24.7614,
    lng: 55.534,
    blocked: [3, 4, 10, 11, 17, 18, 24, 25],
    description:
      "استراحة واسعة على أطراف كثبان لهباب، تجمع بين المجلس العربي التقليدي ومساحات خارجية مضاءة بعناية. مثالية للتجمعات العائلية والمناسبات الهادئة، مع مسبح خاص مسوَّر ومطبخ تحضيري مستقل يسهّل استضافة الولائم الكبيرة.",
    descriptionEn:
      "A spacious rest house on the edge of the Lahbab dunes, pairing a traditional Arabic majlis with carefully lit outdoor spaces. Ideal for family gatherings and quiet occasions, with a walled private pool and a separate prep kitchen that makes hosting a large banquet straightforward.",
    ownerName: "أبو سلطان",
  },
  {
    name: "استراحة واحة ليوا",
    nameEn: "Liwa Oasis Rest House",
    city: "abudhabi",
    area: "ليوا – الظفرة",
    areaEn: "Liwa – Al Dhafra",
    pricePerNight: 2400,
    weekendPrice: 3000,
    capacity: 80,
    rating: 4.8,
    reviewsCount: 96,
    bookingsCount: 167,
    categories: ["wedding", "lux", "family"],
    amenities: ["pool", "wifi", "ac", "park", "bbq", "kitchen", "majlis", "sound", "screen", "wc", "palm", "tent"],
    verified: true,
    featured: true,
    lat: 23.13,
    lng: 53.78,
    blocked: [1, 2, 8, 9, 15, 16, 22, 23, 29, 30],
    description:
      "إطلالة مباشرة على كثبان ليوا الحمراء، مع صالة مناسبات مغلقة تتسع لثمانين ضيفًا وخيمة شتوية مجهزة بالكامل. الموقع هادئ تمامًا بعد المغرب وسماؤه صافية لرصد النجوم.",
    descriptionEn:
      "Looking straight out over the red dunes of Liwa, with an enclosed function hall seating eighty and a fully equipped winter tent. Completely quiet after sunset, and the sky here is clear enough for stargazing.",
    ownerName: "سالم المنصوري",
  },
  {
    name: "استراحة نجوم الصحراء",
    nameEn: "Desert Stars Rest House",
    city: "dubai",
    area: "الفقع – دبي",
    areaEn: "Al Faqa – Dubai",
    pricePerNight: 1250,
    weekendPrice: 1600,
    capacity: 40,
    rating: 4.7,
    reviewsCount: 74,
    bookingsCount: 132,
    categories: ["small", "camp", "family"],
    amenities: ["wifi", "ac", "park", "bbq", "majlis", "tent", "wc", "fire", "kids"],
    verified: true,
    featured: true,
    lat: 24.75,
    lng: 55.65,
    blocked: [5, 6, 12, 13, 19, 20],
    description:
      "مخيم شتوي بطابع بدوي معاصر، بعيد عن التلوث الضوئي — الخيار الأمثل لأمسيات رصد النجوم والتجمعات الصغيرة. يشمل وجارًا للنار وجلسات أرضية تقليدية.",
    descriptionEn:
      "A winter camp with a contemporary Bedouin character, far enough from light pollution to be the right choice for a stargazing evening or a small gathering. Includes a fire pit and traditional floor seating.",
    ownerName: "راشد الكعبي",
  },
  {
    name: "استراحة القصر الرملي",
    nameEn: "Sand Palace Rest House",
    city: "abudhabi",
    area: "العين – الهيلي",
    areaEn: "Al Ain – Hili",
    pricePerNight: 3200,
    weekendPrice: 3900,
    capacity: 120,
    rating: 5.0,
    reviewsCount: 52,
    bookingsCount: 88,
    categories: ["wedding", "lux"],
    amenities: ["pool", "wifi", "ac", "park", "bbq", "kitchen", "majlis", "sound", "screen", "cctv", "wc", "palm", "pitch"],
    verified: true,
    featured: true,
    lat: 24.2075,
    lng: 55.7447,
    blocked: [7, 8, 9, 14, 21, 22, 28],
    description:
      "أفخم ما في العين: قاعة أعراس مكيفة، مسبح لامتناهٍ، ومجلس رجالي ونسائي منفصلان مع خدمة ضيافة كاملة. مواقف تتسع لأربعين سيارة وبوابة دخول مستقلة للعرائس.",
    descriptionEn:
      "The grandest venue in Al Ain: an air-conditioned wedding hall, an infinity pool, and separate men's and women's majlis with full hospitality service. Parking for forty cars and a private entrance for the bridal party.",
    ownerName: "أم خالد",
  },
  {
    name: "استراحة سدرة",
    nameEn: "Sidra Rest House",
    city: "sharjah",
    area: "البدائر – الشارقة",
    areaEn: "Al Badayer – Sharjah",
    pricePerNight: 950,
    weekendPrice: 1200,
    capacity: 30,
    rating: 4.6,
    reviewsCount: 61,
    bookingsCount: 145,
    categories: ["small", "camp"],
    amenities: ["wifi", "ac", "park", "bbq", "majlis", "wc", "fire"],
    verified: false,
    featured: false,
    lat: 24.93,
    lng: 55.73,
    blocked: [2, 3, 16, 17, 26],
    description:
      "استراحة اقتصادية أنيقة قرب كثبان البدائر، مناسبة للتجمعات الصغيرة ورحلات نهاية الأسبوع. بسيطة ونظيفة، وقريبة من الطريق الرئيسي.",
    descriptionEn:
      "A neat, affordable rest house near the Al Badayer dunes, suited to small gatherings and weekend trips. Simple and clean, and close to the main road.",
    ownerName: "محمد البلوشي",
  },
  {
    name: "استراحة الظفرة",
    nameEn: "Al Dhafra Rest House",
    city: "abudhabi",
    area: "الظفرة – أبوظبي",
    areaEn: "Al Dhafra – Abu Dhabi",
    pricePerNight: 2100,
    weekendPrice: 2600,
    capacity: 70,
    rating: 4.8,
    reviewsCount: 43,
    bookingsCount: 71,
    categories: ["family", "swim", "wedding"],
    amenities: ["pool", "wifi", "ac", "park", "bbq", "kitchen", "majlis", "sound", "wc", "palm"],
    verified: true,
    featured: false,
    lat: 23.65,
    lng: 53.7,
    blocked: [4, 5, 11, 12, 18, 19, 25, 26],
    description:
      "مساحات خضراء واسعة ومسبح مُدفّأ، مع مطبخ تحضيري مستقل يسهّل استضافة الولائم الكبيرة. إضاءة خارجية كاملة تجعل الجلسات الليلية مريحة صيفًا وشتاءً.",
    descriptionEn:
      "Wide green lawns and a heated pool, with a separate prep kitchen that makes hosting a large banquet straightforward. Full exterior lighting keeps evening seating comfortable in summer and winter alike.",
    ownerName: "خليفة الحمادي",
  },
  {
    name: "استراحة نخيل الوادي",
    nameEn: "Valley Palms Rest House",
    city: "abudhabi",
    area: "وادي العين",
    areaEn: "Wadi Al Ain",
    pricePerNight: 1650,
    weekendPrice: 2050,
    capacity: 50,
    rating: 4.9,
    reviewsCount: 88,
    bookingsCount: 159,
    categories: ["family", "small", "swim"],
    amenities: ["pool", "wifi", "ac", "park", "bbq", "kitchen", "kids", "wc", "palm", "pitch"],
    verified: true,
    featured: false,
    lat: 24.12,
    lng: 55.8,
    blocked: [6, 13, 20, 27],
    description:
      "محاطة بمزرعة نخيل مثمرة، بمسبح أطفال منفصل وملعب كرة قدم بأرضية عشبية. اختيار مثالي للعائلات التي معها أطفال صغار.",
    descriptionEn:
      "Surrounded by a working date farm, with a separate children's pool and a grass football pitch. An ideal choice for families with young children.",
    ownerName: "عبدالله النعيمي",
  },
  {
    name: "استراحة الكثبان الحمراء",
    nameEn: "Red Dunes Rest House",
    city: "dubai",
    area: "لهباب – دبي",
    areaEn: "Lahbab – Dubai",
    pricePerNight: 2900,
    weekendPrice: 3500,
    capacity: 100,
    rating: 4.9,
    reviewsCount: 115,
    bookingsCount: 203,
    categories: ["wedding", "lux", "swim"],
    amenities: ["pool", "wifi", "ac", "park", "bbq", "kitchen", "majlis", "sound", "screen", "cctv", "wc", "palm", "tent", "fire"],
    verified: true,
    featured: false,
    lat: 24.7,
    lng: 55.58,
    blocked: [1, 7, 8, 14, 15, 21, 28, 29],
    description:
      "تصميم معماري معاصر مستوحى من الطين والحجر، مع سطح مفتوح يطل على أعلى كثبان لهباب. نظام صوتي وشاشة عرض كبيرة للمناسبات، وكاميرات مراقبة على كامل المحيط.",
    descriptionEn:
      "Contemporary architecture drawing on clay and stone, with an open roof terrace overlooking the highest of the Lahbab dunes. A sound system and a large projector screen for events, and CCTV across the whole perimeter.",
    ownerName: "سيف الظاهري",
  },
];

const REVIEWS = [
  {
    authorName: "أم عبدالله",
    rating: 5,
    daysAgo: 6,
    body: "المكان نظيف جدًا والمجلس واسع. استقبال المالك كان راقيًا وردّه على الواتساب فوري. سنكرر الحجز بإذن الله.",
  },
  {
    authorName: "سيف الحمادي",
    rating: 5,
    daysAgo: 14,
    body: "حجزنا لمناسبة عائلية لأربعين شخصًا. المسبح مُدفّأ والإضاءة الخارجية جميلة ليلًا. التسعير واضح بلا رسوم مخفية.",
  },
  {
    authorName: "نورة القبيسي",
    rating: 4,
    daysAgo: 30,
    body: "الاستراحة ممتازة والموقع سهل الوصول. الملاحظة الوحيدة أن مواقف السيارات تمتلئ بسرعة عند التجمعات الكبيرة.",
  },
];

/* -------------------------------------------------------------------------- */
/* seed                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log("🌱 بدء تهيئة قاعدة البيانات…\n");

  /* --- admin user ------------------------------------------------------- */
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@example.ae").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash, name: process.env.ADMIN_NAME || "المشرف" },
    create: {
      email: adminEmail,
      name: process.env.ADMIN_NAME || "المشرف",
      passwordHash,
      role: "ADMIN",
    },
  });
  console.log(`✅ حساب المشرف: ${adminEmail}`);
  if (adminPassword === "ChangeMe123!") {
    console.log("   ⚠️  كلمة المرور هي الافتراضية — غيّر ADMIN_PASSWORD في .env");
  }

  /* --- owner accounts, one per lifecycle state -------------------------- */
  //
  // Four owners covering every state the platform can put an owner in, so the
  // approval workflow, the membership rules and the public visibility predicate
  // can all be exercised by hand without editing the database. The password is
  // the same for all of them and is deliberately obvious — these exist to be
  // logged into during verification.
  //
  // The *expired* owner is the interesting one: status APPROVED with a
  // membership date in the past. That combination is what proves expiry is
  // derived at query time rather than stored — nothing has to flip a flag for
  // their listings to disappear.
  const ownerPassword = process.env.OWNER_PASSWORD || "OwnerPass123!";
  const ownerHash = await bcrypt.hash(ownerPassword, 10);

  const ownerSeeds = [
    {
      email: "owner.active@example.ae",
      fullName: "سالم المنصوري",
      businessName: "استراحات المنصوري",
      whatsapp: "971501110001",
      status: "APPROVED",
      // A year out — comfortably active.
      membershipDays: 365,
      city: "dubai",
    },
    {
      email: "owner.pending@example.ae",
      fullName: "ناصر الكعبي",
      businessName: "مخيمات الكعبي",
      whatsapp: "971501110002",
      status: "PENDING",
      membershipDays: null,
      city: "abudhabi",
    },
    {
      email: "owner.expired@example.ae",
      fullName: "خليفة الشامسي",
      businessName: "شاليهات الشامسي",
      whatsapp: "971501110003",
      status: "APPROVED",
      // Yesterday — approved, but out of membership.
      membershipDays: -1,
      city: "abudhabi",
    },
    {
      email: "owner.suspended@example.ae",
      fullName: "راشد النعيمي",
      businessName: "استراحات النعيمي",
      whatsapp: "971501110004",
      status: "SUSPENDED",
      membershipDays: 365,
      city: "sharjah",
    },
    {
      email: "owner.rejected@example.ae",
      fullName: "مبارك الظاهري",
      businessName: "",
      whatsapp: "971501110005",
      status: "REJECTED",
      membershipDays: null,
      city: "abudhabi",
    },
  ] as const;

  const ownerIds: Record<string, string> = {};

  for (const o of ownerSeeds) {
    const user = await prisma.user.upsert({
      where: { email: o.email },
      update: { passwordHash: ownerHash, name: o.fullName, role: "OWNER" },
      create: {
        email: o.email,
        name: o.fullName,
        passwordHash: ownerHash,
        role: "OWNER",
      },
    });

    const membershipExpiresAt =
      o.membershipDays === null
        ? null
        : new Date(Date.now() + o.membershipDays * 86_400_000);

    const profile = await prisma.ownerProfile.upsert({
      where: { userId: user.id },
      update: {
        fullName: o.fullName,
        businessName: o.businessName,
        whatsapp: o.whatsapp,
        status: o.status,
        membershipExpiresAt,
        city: o.city,
        rejectionReason:
          o.status === "REJECTED" ? "بيانات التحقق غير مكتملة (حساب تجريبي)" : null,
      },
      create: {
        userId: user.id,
        fullName: o.fullName,
        phone: o.whatsapp,
        whatsapp: o.whatsapp,
        businessName: o.businessName,
        city: o.city,
        status: o.status,
        membershipExpiresAt,
        rejectionReason:
          o.status === "REJECTED" ? "بيانات التحقق غير مكتملة (حساب تجريبي)" : null,
      },
    });

    ownerIds[o.email] = profile.id;
  }

  console.log(`✅ حسابات المُلّاك: ${ownerSeeds.length} (كلمة المرور: ${ownerPassword})`);
  for (const o of ownerSeeds) {
    console.log(`   • ${o.email} — ${o.status}`);
  }

  /* --- site settings ---------------------------------------------------- */
  const siteName = process.env.SITE_NAME || "استراحات الرمال";
  const whatsapp = process.env.WHATSAPP_NUMBER || "+971500000000";
  const email = process.env.CONTACT_EMAIL || "hello@example.ae";

  await prisma.siteSettings.upsert({
    where: { id: 1 },
    // Only fill identity/contact on create; on re-seed we leave whatever the
    // owner has since edited in /admin/settings untouched.
    update: {},
    create: {
      id: 1,
      siteName,
      whatsappNumber: whatsapp,
      phone: whatsapp,
      email,
      instagram: "https://instagram.com/",
      addressLine: "دبي — الإمارات العربية المتحدة",

      // English copy. Without these the English site falls back to the Arabic
      // hero, which is the most visible text on the page.
      siteNameEn: "Sands Rest Houses",
      taglineEn: "Rest houses & chalets across the UAE",
      addressLineEn: "Dubai — United Arab Emirates",
      checkInTimeEn: "4 PM",
      checkOutTimeEn: "12 noon",
      seoTitleEn: "Book rest houses and chalets in the UAE",
      seoDescriptionEn:
        "Verified desert rest houses and chalets across Abu Dhabi, Dubai, Sharjah, Ras Al Khaimah, Ajman, Umm Al Quwain and Fujairah — clear pricing, a live calendar, and direct confirmation on WhatsApp.",
      heroTitleEn: "Your rest house in the heart of the desert",
      heroTitleAltEn: "is one booking away",
      heroSubtitleEn:
        "Choose from carefully selected rest houses and chalets in Lahbab, Liwa and Al Ain — clear pricing, a live calendar, and direct confirmation with the owner.",
      footerAboutEn:
        "An Emirati platform for booking desert rest houses and chalets — verified in person, with clear pricing.",
    },
  });
  console.log(`✅ إعدادات الموقع: «${siteName}» — واتساب ${whatsapp}`);

  /* --- listings --------------------------------------------------------- */
  //
  // The first four sample listings are handed to the four owner states, and a
  // per-listing deposit rate is set on some of them. That combination is what
  // makes the rules verifiable by eye on a seeded database:
  //
  //   index 0 → active owner    → visible, uses that owner's WhatsApp number
  //   index 1 → expired owner   → HIDDEN from the public site, still `published`
  //   index 2 → suspended owner → HIDDEN
  //   index 3 → pending owner   → HIDDEN
  //   index 4+ → no owner       → visible (platform-owned, the pre-existing case)
  //
  // Listings 1–3 staying `published: true` is the point: nothing unpublished
  // them, they are filtered at query time, and reactivating their owner brings
  // them straight back. See `publicListingWhere()` in src/lib/listings.ts.
  const ownerAssignment: (string | null)[] = [
    ownerIds["owner.active@example.ae"] ?? null,
    ownerIds["owner.expired@example.ae"] ?? null,
    ownerIds["owner.suspended@example.ae"] ?? null,
    ownerIds["owner.pending@example.ae"] ?? null,
  ];

  // Distinct rates so the deposit column is visibly per-listing rather than
  // one platform figure repeated. `null` means "use the platform default";
  // `0` means "no deposit", which is a different thing and is worth having a
  // sample of.
  const depositAssignment: (number | null)[] = [50, 25, null, 0];

  let created = 0;
  let updated = 0;

  for (const [index, item] of LISTINGS.entries()) {
    const slug = slugify(item.name);
    const existing = await prisma.listing.findUnique({ where: { slug } });

    const data = {
      ownerId: ownerAssignment[index] ?? null,
      depositPercent: index < depositAssignment.length ? depositAssignment[index] : null,
      slug,
      name: item.name,
      description: item.description,
      city: item.city,
      area: item.area,
      nameEn: item.nameEn,
      descriptionEn: item.descriptionEn,
      areaEn: item.areaEn,
      lat: item.lat,
      lng: item.lng,
      pricePerNight: item.pricePerNight,
      weekendPrice: item.weekendPrice,
      capacity: item.capacity,
      amenities: JSON.stringify(item.amenities),
      categories: JSON.stringify(item.categories),
      verified: item.verified,
      featured: item.featured,
      published: true,
      rating: item.rating,
      reviewsCount: item.reviewsCount,
      bookingsCount: item.bookingsCount,
      ownerName: item.ownerName,
    };

    const listing = existing
      ? await prisma.listing.update({ where: { slug }, data })
      : await prisma.listing.create({ data });

    existing ? updated++ : created++;

    /* gallery — replaced wholesale so re-seeding can't accumulate duplicates.
       These are Unsplash desert photos, allowed in next.config.ts. Replace them
       with real uploads from /admin as soon as you have the owner's photos. */
    await prisma.listingImage.deleteMany({ where: { listingId: listing.id } });
    const photoIds = [
      "photo-1509316785289-025f5b846b35",
      "photo-1547234935-80c7145ec969",
      "photo-1682686581362-796145f0e123",
      "photo-1518623489648-a173ef7824f3",
      "photo-1600585154340-be6161a56a0c",
    ];
    await prisma.listingImage.createMany({
      data: photoIds.map((id, i) => ({
        listingId: listing.id,
        // Offset the crop per listing so cards don't all look identical.
        url: `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1600&q=80&sat=-10&ix=${index}`,
        alt: `${item.name} — صورة ${i + 1}`,
        sortOrder: i,
      })),
    });

    /* availability — wiped and rebuilt from the offsets above */
    await prisma.availability.deleteMany({ where: { listingId: listing.id } });
    const dates = blockedDates(item.blocked);
    await prisma.availability.createMany({
      data: dates.map((date, i) => ({
        listingId: listing.id,
        date,
        // Mix the two states so the admin calendar shows both.
        status: i % 3 === 0 ? "BOOKED" : "BLOCKED",
      })),
    });

    /* reviews — only for listings the sample data says have them */
    await prisma.review.deleteMany({ where: { listingId: listing.id } });
    if (item.reviewsCount > 0) {
      await prisma.review.createMany({
        data: REVIEWS.map((r) => ({
          listingId: listing.id,
          authorName: r.authorName,
          rating: r.rating,
          body: r.body,
          published: true,
          createdAt: new Date(Date.now() - r.daysAgo * 86_400_000),
        })),
      });
    }
  }
  console.log(`✅ الاستراحات: ${created} جديدة، ${updated} محدّثة`);

  /* --- sample booking requests ----------------------------------------- */
  const all = await prisma.listing.findMany({ orderBy: { createdAt: "asc" } });
  const base = todayISO();

  const sampleRequests = [
    { i: 0, name: "خالد المنصوري", phone: "+971502148890", from: 3, nights: 2, guests: 45, status: "NEW", note: "نرغب بتجهيز المجلس قبل المغرب." },
    { i: 3, name: "موزة الكعبي", phone: "+971559034471", from: 8, nights: 1, guests: 110, status: "NEW", note: "حفل زفاف — نحتاج تأكيد قاعة النساء." },
    { i: 1, name: "سالم الشامسي", phone: "+971527712210", from: 11, nights: 2, guests: 70, status: "CONFIRMED", note: "تم تحويل العربون." },
    { i: 6, name: "عائشة النعيمي", phone: "+971561186633", from: 7, nights: 1, guests: 24, status: "CONFIRMED", note: "" },
    { i: 2, name: "راشد البلوشي", phone: "+971504420097", from: 2, nights: 1, guests: 18, status: "REJECTED", note: "التاريخ محجوز مسبقًا." },
    { i: 7, name: "حمدان الظاهري", phone: "+971586601284", from: 15, nights: 2, guests: 88, status: "CONFIRMED", note: "يحتاج نظام صوتي إضافي." },
  ];

  let reqNo = 2414;
  for (const r of sampleRequests) {
    const listing = all[r.i];
    if (!listing) continue;

    const reference = `RQ-${reqNo++}`;
    const checkIn = addDays(base, r.from);
    const checkOut = addDays(base, r.from + r.nights);
    const subtotal = listing.pricePerNight * r.nights;
    // No service fee — matching `SiteSettings.serviceFeePercent`, which now
    // defaults to 0. Demo bookings that carried a 5% fee the live site no
    // longer charges would make the sample data disagree with the product.
    const serviceFee = 0;
    const total = subtotal + serviceFee;

    await prisma.bookingRequest.upsert({
      where: { reference },
      update: {},
      create: {
        reference,
        listingId: listing.id,
        customerName: r.name,
        customerPhone: r.phone,
        notes: r.note || null,
        checkIn,
        checkOut,
        nights: r.nights,
        guests: r.guests,
        subtotal,
        serviceFee,
        total,
        depositDue: Math.round(total * 0.3),
        // Snapshotted alongside the amount, exactly as the booking action does.
        depositPercent: 30,
        // The platform's cut, snapshotted the same way. Without it every demo
        // booking would show "0 د.إ" at step 6 of the handover workflow, which
        // reads as a bug rather than as sample data.
        commissionPercent: 5,
        commissionDue: Math.round((total * 5) / 100),
        // A confirmed demo booking has, by definition, had its deposit taken —
        // that is what confirming means now. Leaving it at the 'DEPOSIT'
        // default would ask the operator to collect a deposit on a booking the
        // sample data already calls confirmed.
        ...(r.status === "CONFIRMED"
          ? {
              stage: "BALANCE" as const,
              depositConfirmedAt: new Date(),
              depositCollected: Math.round(total * 0.3),
            }
          : {}),
        status: r.status,
      },
    });
  }
  console.log(`✅ طلبات الحجز: ${sampleRequests.length} طلبًا تجريبيًا`);

  console.log("\n🎉 تمت التهيئة. شغّل  npm run dev  ثم افتح http://localhost:3000");
  console.log(`   لوحة التحكم: http://localhost:3000/admin  (${adminEmail})`);
  console.log("   لوحة المالك:  http://localhost:3000/owner   (owner.active@example.ae)");
  console.log("   تسجيل مالك:   http://localhost:3000/register/owner");
}

main()
  .catch((e) => {
    console.error("❌ فشلت التهيئة:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
