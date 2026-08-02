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
    serviceFee: (pct: string) => `رسوم الخدمة (${pct}٪)`,
    total: "الإجمالي",
    depositLine: (pct: string, amount: string) =>
      `العربون ${pct}٪ (${amount} د.إ) عند تأكيد المالك`,
    noDepositLine: "لا يُطلب عربون لهذه الاستراحة",
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
    amenitiesTitle: "المرافق والخدمات",
    descriptionTitle: "عن الاستراحة",
    locationTitle: "الموقع",
    reviewsTitle: "تقييمات الضيوف",
    noReviews: "استراحة جديدة — لا تقييمات بعد",
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
    locationNote: (where: string) =>
      `${where} — يُرسل الموقع الدقيق على الخريطة بعد تأكيد الحجز.`,
    ratingOutOf: (rating: string, count: string) => `${rating} من ${count} تقييم`,
    beFirstToReview: "كن أول من يقيّم هذه الاستراحة",
    beFirstToReviewBody:
      "أُضيفت حديثًا إلى المنصة ولم تستقبل تقييمات بعد. شاركنا تجربتك بعد إقامتك.",
    tooManyImages: (n: string) => `الحد الأقصى ${n} صورة لكل استراحة`,
    prevMonth: "الشهر السابق",
    nextMonth: "الشهر التالي",
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
    introBody:
      "املأ البيانات التالية وسيصل طلبك مباشرة إلى مالك الاستراحة على الواتساب. لا يُخصم أي مبلغ في هذه المرحلة.",
    keepReference: "احتفظ برقم الطلب للمراجعة:",
    depositPayOnline: (amount: string) =>
      `يمكنك دفع العربون (${amount} د.إ) إلكترونيًا بعد تأكيد المالك.`,
    depositCollectedByOwner: (amount: string) =>
      `العربون المتوقع ${amount} د.إ ويُحصَّل مباشرة من المالك بعد تأكيد التوفّر — لا يوجد دفع إلكتروني على الموقع حاليًا.`,
    bookingNotFound: "الطلب غير موجود",
  },

  /* ------------------------------------------------------------------ auth */
  auth: {
    loginTitle: "تسجيل الدخول",
    loginSubtitle: "لوحة تحكم المُلّاك وإدارة المنصة",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    signIn: "دخول",
    signingIn: "جارٍ الدخول…",
    signOut: "تسجيل الخروج",
    invalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة",
    missingCredentials: "الرجاء إدخال البريد الإلكتروني وكلمة المرور",
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
    emailReadOnlyHint: "لا يمكن تغييره — هو معرّف الدخول لحسابك",
    phone: "رقم الهاتف",
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
    settings: "الإعدادات",
    owners: "المُلّاك",
    ownerRequests: "طلبات التسجيل",
    customers: "العملاء",
    bookings: "الحجوزات",
    payments: "المدفوعات",
    auditLog: "سجل النشاط",

    greetingNight: "ليلة هادئة",
    greetingMorning: "صباح الخير",
    greetingAfternoon: "طاب يومك",
    greetingEvening: "مساء الخير",

    statNewRequests: "طلبات جديدة",
    statNewRequestsSub: "بانتظار الرد",
    statConfirmed: "حجوزات مؤكدة",
    statConfirmedSub: "الإجمالي",
    statOccupancy: "نسبة الإشغال",
    statOccupancySub: "٣٠ يومًا القادمة",
    statRevenue: "الإيراد المتوقّع",
    statRevenueSub: "درهم — حجوزات مؤكدة",
    statOwners: "المُلّاك",
    statOwnersSub: "نشط",
    statPendingOwners: "طلبات تسجيل",
    statPendingOwnersSub: "بانتظار المراجعة",

    weeklyOccupancy: "الإشغال الأسبوعي",
    nextFourWeeks: "الأسابيع الأربعة القادمة",
    weekLabel: (n: string) => `الأسبوع ${n}`,
    addListingFirst: "أضف استراحة أولًا لعرض الإشغال.",
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
    paymentsTitle: "المدفوعات والعرابين",
    paymentsSubtitle: "الدفع الإلكتروني غير مفعّل — العربون يُحصّل من المالك مباشرة.",
    noPayments: "لا توجد مدفوعات مسجّلة.",
    depositDue: "العربون المستحق",
    depositPercentCol: "نسبة العربون",
    paymentStatus: "حالة الدفع",

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
    historyCapped: "يُعرض أحدث ٢٠٠ طلب مُغلق. استخدم الفلاتر أعلاه لعرض حالة محددة.",

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
    weekendPriceLabel: "سعر نهاية الأسبوع",
    weekendPriceHint: "اتركه صفرًا ليساوي السعر العادي",
    capacityLabel: "السعة (ضيف)",
    descriptionLabel: "الوصف",
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
    checkInTimeEnLabel: "وقت الدخول (إنجليزي)",
    checkOutTimeEnLabel: "وقت الخروج (إنجليزي)",
    paymentDisabled: "الدفع الإلكتروني غير مُفعّل — العربون يُحصّل مباشرة من المالك.",
    paymentMisconfigured:
      "الخيار مُفعّل لكن مفاتيح بوابة الدفع غير مُهيّأة في الخادم (STRIPE_SECRET_KEY).",
    paymentEnabled: "الدفع الإلكتروني مُفعّل.",
    cardIdentity: "الهوية",
    cardContact: "التواصل",
    cardColors: "الألوان",
    cardLocation: "الموقع الجغرافي",
    cardBooking: "شروط الحجز",
    cardHomeSeo: "الصفحة الرئيسية و SEO",
    fieldSiteName: "اسم الموقع",
    fieldTagline: "الوصف المختصر",
    fieldTaglineHint: "يظهر تحت الاسم في الهيدر",
    fieldLogoGlyph: "حرف الشعار",
    fieldLogoGlyphHint: "يظهر داخل المربّع الذهبي عند عدم وجود صورة",
    logoAlt: "الشعار",
    logoNote: "الشعار يظهر في الهيدر والفوتر وصفحة الدخول.",
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
    fieldDepositDefault: "العربون الافتراضي (٪)",
    fieldDepositDefaultHint: "يُستخدم للاستراحات التي لم يحدّد مالكها نسبة خاصة",
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
    settingsTitle: "إعدادات الموقع",
    settingsSubtitle: "كل ما تعدّله هنا يظهر على الموقع فورًا — لا حاجة لتعديل الكود أو إعادة النشر.",
  },

  /* ------------------------------------------------------------ validation */
  validation: {
    required: "هذا الحقل مطلوب",
    checkFields: "الرجاء التحقّق من الحقول المطلوبة",
    checkInput: "الرجاء التحقّق من البيانات المدخلة",
    nameTooShort: "الاسم قصير جدًا",
    fullNameRequired: "الرجاء إدخال الاسم الكامل",
    invalidEmail: "بريد إلكتروني غير صالح",
    emailTaken: "هذا البريد مسجّل مسبقًا",
    passwordTooShort: "كلمة المرور يجب أن تكون ٨ أحرف على الأقل",
    passwordMismatch: "كلمتا المرور غير متطابقتين",
    phoneIncomplete: "رقم الجوال غير مكتمل",
    phoneInvalid: "رقم الجوال غير صحيح",
    whatsappInvalid: "رقم الواتساب غير صحيح — أدخله مع رمز الدولة",
    invalidCity: "اختر مدينة صحيحة",
    priceRequired: "السعر مطلوب",
    capacityRequired: "السعة مطلوبة",
    weekendBelowWeekday: "سعر نهاية الأسبوع لا يمكن أن يكون أقل من سعر الليلة العادية",
    weekendBelowWeekdayShort: "أقل من السعر العادي",
    depositRange: "نسبة العربون يجب أن تكون بين ٠ و ١٠٠",
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
    invalidCoordinates: "الإحداثيات غير صحيحة — اكتبها بالصيغة: 24.7614, 55.3340",
    invalidFormat: "صيغة غير صحيحة",
    checkTheFields: "الرجاء التحقّق من الحقول",
    uploadNoFile: "لم يتم إرسال ملف صالح",
    uploadEmpty: "الملف فارغ",
    uploadTooLarge: "حجم الصورة أكبر من ٢٠٠ ميغابايت",
    uploadBadFormat: "صيغة غير مدعومة — استخدم JPG أو PNG أو WebP",
  },

  /* --------------------------------------------------------------- statuses */
  status: {
    // booking
    NEW: "جديد",
    CONFIRMED: "مؤكد",
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

  /* ----------------------------------------------------------------- audit */
  audit: {
    OWNER_APPROVED: "الموافقة على مالك",
    OWNER_REJECTED: "رفض طلب مالك",
    OWNER_SUSPENDED: "إيقاف مالك",
    OWNER_ACTIVATED: "تفعيل مالك",
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
    guests: (n: string) => `👥 عدد الضيوف: ${n}`,
    total: (amount: string) => `💰 الإجمالي التقديري: ${amount} د.إ`,
    deposit: (pct: string, amount: string) => `💵 العربون (${pct}٪): ${amount} د.إ`,
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
      "الأيام المحجوزة تظهر مشطوبة ولا يمكن اختيارها. اختر الوصول ثم المغادرة، وسيُحسب الإجمالي فورًا شاملًا رسوم الخدمة.",
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
    polS3H: "٣. الأسعار ورسوم الخدمة",
    polS3L1: (pct: string) => `الأسعار بالدرهم الإماراتي وتشمل رسوم خدمة بنسبة ${pct}٪.`,
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
