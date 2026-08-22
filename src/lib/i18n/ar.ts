import { plural } from "./config";

/**
 * Arabic dictionary — the source of truth for every user-facing string.
 *
 * ─── How this file relates to en.ts ──────────────────────────────────────────
 * `en.ts` is typed as `Dictionary`, which is `typeof ar`. That makes a missing
 * or misspelled English key a **compile error**, not a runtime `undefined` that
 * renders as blank text somewhere nobody looks. Adding a key here and forgetting
 * the English one breaks `npm run typecheck`, which is exactly the feedback loop
 * this project needs — there is no way to ship a half-translated screen quietly.
 * (A runtime parity test in tests/i18n.test.ts backs this up for anyone who
 * bypasses the type layer with a cast.)
 *
 * ─── Conventions ─────────────────────────────────────────────────────────────
 * • Values that need a runtime value are **functions**, not `{placeholder}`
 *   templates. A function gets the same type checking as the rest of the file:
 *   pass the wrong number of arguments and the build fails. A template string
 *   with a typo'd placeholder silently renders `{count}` to a customer.
 * • Numbers arrive **already formatted** (`arNum(n)` / `enNum(n)`), because
 *   Arabic renders Arabic-Indic digits and English renders Latin ones — the
 *   caller resolves that with the locale it already has, so these functions take
 *   `string` and never re-format.
 * • Groups mirror the route structure (home, listings, listing, booking, auth,
 *   owner, admin) so finding the string for a screen means opening the group
 *   named after it.
 */

export const ar = {
  /* ---------------------------------------------------------------- common */
  common: {
    aed: "د.إ",
    perNight: "/ الليلة",
    night: "ليلة",
    guest: "ضيف",
    upToGuests: (n: string, count: number) =>
      `حتى ${n} ${plural("ar", count, {
        one: "ضيف",
        two: "ضيفين",
        few: "ضيوف",
        many: "ضيفًا",
        other: "ضيف",
      })}`,
    viewAll: "عرض الكل",
    copy: "نسخ",
    copied: "تم النسخ",
    details: "التفاصيل",
    browse: "تصفّح الاستراحات",
    search: "بحث",
    save: "حفظ",
    saving: "جارٍ الحفظ…",
    saved: "تم حفظ التعديلات",
    created: "تمت الإضافة",
    deleted: "تم الحذف",
    published: "ظاهرة الآن على الموقع",
    unpublished: "أُخفيت عن الموقع",
    requestConfirmed: "تم تأكيد الطلب وحجز التواريخ",
    requestRejected: "تم رفض الطلب",
    requestCancelled: "تم إلغاء الطلب وتحرير التواريخ",
    requestReturned: "أُعيد الطلب إلى قائمة الانتظار",
    rangeBlocked: "تم حظر النطاق المحدّد",
    rangeFreed: "تم تحرير النطاق المحدّد",
    cancel: "إلغاء",
    confirm: "تأكيد",
    delete: "حذف",
    edit: "تعديل",
    add: "إضافة",
    back: "رجوع",
    close: "إغلاق",
    openMenu: "فتح القائمة",
    closeMenu: "إغلاق القائمة",
    loading: "جارٍ التحميل…",
    all: "الكل",
    optional: "اختياري",
    required: "مطلوب",
    status: "الحالة",
    actions: "إجراءات",
    notes: "ملاحظات",
    none: "—",
    yes: "نعم",
    no: "لا",
    error: "حدث خطأ",
    tryAgain: "حاول مرة أخرى",
    new: "جديدة",
    verified: "موثّقة",
    owner: "المالك",
    page: "صفحة",
    of: "من",
    next: "التالي",
    previous: "السابق",
    results: (n: string, count: number) =>
      `${n} ${plural("ar", count, {
        zero: "نتيجة",
        one: "نتيجة",
        two: "نتيجتان",
        few: "نتائج",
        many: "نتيجة",
        other: "نتيجة",
      })}`,
    noResults: "لا توجد نتائج",
    reset: "إعادة تعيين",
    apply: "تطبيق",
    filter: "تصفية",
    sort: "ترتيب",
    from: "من",
    to: "إلى",
    date: "التاريخ",
    never: "بلا تاريخ انتهاء",
    unknown: "غير معروف",
  },

  /* ------------------------------------------------------------------- nav */
  nav: {
    home: "الرئيسية",
    listings: "تصفّح الاستراحات",
    about: "من نحن",
    favorites: "المفضلة",
    howItWorks: "كيف أحجز؟",
    policies: "سياسة الإلغاء",
    faq: "الأسئلة الشائعة",
    privacy: "سياسة الخصوصية",
    terms: "الشروط والأحكام",
    ownerLogin: "دخول المُلّاك",
    listYourProperty: "أضف استراحتك",
    fastWhatsappReply: "ردّ سريع عبر الواتساب",
    language: "اللغة",
    switchLanguage: "التبديل إلى الإنجليزية",
  },

  /* ------------------------------------------------------------------ home */
  home: {
    verifiedBadge: (listings: string, cities: string) =>
      `${listings} استراحة موثّقة في ${cities} إمارات`,
    mostSearched: "الأكثر بحثًا:",
    quickPool: "استراحة بمسبح",
    quickLahbab: "لهباب",
    quickWedding: "قاعة أعراس",
    quickCamp: "مخيم شتوي",

    categoriesTitle: "تصفّح حسب المناسبة",
    categoriesSubtitle: "اختر المناسبة وسنعرض لك الاستراحات المتاحة لها",
    categoryCount: (n: string, count: number) =>
      `${n} ${plural("ar", count, {
        zero: "استراحة",
        one: "استراحة",
        two: "استراحتان",
        few: "استراحات",
        many: "استراحة",
        other: "استراحة",
      })}`,

    featuredEyebrow: "مختارة بعناية",
    featuredTitle: "استراحات مميّزة هذا الأسبوع",

    whyTitle: "لماذا تحجز معنا",
    whySubtitle:
      "لأنك تستحق أن تعرف بالضبط ما ستحصل عليه قبل أن تدفع — نتحقق من كل استراحة على الطبيعة، ونعرض لك ما ستراه تمامًا.",
    why1Title: "استراحات موثّقة قبل عرضها",
    why1Body:
      "نزور كل استراحة ونصوّرها بأنفسنا قبل نشرها، فالصور التي تراها هي ما ستجده عند الوصول — بلا مفاجآت.",
    why2Title: "تعرف المتاح قبل أن تسأل",
    why2Body:
      "التقويم يعرض الأيام المتاحة والمحجوزة لحظيًا، فتختار تاريخك في ثوانٍ بدل انتظار الرد على مكالمة.",
    why3Title: "سعر واضح بلا رسوم مخفية",
    why3Body:
      "الإجمالي والعربون وسياسة الإلغاء مكتوبة بوضوح في صفحة كل استراحة قبل أن ترسل طلبك.",
    why4Title: "تأكيد سريع من المالك",
    why4Body:
      "طلبك يصل مالك الاستراحة مباشرة على الواتساب بكل التفاصيل جاهزة، فيصلك الرد بسرعة.",

    testimonialsTitle: "ماذا يقول ضيوفنا",
    testimonial1Quote:
      "أفضل ما في المنصة أن كل استراحة موثّقة فعليًا — الصور مطابقة للواقع تمامًا، وهذا نادر.",
    testimonial1Name: "محمد الرميثي",
    testimonial1Role: "ضيف منذ ٢٠٢٣",
    testimonial2Quote:
      "أنظّم أكثر من عشرين مناسبة سنويًا، والتقويم هنا يوفّر عليّ ساعات من الاتصالات. أرى المتاح فورًا وأرسل الطلب عبر الواتساب.",
    testimonial2Name: "شيخة المهيري",
    testimonial2Role: "منظّمة مناسبات",
    testimonial3Quote:
      "حجزت خلال دقيقتين من الجوال. وصلني تأكيد المالك خلال ربع ساعة مع موقع دقيق على الخريطة.",
    testimonial3Name: "عبدالعزيز السويدي",
    testimonial3Role: "ضيف منذ ٢٠٢٤",

    ctaTitle: "لم تجد الاستراحة المناسبة؟ راسلنا",
    ctaBody:
      "أخبرنا بالتاريخ وعدد الضيوف والميزانية، ونرشّح لك ثلاث استراحات متاحة خلال دقائق.",
    ctaWhatsapp: "تواصل عبر الواتساب",
  },

  /* -------------------------------------------------------------- listings */
  listings: {
    title: "الاستراحات المتاحة",
    subtitle: (n: string) => `${n} استراحة متاحة للحجز`,
    searchPlaceholder: "ابحث باسم الاستراحة أو المنطقة",
    city: "الإمارة",
    category: "المناسبة",
    maxPrice: "أقصى سعر لليلة",
    minCapacity: "أقل سعة",
    amenities: "المرافق",
    allCities: "كل الإمارات",
    allCategories: "كل المناسبات",
    clearFilters: "مسح الفلاتر",
    emptyTitle: "لا توجد استراحات مطابقة",
    emptyBody: "جرّب توسيع نطاق البحث أو مسح بعض الفلاتر.",
    showMap: "عرض الخريطة",
    hideMap: "إخفاء الخريطة",
    checkIn: "الوصول",
    checkOut: "المغادرة",
    guests: "الضيوف",
    breadcrumb: "نتائج البحث",
    filterResults: "تصفية النتائج",
    closeFilters: "إغلاق الفلاتر",
    cityGroup: "المدينة / المنطقة",
    allCitiesShort: "كل المدن",
    occasionGroup: "المناسبة",
    maxPriceGroup: "الحد الأقصى للسعر",
    capacityGroup: "السعة (عدد الضيوف)",
    anyCapacity: "أي عدد",
    showResults: (n: string) => `عرض ${n} نتيجة`,
    resetFilters: "إعادة ضبط الفلاتر",
    filters: "الفلاتر",
    sortResults: "ترتيب النتائج",
    headingCity: (city: string) => `استراحات متاحة في ${city}`,
    headingAll: "استراحات متاحة في الإمارات",
    emptyBodyLong: "جرّب توسيع نطاق السعر أو إزالة بعض المرافق.",
    metaTitleCity: (city: string) => `استراحات ${city}`,
    metaTitleAll: "تصفّح الاستراحات",
    metaDescCity: (city: string, site: string) =>
      `استراحات وشاليهات للإيجار في ${city} — أسعار واضحة، تقويم متاح، وحجز مباشر عبر الواتساب من ${site}.`,
    destination: "الوجهة",
    searchButton: "ابحث",
  },

  /* -------------------------------------------------------------- favorites */
  favorites: {
    title: "المفضلة",
    savedCount: (n: string, count: number) =>
      `${n} ${plural("ar", count, {
        zero: "استراحة محفوظة",
        one: "استراحة محفوظة",
        two: "استراحتان محفوظتان",
        few: "استراحات محفوظة",
        many: "استراحة محفوظة",
        other: "استراحة محفوظة",
      })}`,
    metaDescription: "الاستراحات التي حفظتها لمقارنتها قبل الحجز.",
    savedNote: "تُحفظ على جهازك ولا تحتاج حسابًا.",
    loadingList: "جارٍ تحميل قائمتك…",
    addMore: "أضف المزيد",
    clearList: "إفراغ القائمة",
    emptyTitle: "قائمتك فارغة حتى الآن",
    emptyBody:
      "اضغط على أيقونة القلب في أي استراحة لحفظها هنا ومقارنتها لاحقًا قبل إرسال الطلب.",
    someUnavailable: "بعض الاستراحات المحفوظة لم تعد متاحة.",
    browseAlternatives: "تصفّح البدائل",
    addToFavorites: "إضافة إلى المفضلة",
    removeFromFavorites: "إزالة من المفضلة",
  },

  /* ---------------------------------------------------------------- gallery */
  gallery: {
    verifiedOwner: "مالك موثّق",
    imageCount: (n: string, count: number) =>
      `${n} ${plural("ar", count, {
        one: "صورة",
        two: "صورتان",
        few: "صور",
        many: "صورة",
        other: "صورة",
      })}`,
    imageNumber: (n: string) => `صورة ${n}`,
    openViewer: "عرض الصور بحجم كامل",
    imagePosition: (n: string, total: string) => `صورة ${n} من ${total}`,
    closeViewer: "إغلاق",
    zoomIn: "تكبير",
    zoomOut: "تصغير",
    previousImage: "الصورة السابقة",
    nextImage: "الصورة التالية",
    zoomHint: "اسحب للتنقل · قرّب بإصبعين أو انقر مرتين للتكبير",
  },

  /* --------------------------------------------------------------- listing */
  listing: {
    availabilityTitle: "التوفّر والحجز",
    availabilitySubtitle: "اختر تاريخ الوصول ثم تاريخ المغادرة",
    checkInOut: (inTime: string, outTime: string) =>
      `الدخول ${inTime} · الخروج ${outTime}`,
    dates: "التواريخ",
    guests: "الضيوف",
    guestCount: "عدد الضيوف",
    pickCheckIn: "اختر تاريخ الوصول",
    pickCheckOut: "اختر تاريخ المغادرة",
    weekendRate: (price: string) => `الجمعة والسبت ${price}`,
    nightsLine: (price: string, nights: string, count: number) =>
      `${price} د.إ × ${nights} ${plural("ar", count, {
        one: "ليلة",
        two: "ليلتان",
        few: "ليالٍ",
        many: "ليلة",
        other: "ليلة",
      })}`,
    occasionNightShort: "مناسبة",
    /** "عيد الفطر — ٣٬٠٠٠ د.إ × ليلتان" */
    occasionLine: (occasion: string, price: string, nights: string, count: number) =>
      `${occasion} — ${price} د.إ × ${nights} ${plural("ar", count, {
        one: "ليلة",
        two: "ليلتان",
        few: "ليالٍ",
        many: "ليلة",
        other: "ليلة",
      })}`,
    serviceFee: (pct: string) => `رسوم الخدمة (${pct}٪)`,
    total: "الإجمالي",
    depositLine: (pct: string, amount: string) =>
      `العربون ${pct}٪ (${amount} د.إ) عند تأكيد المالك`,
    noDepositLine: "لا يُطلب عربون لهذه الاستراحة",
    // ---- day use + refundable security deposit (hidden when unset)
    extraPricingTitle: "خيارات وأسعار إضافية",
    dayUseNote:
      "حجز بدون مبيت — تحضر وتغادر في نفس اليوم. اتفق على التفاصيل مع المالك عبر الواتساب.",
    dayUseWeekday: "بدون مبيت — أيام الأسبوع",
    dayUseWeekend: "بدون مبيت — نهاية الأسبوع",
    dayUseCheckOut: "وقت الخروج",
    securityDepositLabel: "التأمين (مسترد)",
    securityDepositNote:
      "يُدفع للمالك قبل الإقامة ويُعاد بالكامل بعد انتهاء الحجز وفحص الاستراحة. غير محتسب ضمن الإجمالي.",
    securityDepositLine: (amount: string) =>
      `تأمين مسترد ${amount} د.إ — يُعاد بعد فحص الاستراحة، وغير محتسب في الإجمالي`,
    pickDatesHint: "اختر تاريخين من التقويم أعلاه لعرض السعر الإجمالي.",
    requestViaWhatsapp: "اطلب الحجز عبر الواتساب",
    requestBooking: "اطلب الحجز",
    pickDatesFirst: "اختر التواريخ أولًا",
    pickDates: "اختر التواريخ",
    noDatesChosen: "لم تُحدَّد التواريخ",
    noChargeNow: "لن يُخصم أي مبلغ الآن — سيتواصل معك المالك للتأكيد.",
    ownerLabel: (name: string) => `${name} — المالك`,
    freeCancel: (hours: string) => `إلغاء مجاني حتى ${hours} ساعة`,
    contactOwnerWhatsapp: "تواصل مع المالك عبر الواتساب",
    totalSuffix: " د.إ إجمالي",
    perNightSuffix: " د.إ / ليلة",
    perDaySuffix: " د.إ / اليوم",
    stayType: "نوع الحجز",
    stayOvernight: "مع مبيت",
    stayDayUse: "بدون مبيت",
    dayUsePickOneDay: "اختر يومًا واحدًا — الحجز بدون مبيت",
    dayUsePickDay: "اختر اليوم",
    dayUseLine: "حجز يوم واحد بدون مبيت",
    dayUseLeaveBy: (time: string) => `المغادرة قبل ${time}`,
    amenitiesTitle: "المرافق والخدمات",
    descriptionTitle: "عن الاستراحة",
    locationTitle: "الموقع",
    reviewsTitle: "تقييمات الضيوف",
    noReviews: "استراحة جديدة — لا تقييمات بعد",
    instagram: "إنستقرام الاستراحة",
    policiesTitle: "سياسة الحجز",
    notFound: "الاستراحة غير موجودة",
    reviewCount: (n: string, count: number) =>
      `${n} ${plural("ar", count, {
        one: "تقييم",
        two: "تقييمان",
        few: "تقييمات",
        many: "تقييمًا",
        other: "تقييم",
      })}`,
    pastBookings: (n: string) => `${n} حجز سابق`,
    maxCapacity: "السعة القصوى",
    checkInOutLabel: "الدخول / الخروج",
    depositLabel: "العربون",
    depositOnConfirm: (pct: string) => `${pct}٪ عند التأكيد`,
    freeCancelLabel: "الإلغاء المجاني",
    upToHours: (h: string) => `حتى ${h} ساعة`,
    /** ٠ ساعة إجابة حقيقية من المالك — لا تُعرض كرقم بل كجملة. */
    noFreeCancel: "غير متاح لهذه الاستراحة",
    /** ليست مهلة بالساعات، بل إحالة إلى المالك — لا رقم يوضع في الجملة. */
    cancelAskOwner: "اسأل المالك",
    locationNote: (where: string) =>
      `${where} — يُرسل الموقع الدقيق على الخريطة بعد تأكيد الحجز.`,
    ratingOutOf: (rating: string, count: string) => `${rating} من ${count} تقييم`,
    beFirstToReview: "كن أول من يقيّم هذه الاستراحة",
    beFirstToReviewBody:
      "أُضيفت حديثًا إلى المنصة ولم تستقبل تقييمات بعد. شاركنا تجربتك بعد إقامتك.",
    tooManyImages: (n: string) => `الحد الأقصى ${n} صورة لكل استراحة`,
    prevMonth: "الشهر السابق",
    nextMonth: "الشهر التالي",
    occasionNight: "ليلة مناسبة — بسعر خاص",
    dayBooked: "محجوز",
    dayAvailable: "متاح",
    weekendHigher: "نهاية الأسبوع — سعر مرتفع",
    yourSelection: "اختيارك",
    pickCheckOutNow: "اخترت تاريخ الوصول — اختر الآن تاريخ المغادرة.",
    loadingMap: "جارٍ تحميل الخريطة…",
    viewDetailsArrow: "عرض التفاصيل ←",
  },

  /* --------------------------------------------------------------- booking */
  booking: {
    title: "إتمام الحجز",
    stayDetails: "تفاصيل الإقامة",
    contactDetails: "بيانات التواصل",
    checkInDate: "تاريخ الوصول",
    checkOutDate: "تاريخ المغادرة",
    dayUseDate: "تاريخ الحجز",
    dayUseLeaveLabel: "المغادرة",
    dayUseSameDay: "نفس اليوم — بدون مبيت",
    guestCount: "عدد الضيوف",
    maxGuests: (n: string) => `الحد الأقصى ${n}`,
    changeDates: "تغيير التواريخ من التقويم",
    fullName: "الاسم الكامل",
    fullNamePlaceholder: "مثال: خالد المنصوري",
    phone: "رقم الجوال (واتساب)",
    email: "البريد الإلكتروني (اختياري)",
    extraNotes: "ملاحظات إضافية",
    notesPlaceholder: "مثال: نحتاج تجهيز المجلس قبل المغرب، ووجود ألعاب أطفال.",
    policyIntro: "بإرسال الطلب فإنك توافق على",
    policyLink: "سياسة الحجز والإلغاء",
    policyDetail: (hours: string, pct: string) =>
      `. الإلغاء مجاني حتى ${hours} ساعة قبل موعد الوصول، ويُستحق عربون ${pct}٪ عند تأكيد المالك.`,
    policyDetailNoDeposit: (hours: string) =>
      `. الإلغاء مجاني حتى ${hours} ساعة قبل موعد الوصول، ولا يُطلب عربون لهذه الاستراحة.`,
    // المالك قد يختار ألا يمنح إلغاءً مجانيًا إطلاقًا (٠ ساعة). عرض الرقم كما هو
    // يقرأ كخلل، والأسوأ أنه يوحي بأن مهلة المنصة ما زالت سارية.
    policyDetailNoCancel: (pct: string) =>
      `. لا يوجد إلغاء مجاني لهذه الاستراحة، ويُستحق عربون ${pct}٪ عند تأكيد المالك.`,
    policyDetailNoCancelNoDeposit:
      ". لا يوجد إلغاء مجاني لهذه الاستراحة، ولا يُطلب عربون.",
    // «اسأل المالك» ليست مهلة، فلا يمكن إدراجها في جملة فيها عدد ساعات.
    policyDetailAsk: (pct: string) =>
      `. سياسة الإلغاء تُتفق عليها مباشرة مع المالك، ويُستحق عربون ${pct}٪ عند تأكيد المالك.`,
    policyDetailAskNoDeposit:
      ". سياسة الإلغاء تُتفق عليها مباشرة مع المالك، ولا يُطلب عربون.",
    submit: "إرسال الطلب عبر الواتساب",
    submitting: "جارٍ إرسال الطلب…",
    noPaymentOnline: "لا يُطلب أي دفع عبر الموقع — يتواصل معك المالك للتأكيد.",
    summaryTitle: "ملخّص الحجز",
    subtotal: "المجموع",
    serviceFee: "رسوم الخدمة",
    totalAmount: "الإجمالي المستحق",
    depositAmount: "العربون المطلوب",
    depositExplain: (pct: string) => `${pct}٪ من الإجمالي، يُدفع عند تأكيد المالك`,
    noDepositRequired: "لا يُطلب عربون",
    confirmTitle: "تم استلام طلبك",
    confirmBody:
      "أرسل التفاصيل للمالك عبر الواتساب الآن ليصلك التأكيد في أسرع وقت.",
    reference: "رقم الطلب",
    openWhatsapp: "إرسال التفاصيل عبر الواتساب",
    // ---- the five-second automatic hand-off to WhatsApp
    autoSendButton: (seconds: string) => `إرسال التفاصيل عبر الواتساب (${seconds})`,
    // Counts down through 2 and 1, where Arabic needs the dual and the
    // singular — "بعد ١ ثوانٍ" would be wrong on the last two ticks of a
    // screen every booking passes through.
    autoSendCountdown: (seconds: string, count: number) =>
      `سيفتح الواتساب تلقائيًا بعد ${seconds} ${plural("ar", count, {
        one: "ثانية",
        two: "ثانيتين",
        few: "ثوانٍ",
        many: "ثانية",
        other: "ثانية",
      })}…`,
    autoSendCancel: "إيقاف",
    autoSendCancelled: "أُوقف الإرسال التلقائي — اضغط الزر أعلاه عندما تكون جاهزًا.",
    autoSendManual: "اضغط الزر لفتح الواتساب برسالة جاهزة — لن تُرسل حتى تضغط إرسال.",
    introBody:
      "املأ البيانات التالية وسيصل طلبك مباشرة إلى مالك الاستراحة على الواتساب. لا يُخصم أي مبلغ في هذه المرحلة.",
    keepReference: "احتفظ برقم الطلب للمراجعة:",
    depositPayOnline: (amount: string) =>
      `يمكنك دفع العربون (${amount} د.إ) إلكترونيًا بعد تأكيد المالك.`,
    securityDepositNote: (amount: string) =>
      `مبلغ التأمين ${amount} د.إ يُسلَّم للمالك قبل الإقامة ويُعاد بالكامل بعد انتهاء الحجز وفحص الاستراحة — وهو غير محتسب ضمن الإجمالي أعلاه.`,
    depositCollectedByOwner: (amount: string) =>
      `العربون المتوقع ${amount} د.إ ويُحصَّل مباشرة من المالك بعد تأكيد التوفّر — لا يوجد دفع إلكتروني على الموقع حاليًا.`,
    bookingNotFound: "الطلب غير موجود",
  },

  /* ------------------------------------------------------------------ auth */
  auth: {
    loginTitle: "تسجيل الدخول",
    loginSubtitle: "لوحة تحكم المُلّاك وإدارة المنصة",
    email: "البريد الإلكتروني",
    identifier: "اسم المستخدم",
    identifierHint: "المُلّاك: رقم هاتفك بصيغة 971503322119",
    password: "كلمة المرور",
    signIn: "دخول",
    signingIn: "جارٍ الدخول…",
    signOut: "تسجيل الخروج",
    invalidCredentials: "اسم المستخدم أو كلمة المرور غير صحيحة",
    missingCredentials: "الرجاء إدخال اسم المستخدم وكلمة المرور",
    noAccount: "ليس لديك حساب مالك؟",
    registerHere: "سجّل استراحتك",
    haveAccount: "لديك حساب بالفعل؟",
    loginHere: "تسجيل الدخول",
    ownerPortal: "بوابة المُلّاك",
    ownerPortalTitle: "أدر استراحتك من جوّالك، في أي وقت",
    ownerPortalBody:
      "حدّث الأسعار، احظر التواريخ، وأجب على طلبات الحجز — كل ذلك من شاشة واحدة.",
    ownerPortalPoint1: "كل طلب حجز جديد يظهر في لوحتك فورًا",
    ownerPortalPoint2: "تقويم واحد لكل استراحاتك",
    ownerPortalPoint3: "ردّ على العميل بضغطة واحدة على الواتساب",
    loginHint: "أدخل بريدك الإلكتروني وكلمة المرور للوصول إلى لوحة التحكم.",
    sessionExpired: "انتهت صلاحية جلستك أو لم يعد الحساب متاحًا. سجّل الدخول من جديد.",
    backToSite: "الرجوع إلى الموقع",
    checking: "جارٍ التحقّق…",
    enterDashboard: "دخول لوحة التحكم",
    showPassword: "إظهار كلمة المرور",
    hidePassword: "إخفاء كلمة المرور",
  },

  /* ----------------------------------------------------------------- owner */
  owner: {
    // registration
    registerTitle: "سجّل استراحتك على المنصة",
    registerSubtitle:
      "أضف بياناتك وسيراجع فريقنا الطلب. بعد الموافقة يمكنك نشر استراحاتك واستقبال الحجوزات.",
    accountSection: "بيانات الحساب",
    businessSection: "بيانات المالك والنشاط",
    fullName: "الاسم الكامل",
    fullNamePlaceholder: "مثال: سالم المنصوري",
    email: "البريد الإلكتروني",
    emailReadOnlyHint: "للتواصل فقط — لا يُستخدم لتسجيل الدخول",
    phone: "رقم الهاتف",
    phoneIsUsernameHint: "هذا الرقم هو اسم المستخدم لتسجيل الدخول — بصيغة 971503322119",
    yourUsername: "اسم المستخدم لتسجيل الدخول",
    whatsapp: "رقم الواتساب",
    whatsappHint: "هذا الرقم سيظهر لعملائك في كل استراحاتك",
    password: "كلمة المرور",
    passwordHint: "٨ أحرف على الأقل",
    confirmPassword: "تأكيد كلمة المرور",
    businessName: "اسم النشاط أو الشركة",
    businessNamePlaceholder: "اختياري — يظهر للعملاء",
    idNumber: "رقم الهوية أو الرخصة التجارية",
    idNumberHint: "اختياري — يُستخدم للتحقق فقط ولا يظهر للعملاء",
    city: "الإمارة",
    about: "نبذة عنك",
    aboutPlaceholder: "اختياري — نبذة قصيرة تظهر للعملاء",
    submitRegistration: "إرسال طلب التسجيل",
    submittingRegistration: "جارٍ الإرسال…",
    registrationSuccess: "تم استلام طلبك — سيراجعه فريقنا قريبًا",

    // status
    statusTitle: "حالة طلبك",
    statusPendingTitle: "طلبك قيد المراجعة",
    statusPendingBody:
      "استلمنا طلب تسجيلك ويراجعه فريقنا الآن. سنبلغك فور اتخاذ القرار، ولا يمكنك نشر الاستراحات حتى تتم الموافقة.",
    statusApprovedTitle: "تمت الموافقة على حسابك",
    statusApprovedBody: "يمكنك الآن إضافة استراحاتك واستقبال طلبات الحجز.",
    statusRejectedTitle: "لم تتم الموافقة على طلبك",
    statusRejectedBody: "راجع السبب أدناه، ويمكنك التواصل معنا لمزيد من التفاصيل.",
    statusSuspendedTitle: "حسابك موقوف مؤقتًا",
    statusSuspendedBody:
      "تم إيقاف حسابك من قِبل الإدارة. استراحاتك مخفية عن الموقع حاليًا — تواصل معنا لمعرفة التفاصيل.",
    statusExpiredTitle: "انتهت صلاحية عضويتك",
    statusExpiredBody:
      "انتهت صلاحية عضويتك، لذلك أُخفيت استراحاتك عن الموقع. جدّد عضويتك لإعادتها للظهور كما كانت.",
    rejectionReason: "سبب الرفض",
    membershipExpiry: "انتهاء العضوية",
    membershipActive: (date: string) => `عضوية سارية حتى ${date}`,
    membershipExpired: (date: string) => `انتهت العضوية في ${date}`,
    membershipNone: "لم تُحدَّد مدة العضوية بعد",
    goToDashboard: "الذهاب إلى لوحة التحكم",

    // dashboard
    dashboardTitle: "لوحة تحكم المالك",
    myListings: "استراحاتي",
    myCalendar: "التقويم",
    myBookings: "طلبات الحجز",
    myProfile: "ملفي",
    overview: "نظرة عامة",
    calendar: "التقويم",
    listingsCount: (n: string, count: number) =>
      `${n} ${plural("ar", count, {
        zero: "استراحة",
        one: "استراحة",
        two: "استراحتان",
        few: "استراحات",
        many: "استراحة",
        other: "استراحة",
      })}`,
    noListingsTitle: "لم تُضف أي استراحة بعد",
    noListingsBody: "اضغط «إضافة» لإنشاء أول استراحة لك على الموقع.",
    addListing: "إضافة استراحة",
    editListing: "تعديل الاستراحة",
    profileTitle: "بيانات المالك",
    profileSubtitle: "رقم الواتساب هنا هو ما يظهر لعملائك في كل استراحاتك.",
    profileSaved: "تم حفظ بياناتك",
    depositPercent: "نسبة العربون",
    depositPercentHint:
      "النسبة المطلوبة من إجمالي الحجز. اتركها فارغة لاستخدام النسبة الافتراضية للمنصة.",
    depositPercentSuffix: "٪ من الإجمالي",
    usingPlatformDefault: (pct: string) => `الافتراضي للمنصة: ${pct}٪`,
    securityDeposit: "التأمين (مسترد)",
    securityDepositHint:
      "مبلغ يُعاد للضيف بعد انتهاء الحجز وفحص الاستراحة. اتركه صفرًا إن لم تطلبه — عندها لا يظهر للضيف.",

    // ---- insights ----
    // Everything below is derived from the platform's own booking, calendar and
    // review rows. There is no analytics in the schema, so there is deliberately
    // nothing here about views, visits or impressions.
    earningsAhead: "دخل الشهر القادم",
    earningsAheadSub: "من الحجوزات المؤكدة",
    earningsNote: "القيمة قبل التأمين المسترد",
    unansweredStat: "بانتظار ردك",
    unansweredStatSub: "منذ أكثر من ٢٤ ساعة",

    adviceTitle: "ملاحظات على أدائك",
    insightUnanswered: (n: string) =>
      `${n} من الطلبات تنتظر ردك منذ أكثر من ٢٤ ساعة — سرعة الرد ترفع نسبة التأكيد`,
    insightLowConfirmation: (pct: string) =>
      `تؤكد ${pct}٪ فقط من الطلبات التي ترد عليها — راجع تقويمك وأسعارك حتى لا تفقد ضيوفًا`,
    insightWeekendDemand: (pct: string) =>
      `${pct}٪ من لياليك المحجوزة في نهاية الأسبوع، وسعر الجمعة والسبت لديك مثل باقي الأيام — حدّد سعرًا خاصًا لنهاية الأسبوع`,
    insightQuietListing: (name: string) =>
      `«${name}» لم يصلها أي طلب في هذه الفترة — راجع السعر والصور والوصف`,
    insightFewPhotos: (name: string) =>
      `«${name}» فيها أقل من ٤ صور — الاستراحات ذات الصور الأكثر تستقبل طلبات أكثر`,
    insightHighOccupancy: (pct: string) =>
      `إشغالك ${pct}٪ خلال الشهر القادم — يمكنك رفع السعر أو فتح أيام إضافية`,
    insightNoListings: "أضف أول استراحة لتبدأ باستقبال الطلبات وتظهر إحصاءاتك هنا",

    trendTitle: "الدخل الشهري",
    trendSub: (n: string) => `آخر ${n} أشهر — محسوبة على شهر الوصول`,
    trendEmpty: "لا توجد حجوزات مؤكدة في هذه الفترة بعد",
    trendMonthLabel: (month: string, amount: string, count: string) =>
      `${month}: ${amount} درهم من ${count} حجز مؤكد`,

    occupancyTitle: "إشغال التقويم",
    occupancySub: (days: string) => `الـ ${days} يومًا القادمة`,
    occupancyDetail: (booked: string, capacity: string) =>
      `${booked} ليلة محجوزة من أصل ${capacity}`,
    occupancyNoListings: "انشر استراحة واحدة على الأقل ليظهر الإشغال",

    patternsTitle: "سلوك الحجز",
    patternsSub: (days: string) => `آخر ${days} يومًا`,
    avgValue: "متوسط قيمة الحجز",
    avgNightsLabel: "متوسط الليالي",
    avgLeadTime: "متوسط الحجز المسبق",
    avgLeadTimeValue: (n: string) => `${n} يومًا`,
    avgGuestsLabel: "متوسط الضيوف",
    weekendShare: "نصيب نهاية الأسبوع",
    weekendShareSub: "من الليالي المحجوزة",
    repeatGuests: "ضيوف عادوا إليك",
    confirmationRate: "معدل التأكيد",
    confirmationRateSub: "من الطلبات التي رددت عليها",
    requestsInWindow: "إجمالي الطلبات",
    notEnoughData: "لا توجد بيانات كافية بعد",

    listingsTableTitle: "أداء كل استراحة",
    colListing: "الاستراحة",
    colRequests: "الطلبات",
    colConfirmed: "مؤكدة",
    colEarnings: "الدخل",
    colOccupancy: "الإشغال",
    colRating: "التقييم",
    hiddenListing: "مخفية",
    noReviewsYet: "جديدة",
    neverRequested: "لم يصلها طلب بعد",

    upcomingTitle: "وصول قريب",
    upcomingSub: "الحجوزات المؤكدة خلال ١٤ يومًا",
    upcomingEmpty: "لا توجد حجوزات مؤكدة قادمة",
    upcomingLine: (guests: string, nights: string) => `${guests} ضيفًا · ${nights} ليلة`,

    // gating
    blockedPendingTitle: "لا يمكنك نشر الاستراحات بعد",
    blockedPendingBody: "سيتم تفعيل هذه الصفحة فور موافقة الإدارة على حسابك.",
  },

  /* ----------------------------------------------------------------- admin */
  admin: {
    dashboard: "لوحة التحكم",
    overview: "نظرة عامة",
    listings: "الاستراحات",
    calendar: "التقويم",
    requests: "الطلبات",
    insights: "التحليلات",
    settings: "الإعدادات",
    owners: "المُلّاك",
    ownerRequests: "طلبات التسجيل",
    customers: "العملاء",
    bookings: "الحجوزات",
    payments: "المدفوعات",
    auditLog: "سجل النشاط",
    account: "حسابي",
    accountIntro: "بيانات حسابك في لوحة التحكم وكلمة المرور الخاصة بك.",
    accountDetails: "بيانات الحساب",
    accountEmailHint: "هذا هو معرّف الدخول للوحة التحكم",
    accountPassword: "كلمة المرور",
    accountPasswordNote: "لتغيير كلمة المرور يجب إدخال كلمة المرور الحالية.",
    currentPassword: "كلمة المرور الحالية",
    accountUpdated: "تم تحديث بيانات حسابك",
    accountPasswordChanged: "تم تغيير كلمة المرور",

    greetingNight: "ليلة هادئة",
    greetingMorning: "صباح الخير",
    greetingAfternoon: "طاب يومك",
    greetingEvening: "مساء الخير",

    // ---- the overview tiles ----
    // Waiting on this desk (1–4): these carry the indicator dot.
    statNewRequests: "طلبات جديدة",
    statNewRequestsSub: "بانتظار الرد",
    statPendingOwners: "طلبات تسجيل",
    statPendingOwnersSub: "بانتظار المراجعة",
    statCommissionToConfirm: "عمولات بانتظار التأكيد",
    statCommissionToConfirmSub: "حوّلها المالك ولم تُؤكَّد",
    statReviewsToModerate: "تقييمات بانتظار المراجعة",
    statReviewsToModerateSub: "لن تظهر قبل موافقتك",

    // How big the platform is (5–8).
    statOwners: "المُلّاك",
    statOwnersSub: "نشط",
    statListings: "الاستراحات",
    statListingsSub: (published: string) => `${published} منشورة`,
    statConfirmedAll: "حجوزات مؤكدة",
    statConfirmedAllSub: "قيد المتابعة + مكتملة",
    statReviews: "عدد التقييمات",
    statReviewsSub: "منشورة على الموقع",

    // Still being worked (9).
    statConfirmed: "حجوزات مؤكدة",
    statConfirmedSub: "قيد المتابعة",

    // The two months (10–13), and how they compare (14–15).
    statOccupancy: "نسبة الإشغال",
    statOccupancySub: "٣٠ يومًا القادمة",
    statRevenue: "الإيراد المتوقّع",
    statRevenueSub: "درهم — حجوزات مؤكدة",
    statOccupancyThisMonth: "إشغال الشهر الحالي",
    statOccupancyNextMonth: "إشغال الشهر القادم",
    statRevenueThisMonth: "إيراد الشهر الحالي",
    statRevenueNextMonth: "إيراد الشهر القادم",
    /** Says out loud that the month is counted whole — elapsed days included. */
    statWholeMonth: (month: string) => `${month} — الشهر كاملًا`,
    statRevenueMonthSub: (month: string) => `درهم — حجوزات مؤكدة في ${month}`,
    statOccupancyChange: "الإشغال: القادم مقابل الحالي",
    /** Points, not percent: the gap between two percentages is not a ratio. */
    statOccupancyChangeSub: "فرق نقاط الإشغال",
    statRevenueChange: "الإيراد: القادم مقابل الحالي",
    statRevenueChangeSub: "تغيّر نسبي عن الشهر الحالي",

    // Who is carrying the month (16–17).
    statTopRevenue: "أعلى استراحة إيرادًا",
    statTopBookings: "أعلى استراحة حجوزًا",
    statTopRevenueSub: (amount: string, month: string) => `${amount} د.إ · ${month}`,
    statTopBookingsSub: (count: string, month: string) => `${count} حجز · ${month}`,
    statNoData: "لا بيانات بعد",

    latestRequests: "أحدث الطلبات",
    noRequestsYet: "لا توجد طلبات بعد.",
    quickAddListing: "إضافة استراحة",
    quickBlockDates: "حظر تواريخ",
    pendingRequestsLine: (n: string) => `لديك ${n} طلبات بانتظار الرد`,
    noPendingRequests: "لا طلبات معلّقة",

    // owners
    ownersTitle: "المُلّاك",
    ownersSubtitle: (n: string) => `${n} مالك مسجّل`,
    ownerRequestsTitle: "طلبات تسجيل المُلّاك",
    ownerRequestsSubtitle: (n: string) => `${n} طلب بانتظار المراجعة`,
    noOwners: "لا يوجد مُلّاك مسجّلون بعد.",
    noOwnerRequests: "لا توجد طلبات تسجيل بانتظار المراجعة.",
    approve: "موافقة",
    reject: "رفض",
    suspend: "إيقاف",
    activate: "تفعيل",
    setExpiry: "تحديد انتهاء العضوية",
    rejectionReasonLabel: "سبب الرفض (اختياري)",
    rejectionReasonPlaceholder: "مثال: البيانات غير مكتملة",
    confirmReject: "تأكيد الرفض",
    membershipExpiresAt: "انتهاء العضوية",
    membershipStatus: "حالة العضوية",
    listingsOwned: "الاستراحات",
    registeredAt: "تاريخ التسجيل",
    ownerApproved: "تمت الموافقة على المالك",
    ownerRejected: "تم رفض طلب المالك",
    ownerSuspended: "تم إيقاف حساب المالك",
    ownerActivated: "تم تفعيل حساب المالك",
    membershipUpdated: "تم تحديث تاريخ انتهاء العضوية",
    expiryHint: "اترك الحقل فارغًا لعضوية بلا تاريخ انتهاء.",
    // ---- managing an owner's account from the owners table
    manageOwner: "إدارة الحساب",
    manageOwnerTitle: "إدارة حساب المالك",
    ownerDetailsTab: "البيانات",
    ownerPasswordTab: "كلمة المرور",
    ownerUpdated: "تم حفظ بيانات المالك",
    ownerPasswordChanged: "تم تغيير كلمة المرور",
    newPassword: "كلمة المرور الجديدة",
    confirmNewPassword: "تأكيد كلمة المرور",
    newPasswordHint:
      "٨ أحرف على الأقل. أبلغ المالك بها بنفسك — لا تُرسل من الموقع، ولا تظهر في السجل.",
    changePassword: "تغيير كلمة المرور",
    ownerNoCity: "غير محدّدة",
    ownerCommissionLabel: "عمولة هذا المالك (٪)",
    ownerCommissionHint: (platform: string) =>
      `اتركه فارغًا لتطبيق عمولة المنصة (${platform}). اكتب صفرًا لإعفائه من العمولة.`,
    ownerCommissionPlaceholder: "عمولة المنصة",
    ownerAboutLabel: "نبذة",
    ownerIdNumberLabel: "رقم الهوية / الرخصة التجارية",
    hiddenListingsNote: (n: string) =>
      `${n} استراحة مخفية عن الموقع بسبب حالة المالك أو انتهاء العضوية`,

    // customers
    customersTitle: "العملاء",
    customersSubtitle: (n: string) => `${n} عميل`,
    noCustomers: "لا يوجد عملاء بعد.",
    customerBookings: "عدد الحجوزات",
    customerLastBooking: "آخر حجز",
    customerTotalSpend: "إجمالي القيمة",

    // bookings / payments
    bookingsTitle: "كل الحجوزات",
    paymentsTitle: "الإيرادات والعمولات",
    paymentsSubtitle: "القيمة الإجمالية للحجوزات، وعمولة المنصة المستحقة عليها.",
    noPayments: "لا توجد حجوزات مسجّلة.",
    depositDue: "العربون المستحق",
    depositPercentCol: "نسبة العربون",
    paymentStatus: "حالة الدفع",

    // payments — totals and commission
    commissionCol: "عمولة المنصة",
    commissionStateCol: "حالة العمولة",
    commissionNotDue: "غير مستحقة بعد",
    commissionWaiting: "بانتظار التحويل",
    commissionSent: "حُوِّلت — بانتظار التأكيد",
    commissionReceived: "مستلمة",
    stageCol: "مرحلة الحجز",
    confirmedValueTile: "قيمة الحجوزات المؤكدة",
    commissionConfirmedTile: "عمولة الحجوزات المؤكدة",
    commissionCollectedTile: "عمولة مستلمة فعلياً",
    commissionOutstandingTile: "عمولة لم تصل بعد",
    allValueTile: "قيمة كل الحجوزات",
    // "الافتراضية" منذ أن صار لكل مالك أن يُخصَّص له سعر عمولة خاص. الرقم
    // المطبَّق فعليًا على كل حجز مخزَّن في صفّه ويظهر في جدول الحجوزات أدناه.
    commissionRateNote: (percent: string) =>
      `العمولة الافتراضية ${percent} من قيمة الحجز، يحوّلها المالك بنكياً في الخطوة السادسة. قد يكون لبعض الملّاك سعر متفق عليه مختلف.`,

    // reviews moderation
    reviews: "التقييمات",
    reviewsTitle: "تقييمات الضيوف",
    reviewsSubtitle: "التقييمات الواردة من روابط الضيوف — لا تظهر على الموقع قبل الموافقة.",
    noReviews: "لا توجد تقييمات.",
    reviewPendingCount: (n: string) => `${n} تقييم بانتظار المراجعة`,
    reviewApprove: "موافقة ونشر",
    reviewReject: "رفض",
    reviewAuthor: "الضيف",
    reviewRating: "التقييم",
    reviewBody: "النص",
    reviewListing: "الاستراحة",
    reviewWhen: "التاريخ",

    // audit
    auditTitle: "سجل النشاط",
    auditSubtitle: "كل إجراء إداري مؤثّر، بالترتيب الزمني.",
    noAudit: "لا توجد سجلات بعد.",
    auditActor: "المنفّذ",
    auditAction: "الإجراء",
    auditEntity: "العنصر",
    auditWhen: "الوقت",

    seedHint: "أضف أول استراحة لتظهر على الموقع، أو شغّل npm run db:seed لتحميل بيانات تجريبية.",
    customersTruncated: (n: string) => `يُحلَّل أحدث ${n} طلب حجز. استخدم البحث لتضييق النطاق.`,
    depositConfirmedTile: "عرابين الحجوزات المؤكدة",
    revenueConfirmedTile: "إجمالي الحجوزات المؤكدة",
    depositAllTile: "كل العرابين",
    revenueAllTile: "كل الحجوزات",

    // request card
    datesBooked: "التواريخ محجوزة في التقويم",
    messageCustomer: "مراسلة العميل على الواتساب",
    cancelBookingFreeDates: "إلغاء الحجز وتحرير التواريخ",
    returnToQueue: "إعادة إلى الانتظار",
    deleteRequest: "حذف الطلب",
    cannotBeUndone: "لا يمكن التراجع عن هذه الخطوة.",
    // حلّ محل تنبيه «يُعرض أحدث ٢٠٠ طلب» — الترقيم يصل إلى كل طلب، فلم يعد
    // هناك سقف صامت يحتاج اعتذارًا.
    pagerLabel: "تنقّل بين صفحات الأرشيف",
    pageOf: (page: string, total: string) => `صفحة ${page} من ${total}`,

    // listing editor
    newListingTitle: "إضافة استراحة جديدة",
    editListingTitle: "تعديل بيانات الاستراحة",
    photosLabel: "صور الاستراحة",
    saveBeforePhotos: "احفظ الاستراحة أولًا، ثم ستتمكّن من رفع الصور.",
    coverPhoto: "الغلاف",
    makeCover: "اجعلها الغلاف",
    deletePhoto: "حذف الصورة",
    uploading: "جارٍ الرفع…",
    photoHint: "JPG أو PNG أو WebP — حتى ٢٠٠ ميغابايت للصورة. أول صورة هي الغلاف.",
    listingName: "اسم الاستراحة",
    listingNamePlaceholder: "مثال: استراحة الرمال الذهبية",
    areaLabel: "المنطقة / الموقع",
    areaPlaceholder: "لهباب – دبي",
    pricePerNightLabel: "سعر الليلة (د.إ)",
    holidayPriceLabel: "سعر المناسبات والعطل الرسمية (د.إ)",
    holidayPriceHint:
      "لعيد الفطر والأضحى واليوم الوطني ورأس السنة. اتركه صفرًا إن لم ترغب بسعر خاص، ثم حدّد الأيام من التقويم.",
    weekendPriceLabel: "سعر نهاية الأسبوع",
    weekendPriceHint: "اتركه صفرًا ليساوي السعر العادي",
    // ---- أيام نهاية الأسبوع: الجمعة والسبت لأغلب الاستراحات، وبعضها يضيف الأحد
    platformFallbackHint: "يُستخدم للاستراحات التي لم يحدّد مالكها قيمة خاصة",
    weekendModeLabel: "أيام نهاية الأسبوع",
    weekendModeHint: "الأيام التي يُطبَّق عليها سعر نهاية الأسبوع",
    weekendModeShort: "ويكند قصير — الجمعة والسبت",
    weekendModeLong: "ويكند طويل — الجمعة والسبت والأحد",
    weekendModeCardTitle: "نهاية الأسبوع وسياسة الاستراحة",
    weekendModeCardHint:
      "لكل استراحة عطلتها وسياستها. اختر «ويكند طويل» — عندها يُطبَّق سعر نهاية الأسبوع على ثلاث ليالٍ بدل ليلتين.",
    // ---- سياسة الدخول والخروج والإلغاء، خاصة بكل استراحة
    listingCheckInLabel: "وقت الدخول",
    listingCheckOutLabel: "وقت الخروج",
    listingCheckTimeHint: "اتركه فارغًا لاستخدام وقت المنصة",
    listingCheckInPlaceholder: "مثال: ٤ عصرًا",
    listingCheckOutPlaceholder: "مثال: ١٢ ظهرًا",
    /** خيارات قائمة الإلغاء المجاني — نفس ترتيب CANCEL_POLICIES. */
    cancelPolicyOptions: {
      NONE: "لا يوجد إلغاء مجاني",
      H24: "قبل ٢٤ ساعة",
      H48: "قبل ٤٨ ساعة",
      H72: "قبل ٣ أيام",
      H120: "قبل ٥ أيام",
      ASK: "اسأل المالك",
    },
    /** الخيار الأول: ما ترثه الاستراحة اليوم، مسمّى حتى لا تكذب القائمة. */
    usePlatformCancel: (value: string) => `سياسة المنصة (${value})`,
    listingFreeCancelLabel: "الإلغاء المجاني (ساعة)",
    listingFreeCancelHint: "اتركه فارغًا لاستخدام مهلة المنصة، أو اكتب ٠ لمنع الإلغاء المجاني",
    // The first option of every hour menu. Two wordings, because "unset" means
    // two different things — see `StayHourSelect` in listing-editor.tsx.
    usePlatformTime: (value: string) => `وقت المنصة (${value})`,
    keepCurrentTime: (value: string) => `الوقت الحالي: ${value}`,
    dayUseCheckOutNotSet: "لا يوجد حجز بدون مبيت",
    // ---- day-use card in the listing editor
    dayUseCardTitle: "الحجز بدون مبيت (اختياري)",
    dayUseCardHint:
      "أسعار الحضور والمغادرة في نفس اليوم. اتركها صفرًا إن كنت لا تقدّم هذا الخيار — عندها لا يظهر منها شيء في صفحة الاستراحة.",
    dayUsePriceLabel: "سعر أيام الأسبوع (د.إ)",
    dayUseWeekendPriceLabel: "سعر نهاية الأسبوع (د.إ)",
    dayUseCheckOutLabel: "وقت الخروج",
    dayUseCheckOutHint: "الوقت الذي يغادر فيه الضيف",
    capacityLabel: "السعة (ضيف)",
    descriptionLabel: "الوصف",
    listingInstagram: "رابط إنستقرام الاستراحة",
    listingInstagramHint: "يظهر كأيقونة إنستقرام في صفحة الاستراحة — اتركه فارغًا إن لم يوجد",
    descriptionPlaceholder: "اكتب وصفًا موجزًا يبرز ما يميّز استراحتك.",
    englishListingCard: "النسخة الإنجليزية للاستراحة",
    englishListingHint:
      "هذه الحقول هي ما يقرأه زائر الواجهة الإنجليزية. اتركها فارغة ليظهر النص العربي كما هو — الترجمة اختيارية حقلًا بحقل.",
    listingNameEnLabel: "اسم الاستراحة (إنجليزي)",
    listingNameEnPlaceholder: "Golden Sands Rest House",
    areaEnLabel: "المنطقة / الموقع (إنجليزي)",
    areaEnPlaceholder: "Lahbab – Dubai",
    descriptionEnLabel: "الوصف (إنجليزي)",
    descriptionEnPlaceholder: "A short description in English.",
    occasionsLabel: "المناسبات المناسبة",
    selectedCount: (n: string) => `${n} مُحدَّد`,
    mapLocationLabel: "الموقع على الخريطة",
    mapLocationHint: "انسخ الإحداثيات من خرائط جوجل والصقها هنا",
    coordinatesFormat: "اكتب الإحداثيات بالصيغة: 24.7614, 55.3340",
    coordinatesInvalid: "الإحداثيات غير صحيحة",
    ownerNameLabel: "اسم المالك",
    ownerWhatsappLabel: "واتساب المالك",
    ownerWhatsappHint: "للاستراحات غير المرتبطة بمالك مسجّل فقط",
    assignOwner: "المالك المسجّل",
    assignOwnerHint: "عند الربط بمالك، يُستخدم رقم واتسابه تلقائيًا",
    platformOwned: "بدون مالك (تابعة للمنصة)",
    publishedToggle: "منشورة على الموقع",
    publishedToggleHint: "عند إيقافها لن تظهر للزوار",
    verifiedToggle: "موثّقة",
    verifiedToggleHint: "تظهر شارة «موثّقة» على البطاقة",
    featuredToggle: "مميّزة في الصفحة الرئيسية",
    featuredToggleHint: "تظهر في قسم «استراحات مميّزة»",
    createListing: "إنشاء الاستراحة",
    saveChanges: "حفظ التعديلات",

    // listing grid chrome
    featured: "مميّزة",
    publishedBadge: "منشورة",
    hiddenBadge: "مخفية",
    hiddenByOwnerState: "مخفية عن الموقع — حالة المالك أو انتهاء العضوية",
    viewOnSite: "عرض على الموقع",
    deleting: "جارٍ الحذف…",
    confirmDeleteTitle: (name: string) => `حذف «${name}»؟`,
    confirmDeleteBody:
      "سيُحذف أيضًا كل ما يتبعها: الصور، التقويم، طلبات الحجز والتقييمات. لا يمكن التراجع.",
    confirmDeleteYes: "نعم، احذفها",

    // shared table chrome
    searchPlaceholder: "ابحث…",
    showingRange: (from: string, to: string, total: string) =>
      `${from}–${to} من ${total}`,
    perPage: "لكل صفحة",
    noMatches: "لا توجد نتائج مطابقة",
    availabilityEditor: "محرّر التوفّر",
    availabilityEditorHint:
      "اضغط على أي يوم لحظره أو إتاحته. الأيام المحظورة تظهر للزوار كـ«محجوز».",
    selectListing: "الاستراحة",
    dayBookedConfirmed: "محجوز بطلب مؤكد",
    dayBlocked: "محظور",
    dayBlockedClickToFree: "محظور — اضغط للتحرير",
    availableToBook: "متاح للحجز",
    blockRestOfMonth: "حظر بقية الشهر",
    freeRestOfMonth: "تحرير بقية الشهر",
    blockedDaysCount: (n: string) => `${n} يومًا محظورًا`,
    bookedDaysCount: (n: string) => `${n} يومًا محجوزًا`,
    noListingsForCalendar: "لا توجد استراحات لإدارة تقويمها",
    addListingFirstShort: "أضف استراحة أولًا.",
    moreSections: "المزيد",
    allSections: "كل أقسام اللوحة",
    englishCopyCard: "النسخة الإنجليزية",
    englishCopyHint:
      "اتركه فارغًا ليظهر النص العربي كما هو في الواجهة الإنجليزية. املأ ما تريد ترجمته فقط.",
    siteNameEnLabel: "اسم الموقع (إنجليزي)",
    taglineEnLabel: "الوصف المختصر (إنجليزي)",
    heroTitleEnLabel: "عنوان الغلاف (إنجليزي)",
    heroTitleAltEnLabel: "السطر الثاني (إنجليزي)",
    heroSubtitleEnLabel: "نص الغلاف (إنجليزي)",
    footerAboutEnLabel: "نص الفوتر (إنجليزي)",
    seoTitleEnLabel: "عنوان SEO (إنجليزي)",
    seoDescriptionEnLabel: "وصف SEO (إنجليزي)",
    addressLineEnLabel: "العنوان النصّي (إنجليزي)",
    paymentDisabled: "الدفع الإلكتروني غير مُفعّل — العربون يُحصّل مباشرة من المالك.",
    paymentMisconfigured:
      "الخيار مُفعّل لكن مفاتيح بوابة الدفع غير مُهيّأة في الخادم (STRIPE_SECRET_KEY).",
    paymentEnabled: "الدفع الإلكتروني مُفعّل.",
    cardIdentity: "الهوية",
    cardContact: "التواصل",
    cardColors: "الألوان",
    cardBanking: "الحساب البنكي والرخصة التجارية",
    bankingIntro:
      "هذا هو الحساب الذي يحوّل عليه المُلّاك عمولة المنصّة — يظهر لهم في الخطوة السادسة من مسار الحجز. رقم الرخصة يظهر في فوتر الموقع. اترك أي حقل فارغًا ولن يظهر إطلاقًا.",
    fieldBankName: "اسم البنك",
    fieldBankNamePlaceholder: "بنك الإمارات دبي الوطني",
    fieldAccountHolder: "اسم صاحب الحساب",
    fieldAccountNumber: "رقم الحساب",
    fieldIban: "رقم الآيبان (IBAN)",
    fieldIbanHint: "يُنسخ بضغطة واحدة من شاشة المالك",
    fieldTradeLicense: "رقم الرخصة التجارية",
    fieldTradeLicenseHint: "يظهر في فوتر الصفحة الرئيسية",
    cardLocation: "الموقع الجغرافي",
    cardBooking: "شروط الحجز",
    cardHomeSeo: "الصفحة الرئيسية و SEO",
    fieldSiteName: "اسم الموقع",
    fieldTagline: "الوصف المختصر",
    fieldTaglineHint: "يظهر تحت الاسم في الهيدر",
    fieldLogoGlyph: "حرف الشعار",
    fieldLogoGlyphHint: "يظهر داخل المربّع الذهبي عند عدم وجود صورة",
    logoAlt: "الشعار",
    logoNote:
      "يظهر في الهيدر والفوتر وصفحة الدخول بدل اسم الموقع. يُقبل SVG وPNG وJPG، ويُقصّ الفراغ حول الشعار تلقائيًا.",
    uploadLogo: "رفع شعار",
    removeLogo: "إزالة الشعار",
    fieldWhatsapp: "رقم الواتساب",
    fieldWhatsappHint: "يُستخدم في كل أزرار الواتساب على الموقع",
    fieldPhone: "رقم الهاتف",
    fieldPhoneHint: "يظهر في الشريط العلوي",
    fieldInstagram: "إنستغرام",
    fieldFullUrlHint: "الرابط الكامل",
    fieldTiktok: "تيك توك",
    fieldYoutube: "يوتيوب",
    colorsIntro:
      "اختر لونين أساسيين وستُشتَق بقية التدرّجات تلقائيًا — الأزرار، الشارات، التقويم والخرائط.",
    colorPresets: "مجموعات جاهزة",
    presetDesertGold: "ذهبي صحراوي",
    presetCopper: "نحاسي",
    presetClay: "طيني",
    presetOlive: "زيتوني",
    presetDarkBronze: "برونزي داكن",
    colorAccentLabel: "اللون المميّز",
    colorAccentDeepLabel: "درجة أغمق",
    colorNightLabel: "اللون الداكن",
    colorSandLabel: "لون الخلفية",
    previewLabel: "معاينة",
    previewPrimaryButton: "زر أساسي",
    previewDarkButton: "زر داكن",
    previewBadge: "شارة",
    fieldCoordinates: "إحداثيات خرائط جوجل",
    fieldCoordinatesHint: "انسخها من خرائط جوجل والصقها كما هي",
    fieldZoom: "مستوى التكبير",
    fieldZoomHint: "١ (بعيد) – ٢٠ (قريب)",
    fieldAddressLine: "العنوان النصّي",
    locationPreview: "معاينة الموقع",
    previewAfterSave: "المعاينة تتحدّث بعد الحفظ.",
    fieldServiceFee: "رسوم الخدمة (٪)",
    fieldServiceFeeHint: "اتركها ٠ ليكون الإجمالي هو السعر المعروض فقط، بلا أي رسوم تظهر للضيف",
    fieldDepositDefault: "العربون الافتراضي (٪)",
    fieldDepositDefaultHint: "يُستخدم للاستراحات التي لم يحدّد مالكها نسبة خاصة",
    fieldCommission: "عمولة المنصة (٪)",
    fieldCommissionHint: "تُخصم من إيراد المالك ويحوّلها بنكياً — لا تُضاف على فاتورة الضيف",
    fieldReviewInviteDays: "صلاحية رابط التقييم (يوم)",
    fieldReviewInviteDaysHint: "المدة التي يبقى فيها رابط التقييم صالحاً بعد إنشائه",
    fieldFreeCancel: "الإلغاء المجاني (ساعة)",
    fieldCheckIn: "وقت الدخول",
    fieldCheckOut: "وقت الخروج",
    enableOnlineDeposit: "تفعيل دفع العربون إلكترونيًا",
    gatewayNotWired: "بوابة الدفع غير مربوطة بعد. الخطوات مكتوبة في",
    fieldHeroTitle: "عنوان الغلاف",
    fieldHeroTitleAlt: "السطر الثاني (بلون مميّز)",
    fieldHeroSubtitle: "نص الغلاف",
    heroImageNote: "صورة غلاف الصفحة الرئيسية. تُستخدم صورة أول استراحة مميّزة إن لم تُحدَّد.",
    uploadHeroImage: "رفع صورة الغلاف",
    fieldFooterAbout: "نص «عن الموقع» في الفوتر",
    fieldSeoTitle: "عنوان SEO",
    fieldSeoTitleHint: "يظهر في نتائج البحث",
    fieldSeoDescription: "وصف SEO",
    seoDescriptionHint: (n: string) => `الأفضل بين ١٢٠ و ١٦٠ حرفًا — حاليًا ${n}`,
    googleTagCard: "وسم جوجل والتتبّع",
    googleTagHint:
      "الصق المعرّفات كما تظهر في حساب جوجل — الموقع يبني الأكواد بنفسه ويضعها في مكانها الصحيح. اترك الحقول فارغة لإيقاف التتبّع تمامًا.",
    fieldGoogleTagId: "معرّف وسم جوجل",
    fieldGoogleTagIdHint:
      "مثل AW-950802645 لإعلانات جوجل، أو G-XXXXXXX لتحليلات جوجل ‎(GA4)‎. يقبل أيضًا ‎GT-‎ و‎DC-‎، ولا يقبل حاويات ‎GTM-‎. يعمل على صفحات الموقع العامة فقط — لوحة التحكم غير متتبّعة.",
    fieldConversionLabel: "تسمية التحويل (حجز مؤكَّد)",
    fieldConversionLabelHint:
      "النصف الذي بعد الشرطة المائلة في send_to، مثل dVoECJ30sOQcENWxsMUD. يُحتسب التحويل مرة واحدة عند ظهور صفحة تأكيد الحجز، بقيمة الحجز بالدرهم.",
    googleTagLiveOn: "التتبّع مفعّل",
    googleTagLiveOff: "التتبّع متوقّف",
    googleTagConversionOff: "الوسم يعمل، لكن لا يوجد تحويل مسجَّل",
    settingsTitle: "إعدادات الموقع",
    settingsSubtitle: "كل ما تعدّله هنا يظهر على الموقع فورًا — لا حاجة لتعديل الكود أو إعادة النشر.",
  },

  /* -------------------------------------------------------------- calendar */
  /**
   * ربط التقويم مع المنصات الخارجية.
   *
   * مجموعة مستقلة عن `admin` لأن اللوحتين تعرضان اللوحة نفسها — المشغّل من
   * /admin/calendar والمالك من صفحة استراحته — فوضعها تحت `admin` كان سيجعل
   * صفحة المالك تقرأ من قاموس ليس لها.
   */
  /* ------------------------------------------------------------- analytics */
  // The performance dashboard, shared by the owner and the operator. One group
  // rather than entries split across `owner` and `admin`, because both read the
  // very same panels and a duplicated label is a label that drifts.
  analytics: {
    title: "التحليلات",
    ownerSubtitle: "أداء استراحاتك ماليًا وتشغيليًا",
    adminSubtitle: "أرقام أي استراحة على المنصة",
    detailedLink: "تحليلات مفصّلة",
    backToDashboard: "رجوع للوحة التحكم",

    // ---- period filter ----
    period: "الفترة",
    period7d: "٧ أيام",
    period30d: "٣٠ يوم",
    period3m: "٣ أشهر",
    period6m: "٦ أشهر",
    period1y: "سنة",
    periodCustom: "فترة مخصصة",
    from: "من",
    to: "إلى",
    apply: "عرض",
    rangeLine: (from: string, to: string) => `${from} — ${to}`,
    comparedTo: (from: string, to: string) => `مقارنةً بالفترة ${from} — ${to}`,
    exportExcel: "تصدير Excel",
    allListings: "كل الاستراحات",
    pickListing: "الاستراحة",

    // ---- headline cards ----
    revenue: "إجمالي الإيرادات",
    revenueSub: "درهم — قيمة الحجوزات المؤكدة",
    netRevenue: "صافي الإيرادات",
    netRevenueSub: "درهم — بعد عمولة المنصة",
    bookings: "عدد الحجوزات",
    bookingsSub: "حجوزات مؤكدة في الفترة",
    occupancy: "معدل الإشغال",
    occupancySub: "من أيام الفترة",
    avgBookingValue: "متوسط قيمة الحجز",
    avgBookingValueSub: "درهم لكل حجز",
    avgDailyRate: "متوسط السعر اليومي",
    avgDailyRateSub: "درهم لكل يوم محجوز",
    daysSplit: "الأيام المحجوزة والمتاحة",
    daysSplitValue: (booked: string, available: string) => `${booked} / ${available}`,
    daysSplitSub: "محجوزة / متاحة",
    cancellation: "معدل الإلغاء",
    cancellationSub: "من المؤكدة والملغاة",
    /** Appended to a change figure so "+١٢" is never read as a total. */
    vsPrevious: "عن الفترة السابقة",
    /** The spreadsheet's second value column — the figure itself, not the change. */
    previousPeriod: "الفترة السابقة",
    pointsUnit: "نقطة",

    // ---- §3 revenue over time ----
    trendTitle: "تحليل الإيرادات",
    /** One line per bucket width, because "عبر الفترة" hides what a bar is. */
    trendSub: {
      day: "الإيراد في كل يوم من الفترة",
      week: "الإيراد في كل أسبوع من الفترة",
      month: "الإيراد في كل شهر من الفترة",
    },
    trendEmpty: "لا توجد إيرادات مسجّلة في هذه الفترة.",
    trendPoint: (label: string, revenue: string, bookings: string, occupancy: string) =>
      `${label}: ${revenue} د.إ · ${bookings} حجز · إشغال ${occupancy}`,
    legendRevenue: "الإيراد",
    legendBookings: "الحجوزات",
    legendOccupancy: "الإشغال",

    // ---- §4 occupancy ----
    occupancyTitle: "تحليل الإشغال",
    occupancyBreakdownSub: "كيف مرّت أيام الفترة",
    bookedDays: "الأيام المحجوزة",
    availableDays: "الأيام المتاحة",
    blockedDays: "الأيام المغلقة من المالك",
    capacityDays: "إجمالي الأيام القابلة للحجز",
    weekdayOccupancy: "إشغال أيام الأسبوع",
    weekendOccupancy: "إشغال نهاية الأسبوع",
    dayUnit: "يوم",

    // ---- §5 days of the week ----
    dowTitle: "تحليل أيام الأسبوع",
    dowSub: "الإشغال والإيراد لكل يوم من أيام الأسبوع",
    dowRow: (day: string, occupancy: string, revenue: string) =>
      `${day}: إشغال ${occupancy} · ${revenue} د.إ`,

    // ---- §6 with and without an overnight stay ----
    stayTypeTitle: "المبيت وبدون مبيت",
    stayTypeSub: "مقارنة بين نوعَي الحجز",
    overnight: "حجوزات بمبيت",
    dayUse: "حجوزات بدون مبيت",

    // ---- §7 sources ----
    sourcesTitle: "مصادر الحجوزات",
    sourcesSub: "من أين أُغلقت أيام التقويم",
    sourceRihla: "رحلة",
    sourceDirect: "حجز مباشر",
    sourceDaysCol: "الأيام",
    sourceBookingsCol: "الحجوزات",
    sourceRevenueCol: "الإيراد",
    revenueUnknown: "غير معروف",
    /** The imported half of a channel, shown beside the recorded half. */
    plusImported: (n: string) => `+${n} مستوردة`,
    /** The same figure as its own spreadsheet column, where "+٩" cannot be summed. */
    importedDaysCol: "أيام مستوردة",
    /** Said once, plainly, instead of inventing a number for the feeds. */
    sourcesNote:
      "الأرقام هنا من الحجوزات المسجّلة، سواء وصلت عبر المنصة أو سجّلتها بنفسك من واتساب أو Airbnb أو Booking.com. الأيام «المستوردة» هي أيام أغلقها تقويم خارجي دون حجز مسجّل، ولذلك لا يُعرف إيرادها — سجّل الحجز ليظهر مبلغه.",
    sourcesEmpty: "لا توجد حجوزات أو أيام محجوزة في هذه الفترة.",

    // ---- §8 pricing ----
    pricingTitle: "تحليل الأسعار",
    pricingSub: "الأسعار التي تحقّقت فعلًا، لا الأسعار المعروضة",
    weekdayRate: "متوسط سعر أيام الأسبوع",
    weekendRate: "متوسط سعر نهاية الأسبوع",
    actualRate: "متوسط سعر الحجز الفعلي",

    // ---- per rest house ----
    listingsTitle: "أداء الاستراحات",
    colListing: "الاستراحة",
    colBookings: "الحجوزات",
    colRevenue: "الإيراد",
    colOccupancy: "الإشغال",
    hiddenListing: "غير منشورة",

    // ---- §9 alerts ----
    alertsTitle: "مؤشرات وتنبيهات",
    alertBestDay: (day: string, pct: string) => `أعلى يوم طلبًا: ${day} — إشغال ${pct}`,
    alertWorstDay: (day: string, pct: string) => `أقل يوم طلبًا: ${day} — إشغال ${pct}`,
    alertRaisePrice: (pct: string) =>
      `فرصة لرفع السعر: إشغال نهاية الأسبوع ${pct} وسعرها لا يزال كسعر أيام الأسبوع.`,
    alertEmptyDays: (n: string) => `لديك ${n} يومًا متاحًا لم تُحجز خلال الفترة.`,
    // Says "if every one of them sold" out loud: this is a ceiling, not a
    // forecast, and reads as a projection unless the assumption is on screen.
    alertPotentialRevenue: (amount: string, n: string) =>
      `الإيراد المحتمل لو حُجزت كل الأيام المتاحة البالغة ${n} يومًا: نحو ${amount} د.إ بمتوسط سعرك الفعلي في هذه الفترة.`,
    alertNoData: "لا توجد بيانات كافية في هذه الفترة بعد.",

    // ---- states ----
    noListings: "لا توجد استراحات في هذا النطاق بعد.",
    truncatedNote: "الفترة كبيرة جدًا وعُرض جزء من البيانات فقط — اختر فترة أقصر لأرقام دقيقة.",
  },

  /* --------------------------------------------------------- record booking */
  // Recording a stay taken somewhere else — the owner's phone, Airbnb,
  // Booking.com. One group, because the operator and the owner fill in the
  // very same form.
  recordBooking: {
    open: "تسجيل حجز خارجي",
    title: "تسجيل حجز خارجي",
    intro:
      "سجّل حجزًا وصلك من خارج المنصة — عبر الواتساب أو الهاتف أو من موقع آخر — ليظهر في تقويمك وفي أرقام إيراداتك.",
    listing: "الاستراحة",
    source: "مصدر الحجز",
    sourceDirect: "حجز مباشر (واتساب أو هاتف)",
    guestName: "اسم الضيف",
    guestPhone: "رقم الضيف",
    dayUse: "حجز بدون مبيت (يوم واحد)",
    checkIn: "تاريخ الوصول",
    checkOut: "تاريخ المغادرة",
    theDay: "اليوم",
    guests: "عدد الضيوف",
    amount: "المبلغ المستلم",
    amountHint: "بالدرهم — المبلغ الذي وصلك فعلًا عن هذا الحجز، لا سعر القائمة",
    notes: "ملاحظات",
    notesPlaceholder: "اختياري",
    submit: "تسجيل الحجز",
    submitting: "جارٍ التسجيل…",
    // Both notices are on screen BEFORE submitting, not discovered afterwards
    // in the figures — see the header comment in actions/manual-booking.ts.
    commissionNote:
      "لا تُحتسب عمولة للمنصة على الحجوزات المسجّلة يدويًا — المبلغ كامل لك.",
    pastNote:
      "إذا كانت كل أيام الحجز قد مضت فلن يُعدَّل التقويم، ويُسجَّل الحجز للإيراد فقط. أما الحجوزات القادمة فتُغلق أيامها في تقويمك.",
    backToBookings: "رجوع للحجوزات",
    noListings: "أضف استراحة أولًا لتتمكن من تسجيل الحجوزات.",
  },

  calendar: {
    title: "ربط التقويم مع المنصات",
    introOwner:
      "إذا كانت استراحتك معروضة على Airbnb أو Booking.com، اربط تقويمها هنا حتى لا يُحجز اليوم مرتين.",
    introAdmin:
      "ربط تقويم هذه الاستراحة مع حساباتها على المنصات الأخرى، في الاتجاهين.",

    importTitle: "١ — استيراد الحجوزات من المنصات",
    importHint:
      "الصق رابط تصدير التقويم (iCal) من كل منصة. أي حجز هناك سيُغلق نفس الأيام هنا تلقائيًا.",
    platform: "المنصة",
    platformOther: "منصة أخرى",
    urlLabel: "رابط التقويم (iCal)",
    urlHint:
      "من Airbnb: التقويم ← الإتاحة ← مزامنة التقاويم. ومن Booking.com: الأسعار والإتاحة ← مزامنة التقاويم.",
    urlRequired: "الرجاء لصق رابط التقويم",
    labelLabel: "اسم هذا التقويم",
    labelPlaceholder: "مثال: Vrbo، أو تقويم جوجل",
    addFeed: "إضافة الرابط",
    removeFeed: "حذف الرابط",
    syncNow: "مزامنة الآن",
    syncing: "جارٍ المزامنة…",
    neverSynced: "لم تتم المزامنة بعد",
    daysImported: (n: string) => `${n} يوم مستورد`,
    lastOkAt: (when: string) => `آخر مزامنة ناجحة: ${when}`,

    feedRemoved: "حُذف الرابط وأُفرجت عن أيامه",
    addedAndSynced: (n: string) => `تمت الإضافة — استُوردت ${n} يومًا`,
    addedButFailed: (reason: string) =>
      `حُفظ الرابط لكن تعذّرت قراءته: ${reason}. سنعيد المحاولة تلقائيًا.`,
    syncedAll: (n: string) => `تمت المزامنة — ${n} يومًا محجوزًا خارجيًا`,
    syncedWithErrors: (n: string, failed: string) =>
      `تمت مزامنة جزئية — ${n} يومًا، وتعذّر ${failed} رابط`,
    noFeedsToSync: "لا توجد روابط تقويم لهذه الاستراحة",

    exportTitle: "٢ — تصدير حجوزاتك إلى المنصات",
    exportHint:
      "انسخ هذا الرابط والصقه في خانة استيراد التقويم لدى Airbnb و Booking.com، حتى يُغلق الحجز الذي يتم هنا نفس الأيام هناك.",
    exportEnable: "إنشاء رابط التصدير",
    exportDisable: "إيقاف الرابط",
    exportEnabled: "أُنشئ رابط التصدير",
    exportDisabled: "أُوقف رابط التصدير — لم يعد يعمل",
    exportPrivacy:
      "الرابط لا يحتوي على أي بيانات ضيوف — يذكر التواريخ غير المتاحة فقط. عامله كرابط سرّي.",
    exportBookingTip:
      "إن ألصقت هذا الرابط في Booking.com، اختر عندهم «الأيام المحجوزة فقط» بدل «المحجوزة والمغلقة»، حتى لا يعيد الموقعان إرسال نفس الحجز لبعضهما.",

    /* ---- وضع التقويم: حظر الأيام أو تسعير المناسبات ---- */
    modeLabel: "ماذا يفعل الضغط على اليوم",
    modeBlock: "حظر الأيام",
    modeSpecial: "أيام المناسبات",
    specialModeHint:
      "اضغط على أيام المناسبات والعطل الرسمية ليُطبَّق عليها سعر المناسبات بدل السعر العادي. اليوم المحجوز يمكن تعليمه أيضًا — السعر والإتاحة أمران منفصلان.",
    occasionName: "اسم المناسبة (اختياري)",
    occasionPlaceholder: "مثال: عيد الفطر، اليوم الوطني، رأس السنة",
    holidayRateActive: (price: string) => `سعر المناسبات لهذه الاستراحة: ${price} د.إ لليلة`,
    holidayRateMissing:
      "لم تُحدَّد قيمة «سعر المناسبات» لهذه الاستراحة بعد، فلن يتغيّر السعر. أضفها من إعدادات الاستراحة بعد سعر نهاية الأسبوع.",
    specialDay: "يوم مناسبة",
    specialDaysCount: (n: string) => `${n} يوم مناسبة`,
    markRestOfMonth: "تعليم بقية الشهر",
    unmarkRestOfMonth: "إلغاء تعليم الشهر",
    rangeMarkedSpecial: "عُلِّمت الأيام كمناسبات",
    rangeUnmarkedSpecial: "أُلغي تعليم الأيام",

    dayImported: "محجوز على منصة أخرى",
    externalPlatform: "منصة خارجية",
    dayHeldBy: (platform: string) => `محجوز على ${platform} — يُفرج عنه من هناك`,
    importedDaysCount: (n: string) => `${n} يومًا مستوردًا`,

    latencyWarning:
      "تنبيه: هذا الربط يعمل بتقنية iCal، وتحديث المنصات لملفاتها يستغرق عادة ساعتين إلى ثلاث. لذلك يبقى احتمال الحجز المزدوج قائمًا خلال هذه الفترة، وهو قيد في المنصات نفسها لا في الموقع.",

    /**
     * أسباب فشل جلب الرابط.
     *
     * الأسباب أكواد ثابتة تُترجم هنا، ولا تُخزَّن كنص جاهز: نص الخطأ الأصلي قد
     * يتضمّن الرابط نفسه، والرابط بمثابة كلمة سر لحساب المالك على المنصة الأخرى.
     * أي كود غير معروف يُعرض كرسالة عامة بدل أن يظهر فارغًا.
     */
    fetchError: (code: string) =>
      ({
        INVALID_URL: "الرابط غير صالح",
        NOT_HTTPS: "يجب أن يبدأ الرابط بـ https",
        PRIVATE_ADDRESS: "هذا الرابط يشير إلى عنوان داخلي غير مسموح",
        DNS: "تعذّر الوصول إلى الخادم",
        TIMEOUT: "انتهت مهلة الاتصال",
        TOO_MANY_REDIRECTS: "الرابط يعيد التوجيه كثيرًا",
        HTTP_ERROR: "رفضت المنصة الطلب — تأكد من صلاحية الرابط",
        TOO_LARGE: "حجم التقويم كبير جدًا",
        NOT_CALENDAR: "الرابط لا يعيد ملف تقويم صالحًا",
        NETWORK: "تعذّر الاتصال بالمنصة",
        // ليس خطأ في رابط المالك — تعذّر الحفظ، وستُعاد المحاولة تلقائيًا.
        WRITE_FAILED: "تعذّر حفظ التقويم — سنعيد المحاولة",
      })[code] ?? "تعذّرت قراءة التقويم",
  },

  /* ------------------------------------------------------------ validation */
  validation: {
    required: "هذا الحقل مطلوب",
    checkFields: "الرجاء التحقّق من الحقول المطلوبة",
    checkInput: "الرجاء التحقّق من البيانات المدخلة",

    /* --- the booking workflow ------------------------------------------- */
    // Shown when the step somebody pressed is no longer the current one —
    // almost always a second tab left open on an older version of the card.
    stageNotCurrent: "هذه الخطوة لم تعد الخطوة الحالية — حدّث الصفحة",
    bookingNotConfirmed: "لا يمكن متابعة الخطوات قبل تأكيد الحجز",
    amountInvalid: "المبلغ المدخل غير صالح",
    pastBookingLocked: "لا يمكن تأكيد حجز مضت تواريخه — تواصل مع الإدارة",
    deductionTooLarge: "قيمة الأضرار أكبر من مبلغ التأمين المستلم",
    commissionNotSent: "لم يسجّل المالك تحويل العمولة بعد",
    cannotRevertStage: "لا يمكن التراجع عن هذه الخطوة — ألغِ الحجز بدلاً من ذلك",

    /* --- guest reviews ---------------------------------------------------- */
    reviewLinkInvalid: "رابط التقييم غير صالح",
    reviewLinkExpired: "انتهت صلاحية رابط التقييم",
    reviewLinkUsed: "سبق استخدام رابط التقييم",
    reviewNotFound: "التقييم غير موجود",
    reviewTooShort: "اكتب رأيك في ١٠ أحرف على الأقل",
    ratingRequired: "اختر تقييماً من ١ إلى ٥",
    reviewSubmitted: "تم إرسال تقييمك — شكراً لك",
    reviewApproved: "تم نشر التقييم",
    reviewRejected: "تم رفض التقييم",
    nameTooShort: "الاسم قصير جدًا",
    fullNameRequired: "الرجاء إدخال الاسم الكامل",
    invalidEmail: "بريد إلكتروني غير صالح",
    emailTaken: "هذا البريد مسجّل مسبقًا",
    phoneTaken: "هذا الرقم مسجّل مسبقًا لحساب آخر",
    passwordTooShort: "كلمة المرور يجب أن تكون ٨ أحرف على الأقل",
    passwordMismatch: "كلمتا المرور غير متطابقتين",
    passwordUnchanged: "كلمة المرور الجديدة مطابقة للحالية",
    currentPasswordRequired: "أدخل كلمة المرور الحالية",
    currentPasswordWrong: "كلمة المرور الحالية غير صحيحة",
    phoneIncomplete: "رقم الجوال غير مكتمل",
    phoneInvalid: "رقم الجوال غير صحيح",
    whatsappInvalid: "رقم الواتساب غير صحيح — أدخله مع رمز الدولة",
    invalidCity: "اختر مدينة صحيحة",
    priceRequired: "السعر مطلوب",
    capacityRequired: "السعة مطلوبة",
    holidayBelowWeekday: "سعر المناسبات أقل من سعر الليلة العادية — تأكّد من الأرقام",
    holidayBelowWeekdayShort: "أقل من السعر العادي",
    weekendBelowWeekday: "سعر نهاية الأسبوع لا يمكن أن يكون أقل من سعر الليلة العادية",
    weekendBelowWeekdayShort: "أقل من السعر العادي",
    depositRange: "نسبة العربون يجب أن تكون بين ٠ و ١٠٠",
    freeCancelRange: "مهلة الإلغاء المجاني يجب أن تكون بين ٠ و ٧٢٠ ساعة",
    invalidSource: "اختر مصدر حجز صحيح",
    bookingRecorded: "تم تسجيل الحجز",
    invalidCheckIn: "تاريخ وصول غير صالح",
    invalidCheckOut: "تاريخ مغادرة غير صالح",
    checkOutBeforeCheckIn: "يجب أن يكون تاريخ المغادرة بعد تاريخ الوصول",
    pastDate: "لا يمكن الحجز في تاريخ ماضٍ",
    tooManyNights: "أقصى مدة للحجز ٦٠ ليلة — راسلنا للحجوزات الأطول",
    guestsInvalid: "عدد الضيوف غير صالح",
    overCapacity: (n: string) => `تتسع هذه الاستراحة لـ ${n} ضيفًا كحد أقصى`,
    overCapacityShort: "أكبر من السعة المتاحة",
    datesTaken: "لم تبقَ هذه التواريخ متاحة — الرجاء اختيار تواريخ أخرى من التقويم",
    listingUnavailable: "الاستراحة غير متوفرة",
    listingNotFound: "الاستراحة غير موجودة",
    requestNotFound: "الطلب غير موجود",
    ownerNotFound: "المالك غير موجود",
    invalidStatus: "حالة غير صالحة",
    invalidDate: "تاريخ غير صالح",
    saveFailed: "تعذّر الحفظ — حاول مرة أخرى",
    deleteFailed: "تعذّر الحذف — حاول مرة أخرى",
    unauthorized: "لا تملك صلاحية تنفيذ هذا الإجراء",
    ownerNotApproved: "لا يمكنك تنفيذ هذا الإجراء قبل الموافقة على حسابك",
    ownerInactive: "حسابك غير نشط أو انتهت عضويتك",
    dateNotEditable: "لا يمكن تعديل تاريخ ماضٍ",
    dayHeldByBooking: "هذا اليوم محجوز بطلب مؤكد — ألغِ الطلب من صفحة الطلبات لتحريره",
    invalidPlatform: "منصة غير معروفة",
    feedAlreadyAdded: "هذا الرابط مضاف مسبقًا لهذه الاستراحة",
    feedNotFound: "رابط التقويم غير موجود",
    tooManyFeeds: "بلغت الحد الأقصى لروابط التقويم لهذه الاستراحة",
    invalidRange: "نطاق تواريخ غير صالح",
    noEditableDays: "لا توجد أيام قابلة للتعديل في هذا النطاق",
    rangeTooLong: "النطاق طويل جدًا — أقصى حد ٤٠٠ يوم",
    dateConflict: (date: string) => `تعارض في التواريخ — اليوم ${date} محجوز أو محظور مسبقًا`,
    settingsSaved: "تم حفظ الإعدادات",
    settingsSaveFailed: "تعذّر حفظ الإعدادات — حاول مرة أخرى",
    logoUpdated: "تم تحديث الشعار",
    logoUploadFailed: "تعذّر رفع الشعار",
    logoRemoved: "تمت إزالة الشعار — سيظهر الحرف بدلًا منه",
    heroUpdated: "تم تحديث صورة الغلاف",
    heroUploadFailed: "تعذّر رفع الصورة",
    invalidColor: "لون غير صالح — استخدم صيغة #RRGGBB",
    siteNameRequired: "اسم الموقع مطلوب",
    whatsappIncomplete: "رقم واتساب غير مكتمل",
    invalidUrl: "رابط غير صالح",
    invalidGoogleTagId:
      "معرّف وسم غير صالح — يبدأ بـ ‎AW-‎ أو ‎G-‎ أو ‎GT-‎ أو ‎DC-‎، مثل AW-950802645. حاويات Google Tag Manager (‎GTM-‎) غير مدعومة هنا.",
    invalidConversionLabel:
      "تسمية تحويل غير صالحة — انسخ القيمة التي بعد الشرطة المائلة في send_to",
    invalidCoordinates: "الإحداثيات غير صحيحة — اكتبها بالصيغة: 24.7614, 55.3340",
    invalidFormat: "صيغة غير صحيحة",
    checkTheFields: "الرجاء التحقّق من الحقول",
    uploadNoFile: "لم يتم إرسال ملف صالح",
    uploadEmpty: "الملف فارغ",
    uploadTooLarge: "حجم الصورة أكبر من ٢٠٠ ميغابايت",
    uploadBadFormat: "صيغة غير مدعومة — استخدم JPG أو PNG أو WebP",
    dayUseSingleDay: "الحجز بدون مبيت ليوم واحد فقط",
    dayUseUnavailable: "هذه الاستراحة لا توفّر الحجز بدون مبيت حاليًا",
    duplicateRequest:
      "لديك طلب قيد المراجعة لنفس الاستراحة وبنفس التواريخ — راجع رسالة الواتساب أو انتظر رد المالك",
  },

  /* -------------------------------------------------------------- security */
  security: {
    // The widget above the submit button.
    verifying: "جارٍ التحقق من أنك لست روبوتًا…",
    verified: "تم التحقق — يمكنك الإرسال",
    protectedNote: "هذا النموذج محمي من الإرسال الآلي",
    retry: "إعادة المحاولة",
    checkFailedShort: "تعذّر التحقق",

    // Messages returned by the server when a submission is refused.
    checkFailed: "تعذّر التحقق من الطلب — حدّث الصفحة وحاول مرة أخرى",
    checkUnavailable: "خدمة التحقق غير متاحة حاليًا — حاول بعد قليل",
    challengeExpired: "انتهت صلاحية التحقق — اضغط الإرسال مرة أخرى",
    tooManyAttempts: "عدد كبير من المحاولات خلال وقت قصير — انتظر قليلًا ثم حاول مرة أخرى",
    waitForCheck: "انتظر اكتمال التحقق الأمني قبل الإرسال",
  },

  /* --------------------------------------------------------------- statuses */
  status: {
    // booking
    NEW: "جديد",
    CONFIRMED: "مؤكد",
    // Derived, never stored: مؤكد + كل خطوات المسار مكتملة.
    COMPLETED: "مكتمل",
    REJECTED: "مرفوض",
    CANCELLED: "ملغى",
    // owner
    PENDING: "قيد المراجعة",
    APPROVED: "معتمد",
    SUSPENDED: "موقوف",
    EXPIRED: "منتهية العضوية",
    ACTIVE: "نشط",
    // payment
    NONE: "لا يوجد",
    PAYMENT_PENDING: "بانتظار الدفع",
    PAID: "مدفوع",
    REFUNDED: "مُسترجع",
  },

  /* -------------------------------------------------------------- workflow */
  /**
   * The seven steps of settling one booking, as the owner reads them.
   *
   * Written as instructions rather than labels — "أدخل المبلغ المستلم ثم أكّد"
   * rather than "العربون" — because this panel is the platform teaching an
   * owner how to run a booking properly, which is the whole reason it replaced
   * a single confirm button.
   */
  workflow: {
    title: "مسار الحجز",
    stepOf: (n: string, total: string) => `الخطوة ${n} من ${total}`,
    stepSaved: "تم حفظ الخطوة",
    stepReverted: "تم التراجع عن الخطوة",
    completed: "اكتملت جميع خطوات هذا الحجز",
    expand: "عرض خطوات الحجز",
    collapse: "إخفاء خطوات الحجز",
    nextStep: (title: string) => `التالي: ${title}`,
    undo: "تراجع خطوة",
    received: "المستلم",
    expected: "حسب الإعدادات",

    depositTitle: "استلام العربون والتأمين",
    depositBody:
      "أدخل المبلغ المستلم فعلياً ثم أكّد الحجز — عندها تُحجز الأيام في التقويم ولا يستطيع ضيف آخر أخذها.",
    depositHint:
      "المبالغ معبّأة حسب الإعدادات — عدّلها إن اتفقت مع الضيف على مبلغ آخر عبر الواتساب.",
    depositAmount: "العربون المستلم",
    securityAmount: "التأمين المستلم",
    depositAction: "تأكيد الحجز وحجز الأيام",

    balanceTitle: "استلام باقي مبلغ الحجز",
    balanceBody: (date: string) =>
      `بانتظار يوم الدخول (${date}) وتحويل باقي قيمة الحجز كاملة.`,
    balanceAmount: "المبلغ المستلم",
    balanceAction: "تأكيد استلام المبلغ",
    outstanding: "المتبقي على الضيف",

    checkoutTitle: "خروج الضيف",
    checkoutBody: "بانتظار انتهاء الإقامة وخروج الضيف من الاستراحة.",
    checkoutAction: "تأكيد خروج الضيف",

    inspectionTitle: "تفتيش الاستراحة",
    inspectionBody:
      "تأكد من سلامة الأغراض والمعدات وعدم وجود تكسير أو مخالفة لسياسة الاستراحة قبل إرجاع التأمين.",
    inspectionNotes: "ملاحظات التفتيش (اختياري)",
    inspectionAction: "تم التفتيش والاستراحة سليمة",

    securityTitle: "إرجاع التأمين للضيف",
    securityBody: (amount: string) =>
      `التأمين المستلم ${amount}. أدخل قيمة الأضرار إن وُجدت، ويُحسب المبلغ المُعاد تلقائياً.`,
    damageAmount: "قيمة الأضرار المخصومة",
    toReturn: "المبلغ المُعاد للضيف",
    securityAction: "تم إرجاع التأمين",

    commissionTitle: "تحويل عمولة المنصة",
    commissionBody: (percent: string, amount: string) =>
      `عمولة المنصة ${percent} من قيمة الحجز = ${amount}. حوّلها بنكياً ثم أكّد التحويل.`,
    commissionRef: "رقم الحوالة (اختياري)",
    bankTransferTo: "حوّل على الحساب التالي",
    bankDetailsMissing: "لم تُضَف بيانات الحساب البنكي بعد — تواصل مع الإدارة قبل التحويل.",
    commissionAction: "تم تحويل العمولة",
    commissionAwaitingAdmin: "بانتظار تأكيد الإدارة لاستلام الحوالة",
    commissionConfirmAction: "تأكيد استلام العمولة",
    commissionConfirmed: "تم تأكيد استلام العمولة",
    commissionSentOn: (date: string) => `أرسلها المالك في ${date}`,

    reviewTitle: "دعوة الضيف للتقييم",
    reviewBody: (days: string) =>
      `أنشئ رابطاً مؤقتاً صالحاً ${days} يوماً ليضيف الضيف تقييمه — ويصل التقييم للإدارة للموافقة عليه قبل نشره.`,
    reviewAction: "إنشاء رابط التقييم",
    reviewLinkReady: "رابط التقييم جاهز — أرسله للضيف",
    copyLink: "نسخ الرابط",
    linkCopied: "تم نسخ الرابط",
    sendOnWhatsapp: "إرسال عبر الواتساب",
    reviewPending: "التقييم بانتظار موافقة الإدارة",
    reviewPublished: "تم نشر تقييم الضيف",
    reviewRefused: "رُفض تقييم الضيف",
    reviewNotSubmitted: "لم يضف الضيف تقييمه بعد",
    inviteExpires: (date: string) => `ينتهي الرابط في ${date}`,
  },

  /* ------------------------------------------------------------ guest review */
  review: {
    title: "قيّم إقامتك",
    subtitle: (listing: string) => `شاركنا رأيك في ${listing}`,
    stayLabel: "فترة الإقامة",
    nameLabel: "اسمك كما يظهر مع التقييم",
    ratingLabel: "تقييمك",
    bodyLabel: "رأيك في الاستراحة",
    bodyPlaceholder: "كيف كانت النظافة والخدمة والموقع؟",
    submit: "إرسال التقييم",
    moderationNote: "يُراجع التقييم من الإدارة قبل نشره على صفحة الاستراحة.",
    thanksTitle: "شكراً لك",
    thanksBody: "وصلنا تقييمك وسيظهر على صفحة الاستراحة بعد مراجعته.",
    invalidTitle: "رابط غير صالح",
    invalidBody: "هذا الرابط غير صحيح أو لم يعد موجوداً.",
    expiredTitle: "انتهت صلاحية الرابط",
    expiredBody: "مدة إضافة التقييم انتهت. تواصل مع المالك إن أردت إضافة رأيك.",
    usedTitle: "تم استخدام الرابط",
    usedBody: "سبق أن أُضيف تقييم من خلال هذا الرابط.",
    backHome: "العودة للرئيسية",
  },

  /* ----------------------------------------------------------------- audit */
  audit: {
    BOOKING_STAGE_ADVANCED: "إكمال خطوة في حجز",
    BOOKING_STAGE_REVERTED: "تراجع عن خطوة في حجز",
    BOOKING_COMMISSION_CONFIRMED: "تأكيد استلام عمولة",
    BOOKING_RECORDED: "تسجيل حجز خارجي",
    REVIEW_INVITED: "إنشاء رابط تقييم",
    REVIEW_APPROVED: "الموافقة على تقييم",
    REVIEW_REJECTED: "رفض تقييم",
    CALENDAR_FEED_ADDED: "ربط تقويم خارجي",
    CALENDAR_FEED_REMOVED: "حذف تقويم خارجي",
    CALENDAR_EXPORT_ENABLED: "تفعيل رابط تصدير التقويم",
    CALENDAR_EXPORT_DISABLED: "إيقاف رابط تصدير التقويم",
    OWNER_APPROVED: "الموافقة على مالك",
    OWNER_REJECTED: "رفض طلب مالك",
    OWNER_SUSPENDED: "إيقاف مالك",
    OWNER_ACTIVATED: "تفعيل مالك",
    OWNER_UPDATED: "تعديل بيانات مالك",
    OWNER_PASSWORD_RESET: "تغيير كلمة مرور مالك",
    ADMIN_ACCOUNT_UPDATED: "تعديل بيانات حساب الإدارة",
    ADMIN_PASSWORD_CHANGED: "تغيير كلمة مرور الإدارة",
    OWNER_REGISTERED: "تسجيل مالك جديد",
    MEMBERSHIP_UPDATED: "تعديل انتهاء العضوية",
    LISTING_VISIBILITY_CHANGED: "تغيير ظهور استراحة",
    LISTING_CREATED: "إنشاء استراحة",
    LISTING_UPDATED: "تعديل استراحة",
    LISTING_DELETED: "حذف استراحة",
  },

  /* ---------------------------------------------------------------- footer */
  footer: {
    explore: "استكشف",
    help: "المساعدة",
    contact: "تواصل معنا",
    allListings: "كل الاستراحات",
    poolListings: "استراحات بمسبح",
    weddingVenues: "قاعات أعراس",
    winterCamps: "مخيمات شتوية",
    rights: (year: string, site: string) => `© ${year} ${site} — جميع الحقوق محفوظة`,
    tradeLicense: "رقم الرخصة التجارية:",
    listYourPropertyCta: "تملك استراحة؟ اعرضها معنا",
  },

  /* -------------------------------------------------------------- whatsapp */
  whatsapp: {
    greeting: "السلام عليكم 👋",
    bookingIntro: (listing: string) => `أرغب بحجز *${listing}*`,
    reference: (ref: string) => `📋 رقم الطلب: ${ref}`,
    checkIn: (date: string) => `📅 الوصول: ${date}`,
    checkOut: (date: string) => `📅 المغادرة: ${date}`,
    nights: (n: string) => `🌙 عدد الليالي: ${n}`,
    dayUseDate: (date: string) => `📅 تاريخ الحجز: ${date}`,
    dayUseNoOvernight: "☀️ حجز بدون مبيت — نفس اليوم",
    dayUseLeaveBy: (time: string) => `🕘 المغادرة قبل: ${time}`,
    guests: (n: string) => `👥 عدد الضيوف: ${n}`,
    total: (amount: string) => `💰 الإجمالي التقديري: ${amount} د.إ`,
    deposit: (pct: string, amount: string) => `💵 العربون (${pct}٪): ${amount} د.إ`,
    securityDeposit: (amount: string) => `🛡️ التأمين (مسترد): ${amount} د.إ`,
    name: (name: string) => `👤 الاسم: ${name}`,
    phone: (phone: string) => `📱 الجوال: ${phone}`,
    notes: (notes: string) => `📝 ملاحظات: ${notes}`,
    sentVia: (site: string) => `أرسلت عبر ${site}`,
    enquiryIntro: "أبحث عن استراحة مناسبة.",
    enquiryDate: "التاريخ المطلوب:",
    enquiryGuests: "عدد الضيوف:",
    enquiryBudget: "الميزانية التقريبية:",
    enquiryFrom: (site: string) => `(من موقع ${site})`,
    ownerReplyGreeting: (name: string) => `أهلًا ${name} 👋`,
    ownerReplyIntro: (ref: string, listing: string) =>
      `بخصوص طلبك رقم ${ref} على *${listing}*:`,
  },

  /* ------------------------------------------------------- content pages */
  pages: {
    // ---- about
    aboutTitle: "من نحن",
    aboutStatListings: "استراحة منشورة",
    aboutStatBookings: "حجز مؤكد",
    aboutStatEmirates: "إمارات مغطّاة",
    aboutWhyTitle: "لماذا بدأنا",
    aboutWhyBody: (site: string) =>
      `حجز استراحة في الإمارات كان يعني عشرات المكالمات، صورًا قديمة لا تشبه المكان، وأسعارًا تتغيّر عند الوصول. أنشأنا ${site} لتحلّ هذه المشكلة: كل استراحة معروضة هنا زارها فريقنا، وصوّرها كما هي، ونشر سعرها وسياستها بوضوح قبل أن تسأل.`,
    aboutVerifyTitle: "كيف نتحقّق",
    aboutVerifyBody:
      "قبل نشر أي استراحة نزورها ميدانيًا، نتحقّق من المساحة والسعة الفعلية، ونصوّر المرافق المذكورة واحدًا واحدًا. الاستراحة التي تحمل شارة «موثّقة» مرّت بهذه الخطوة. أي فرق بين الوصف والواقع يُبلَّغ عنه ونتدخّل فيه مباشرة.",
    aboutEarnTitle: "كيف نكسب",
    aboutEarnBody: (pct: string) =>
      `لا نطلب أي دفع عبر الموقع. ترسل طلبك، فيصل المالك مباشرة على الواتساب بكل التفاصيل جاهزة، ويتم الاتفاق والدفع بينكما. نحصل على رسوم خدمة بنسبة ${pct}٪ مضمّنة في السعر المعروض — لا رسوم مخفية تُضاف لاحقًا.`,
    // Used when the platform charges no service fee, which is the default.
    // Written as its own sentence rather than the same one with "٠٪" in it:
    // "رسوم خدمة بنسبة ٠٪" reads as a bug, and the honest version of this
    // paragraph is a different claim, not the same claim with a zero in it.
    aboutEarnBodyNoFee:
      "لا نطلب أي دفع عبر الموقع. ترسل طلبك، فيصل المالك مباشرة على الواتساب بكل التفاصيل جاهزة، ويتم الاتفاق والدفع بينكما. ولا نضيف أي رسوم خدمة على السعر — ما تراه في صفحة الاستراحة هو ما تتفق عليه مع المالك.",
    aboutContactWhatsapp: "راسلنا على الواتساب",

    // ---- faq
    faqTitle: "الأسئلة الشائعة",
    faqSubtitle: "إن لم تجد جوابك هنا، راسلنا على الواتساب ونجيبك مباشرة.",
    faqDescription:
      "أجوبة عن الدفع، الإلغاء، العربون، السعة، التوفّر، والوصول إلى الاستراحات الصحراوية في الإمارات.",
    faqAskWhatsapp: "اسألنا على الواتساب",
    faqQ1: "هل أدفع عبر الموقع؟",
    faqA1:
      "لا. الموقع يسجّل طلبك ويوصله للمالك على الواتساب، والدفع يتم بينكما مباشرة. لا نطلب بطاقة ولا تحويلًا إلكترونيًا في أي مرحلة.",
    faqQ2: "كم العربون ومتى يُدفع؟",
    faqA2: (pct: string) =>
      `العربون يحدّده مالك كل استراحة ويظهر في صفحتها (${pct}٪ افتراضيًا)، ويُستحق بعد أن يؤكّد المالك التوفّر — لا قبل ذلك. الطريقة يحدّدها المالك عند التواصل.`,
    faqQ3: "هل يمكنني الإلغاء؟",
    faqA3: (hours: string) =>
      `الإلغاء مجاني حتى ${hours} ساعة قبل موعد الوصول. بعد هذه المدة تُطبَّق سياسة المالك المذكورة في صفحة الاستراحة.`,
    faqQ4: "الأسعار المعروضة نهائية؟",
    faqA4: (pct: string) =>
      `الإجمالي المعروض في صفحة الاستراحة يشمل سعر الليالي ورسوم الخدمة (${pct}٪). لا رسوم إضافية تُضاف بعد ذلك. سعر الجمعة والسبت قد يختلف ويظهر في التقويم.`,
    faqA4NoFee:
      "نعم. الإجمالي المعروض في صفحة الاستراحة هو سعر الليالي كما حدّده المالك — بلا رسوم خدمة ولا إضافات بعد ذلك. سعر الجمعة والسبت قد يختلف ويظهر في التقويم. وإذا طلب المالك مبلغ تأمين مسترد فسيظهر في صفحة الاستراحة قبل الإرسال.",
    faqQ5: "هل التقويم دقيق؟",
    faqA5:
      "نعم — الأيام المحجوزة أو المحظورة من المالك تظهر مشطوبة ولا يمكن اختيارها، ونتحقّق من التوفّر مرة أخرى في اللحظة التي ترسل فيها الطلب.",
    faqQ6: "ماذا لو تجاوز عدد ضيوفي السعة؟",
    faqA6:
      "لا يقبل النظام طلبًا يتجاوز السعة المعلنة. إن كنت قريبًا من الحد الأقصى راسلنا على الواتساب ونبحث لك عن استراحة أوسع.",
    faqQ7: "متى أستلم الموقع الدقيق؟",
    faqA7:
      "الخريطة في صفحة الاستراحة تُظهر المنطقة العامة. الموقع الدقيق ورمز البوابة يرسلهما المالك بعد تأكيد الحجز.",
    faqQ8: "أملك استراحة — كيف أضيفها؟",
    faqA8:
      "سجّل عبر صفحة «سجّل استراحتك». بعد مراجعة فريقنا والموافقة على حسابك، ستحصل على لوحة تحكم تدير منها الأسعار والتقويم والطلبات من جوّالك.",

    // ---- how it works
    howTitle: "كيف أحجز؟",
    howSubtitle: "أربع خطوات من البحث حتى التأكيد — بلا تسجيل حساب وبلا دفع إلكتروني.",
    howDescription:
      "أربع خطوات لحجز استراحة: ابحث، اختر التواريخ من التقويم، أرسل الطلب، ثم أكّد مع المالك على الواتساب.",
    howJsonLdName: "كيف أحجز استراحة",
    howStep1Title: "ابحث وفلتِر",
    howStep1Body:
      "حدّد الوجهة والتواريخ وعدد الضيوف، ثم ضيّق النتائج بالسعر والسعة والمرافق حتى تجد ما يناسبك.",
    howStep2Title: "اختر التواريخ من التقويم",
    howStep2Body:
      "الأيام المحجوزة تظهر مشطوبة ولا يمكن اختيارها. اختر الوصول ثم المغادرة، وسيُحسب الإجمالي فورًا.",
    howStep3Title: "أرسل الطلب",
    howStep3Body:
      "املأ اسمك ورقم جوالك وأي ملاحظات. يُسجَّل الطلب ويُعطى رقمًا، ثم يفتح لك الواتساب برسالة جاهزة تحتوي كل التفاصيل.",
    howStep4Title: "أكّد مع المالك",
    howStep4Body:
      "يتواصل معك المالك لتأكيد التوفّر والعربون المذكور في صفحة الاستراحة. لا يُخصم أي مبلغ عبر الموقع — الدفع يكون مباشرة معه.",
    howCancelTitle: "الإلغاء",
    howCancelBody: (hours: string) =>
      `الإلغاء مجاني حتى ${hours} ساعة قبل موعد الوصول. بعد ذلك يخضع العربون لسياسة المالك المذكورة في صفحة الاستراحة.`,
    howStartSearch: "ابدأ البحث",

    // ---- policies
    // ---- policies (long-form terms)
    polS1H: "١. طبيعة الخدمة",
    polS1B: (site: string) =>
      `${site} منصّة وسيطة تعرض استراحات وشاليهات مملوكة لأطراف مستقلّين. عقد الإقامة يقوم بينك وبين مالك الاستراحة. دورنا هو التحقّق من العروض، عرض التوفّر والسعر بدقّة، وتوصيل طلبك للمالك.`,
    polS2H: "٢. الطلب والتأكيد",
    polS2Lead: "إرسال الطلب من الموقع",
    polS2Strong: "ليس حجزًا مؤكدًا",
    polS2Tail:
      ". يصبح الحجز مؤكدًا فقط بعد أن يوافق المالك عليه ويُغلق التقويم على تواريخك. حتى تلك اللحظة قد تُحجز التواريخ لضيف آخر.",
    polS3H: "٣. الأسعار",
    polS3L1: (pct: string) => `الأسعار بالدرهم الإماراتي وتشمل رسوم خدمة بنسبة ${pct}٪.`,
    polS3L1NoFee: "الأسعار بالدرهم الإماراتي ولا تُضاف عليها أي رسوم خدمة.",
    polS3L2: "سعر الجمعة والسبت قد يكون أعلى، ويظهر بوضوح في التقويم قبل الإرسال.",
    polS3L3: "لا توجد رسوم إضافية تُضاف بعد عرض الإجمالي.",
    polS4H: "٤. العربون",
    polS4B: (pct: string) =>
      `يحدّد كل مالك نسبة العربون لاستراحته، وتظهر في صفحتها قبل إرسال الطلب (النسبة الافتراضية للمنصّة ${pct}٪). يُستحق العربون بعد تأكيد المالك، لا عند إرسال الطلب. لا يُحصَّل أي مبلغ عبر الموقع؛ طريقة الدفع يحدّدها المالك عند التواصل.`,
    polS5H: "٥. الإلغاء",
    polS5L1a: "الإلغاء مجاني حتى",
    polS5L1b: (hours: string) => `${hours} ساعة`,
    polS5L1c: "قبل موعد الوصول، ويُرد العربون كاملًا.",
    polS5L2: "الإلغاء بعد هذه المدة يخضع لسياسة المالك المذكورة في صفحة الاستراحة.",
    polS5L3: "عدم الحضور دون إشعار يُعامل كإلغاء متأخر.",
    polS5L4: "إذا ألغى المالك حجزًا مؤكدًا، يُرد العربون كاملًا ونساعدك في إيجاد بديل.",
    polS6H: "٦. مواعيد الدخول والخروج",
    polS6B: (inT: string, outT: string) =>
      `الدخول من ${inT} والخروج حتى ${outT}، ما لم يُتفق على غير ذلك مع المالك.`,
    polS7H: "٧. قواعد الاستخدام",
    polS7L1: "عدد الضيوف لا يتجاوز السعة المعلنة.",
    polS7L2: "احترام هدوء المنطقة وأوقات الراحة.",
    polS7L3: "الأضرار التي تلحق بالممتلكات مسؤولية الضيف.",
    polS7L4: "يُمنع أي استخدام مخالف لقوانين دولة الإمارات العربية المتحدة.",
    polS8H: "٨. الشكاوى",
    polS8Lead: "إن اختلف الواقع عمّا هو معروض، راسلنا على الواتساب",
    polS8Tail: "مع رقم طلبك خلال ٢٤ ساعة من الوصول ونتدخّل مباشرة.",
    policiesTitle: "الشروط وسياسة الحجز",
    policiesSubtitle: "ما تلتزم به المنصّة وما يلتزم به المالك والضيف — بلا لبس.",
    policiesDescription:
      "سياسة الحجز والإلغاء والعربون ورسوم الخدمة على منصّة حجز الاستراحات.",

    // ---- privacy
    privCollectH: "ما نجمعه",
    privCollectLead: "عند إرسال طلب حجز نحفظ فقط:",
    privCollectL1: "الاسم ورقم الجوال (والبريد الإلكتروني إن أدخلته).",
    privCollectL2: "تواريخ الإقامة وعدد الضيوف والاستراحة المطلوبة.",
    privCollectL3: "الملاحظات التي تكتبها بنفسك.",
    privNoCards: "لا نطلب بيانات بطاقات بنكية ولا نخزّنها، لأن الدفع لا يمرّ عبر الموقع إطلاقًا.",
    privWhyH: "لماذا نجمعها",
    privWhyB:
      "لغرض واحد: توصيل طلبك إلى مالك الاستراحة وتمكينه من الرد عليك. تُشارك بياناتك مع مالك الاستراحة المعنيّة فقط، ولا تُشارك مع أي طرف آخر ولا تُباع لأي جهة.",
    privOwnerH: "حسابات المُلّاك",
    privOwnerB:
      "إذا سجّلت كمالك استراحة، نحفظ بيانات حسابك ونشاطك (الاسم، البريد، الهاتف، الواتساب، ورقم الهوية إن أدخلته) لمراجعة طلبك وإدارة عضويتك. رقم الواتساب وحده هو ما يظهر لعملائك؛ بقية البيانات تبقى للإدارة فقط.",
    privFavH: "المفضلة",
    privFavLead: "قائمة المفضلة تُحفظ في ذاكرة متصفّحك (",
    privFavTail: ") على جهازك، ولا تُرسل إلى الخادم. حذف بيانات المتصفّح يمحوها.",
    privMapsH: "الخرائط والصور",
    privMapsLead: "نستخدم خرائط",
    privMapsTail:
      "لعرض مواقع الاستراحات في صفحاتها. تحميل الخريطة يعني أن مزوّدها يرى عنوان IP الخاص بك، وفق سياسة الخصوصية الخاصة به.",
    privRetainH: "مدة الحفظ",
    privRetainB:
      "نحفظ طلبات الحجز ما دامت لازمة لإدارة الحجز والرجوع إليه عند أي خلاف. يمكنك طلب حذف طلبك في أي وقت.",
    privRightsH: "حقوقك",
    privRightsLead: "لك أن تطلب الوصول إلى بياناتك أو تصحيحها أو حذفها. راسلنا على",
    privRightsTail: "مع رقم الطلب.",
    privacyTitle: "سياسة الخصوصية",
    privacySubtitle: "ما نجمعه، ولماذا، ومع من نشاركه.",
    privacyDescription: "البيانات التي نجمعها عند إرسال طلب حجز، وكيف تُستخدم وتُحفظ.",
  },

  /* ------------------------------------------------------------- not found */
  notFound: {
    title: "الصفحة غير موجودة",
    body: "الرابط الذي وصلت منه قد يكون قديمًا، أو أن الاستراحة أُزيلت من الموقع.",
    home: "العودة للرئيسية",
    browse: "تصفّح الاستراحات",
  },

  error: {
    title: "تعذّر عرض هذه الصفحة",
    body: "حدث خلل مؤقت أثناء التحميل. أعد المحاولة — وإن تكرّر الأمر فتصفّح بقية الاستراحات وسنعالجه.",
    retry: "إعادة المحاولة",
    updating: "جارٍ تحديث الصفحة…",
    reference: "رمز الخطأ",
    // The dashboard needs its own wording: the guest text above sends the reader
    // off to browse the catalogue, which is no help at all to an owner who was
    // halfway through editing their own rest house.
    dashboardBody:
      "لم يكتمل هذا الطلب. أعد المحاولة — ولم يُحفظ شيء ناقص. إن تكرّر الأمر أرسل لنا رمز الخطأ أدناه.",
  },
};
// NOTE: deliberately **not** `as const`. Narrowing every value to its own
// string-literal type would make `Dictionary` demand the *Arabic text itself*
// from en.ts — "AED" is not assignable to the literal type "د.إ" — which is the
// exact opposite of what this type is for. Left wide, each value is `string`
// (and each interpolation a `(…: string) => string`), so English satisfies the
// shape while key parity is still enforced.

/**
 * The shape every other dictionary must satisfy.
 *
 * `typeof ar` rather than a hand-written interface: the Arabic file is the
 * source of truth, so its structure *is* the contract. Adding a key here
 * immediately makes `en.ts` a type error until it's translated too.
 */
export type Dictionary = typeof ar;
