// Content shown before Supabase is connected (demo mode). It mirrors KX Nyalungu's price list;
// once connected, everything here comes from what the owner enters in her dashboard.
// Durations are estimates for scheduling — the owner can adjust them in the dashboard.
(() => {
  window.KX_DEMO = {
    settings: {
      business_name: "KX Nyalungu Nails",
      tagline: "Treat your nails, treat yourself 🌷",
      about:
        "Acrylics, gel and nail art done with love and a sharp eye for detail — from clean French tips to chrome, ombré and 3D flowers. Visit the studio or book a house call.",
      phone: "0716279835",
      whatsapp: "27716279835",
      email: "",
      address: "34 Thabakgolo, next to Kgoši Mashego, 1282",
      facebook: "https://www.facebook.com/share/1HYaTmmz4T/",
      instagram: "",
      tiktok: "",
      deposit_type: "fixed",
      deposit_value: 50,
      house_call_fee_cents: 10000,
      slot_interval_minutes: 120,
      booking_notice_hours: 2,
      eft_details: "",
      owner_name: "Khongelani Nyalungu",
      owner_photo_url: "images/owner.jpg",
      owner_bio:
        "Hi, I'm Khongelani, the artist behind KX Nyalungu Nails 💅 I believe your nails should feel like a treat every single time. From sharp stiletto French tips and glossy chrome to hand-placed 3D flowers, every set is done with patience, clean technique and real love for detail. Whether you come to me or book a house call, my goal is simple: you leave feeling confident and fully treated.",
      policies:
        "An R50 deposit secures your booking and goes towards your total; the balance is paid at your appointment. Please arrive on time, and give at least 24 hours' notice if you need to reschedule.",
    },
    services: [
      { id: "s1", category: "Acrylic mani", name: "Acrylic mani — Short", description: "Sculpted acrylic set, short length.", duration_minutes: 90, price_cents: 13000 },
      { id: "s2", category: "Acrylic mani", name: "Acrylic mani — Medium", description: "Sculpted acrylic set, medium length.", duration_minutes: 105, price_cents: 14000 },
      { id: "s3", category: "Acrylic mani", name: "Acrylic mani — Long", description: "Sculpted acrylic set, long length.", duration_minutes: 120, price_cents: 15000 },
      { id: "s4", category: "Gel", name: "Gel plain mani", description: "Glossy gel colour on natural nails.", duration_minutes: 60, price_cents: 12000 },
      { id: "s5", category: "Pedicure", name: "Acrylic pedi", description: "Acrylic on the toes for a long-lasting finish.", duration_minutes: 75, price_cents: 11000 },
      { id: "s6", category: "Pedicure", name: "Gel pedi", description: "Gel colour on the toes.", duration_minutes: 60, price_cents: 10000 },
      { id: "s7", category: "Care", name: "Buff and shine", description: "Buffed, shaped and polished to a natural shine.", duration_minutes: 30, price_cents: 10000 },
      { id: "s8", category: "Care", name: "Soak off", description: "Gentle removal of gel or acrylic.", duration_minutes: 30, price_cents: 5000 },
    ],
    addons: [
      { id: "a1", name: "Chrome", price_cents: 1000, duration_minutes: 10 },
      { id: "a2", name: "3D flower", price_cents: 1000, duration_minutes: 10 },
      { id: "a3", name: "Ombré", price_cents: 3000, duration_minutes: 15 },
    ],
    // Real specials are posted by the owner from her dashboard.
    specials: [],
    gallery: [
      { id: "g1", image_url: "images/work-1.jpg", caption: "Black French stiletto with pink 3D flowers" },
      { id: "g2", image_url: "images/work-2.jpg", caption: "Red French stiletto with flower art" },
      { id: "g3", image_url: "images/work-3.jpg", caption: "Animal print & 3D flower stiletto" },
      { id: "g4", image_url: "images/work-4.jpg", caption: "Pink French, square" },
    ],
    // 0 = Sunday … 6 = Saturday. Weekdays 14:00–17:00 (2 bookings max); weekends 09:00–17:00 (4 bookings max).
    hours: [
      { weekday: 0, closed: false, open_time: "09:00", close_time: "17:00", max_bookings: 4 },
      { weekday: 1, closed: false, open_time: "14:00", close_time: "17:00", max_bookings: 2 },
      { weekday: 2, closed: false, open_time: "14:00", close_time: "17:00", max_bookings: 2 },
      { weekday: 3, closed: false, open_time: "14:00", close_time: "17:00", max_bookings: 2 },
      { weekday: 4, closed: false, open_time: "14:00", close_time: "17:00", max_bookings: 2 },
      { weekday: 5, closed: false, open_time: "14:00", close_time: "17:00", max_bookings: 2 },
      { weekday: 6, closed: false, open_time: "09:00", close_time: "17:00", max_bookings: 4 },
    ],
    // Public school holidays (gov.za/about-sa/school-calendar): 09:00–17:00 every day.
    holidays: [
      { name: "December school holidays", starts_on: "2026-12-10", ends_on: "2027-01-12", open_time: "09:00", close_time: "17:00", max_bookings: null },
      { name: "March/April school holidays", starts_on: "2027-03-20", ends_on: "2027-04-05", open_time: "09:00", close_time: "17:00", max_bookings: null },
      { name: "June/July school holidays", starts_on: "2027-06-26", ends_on: "2027-07-19", open_time: "09:00", close_time: "17:00", max_bookings: null },
      { name: "October school holidays", starts_on: "2027-10-02", ends_on: "2027-10-10", open_time: "09:00", close_time: "17:00", max_bookings: null },
      { name: "December school holidays", starts_on: "2027-12-09", ends_on: "2027-12-31", open_time: "09:00", close_time: "17:00", max_bookings: null },
    ],
    blocked_dates: [],
  };
})();
