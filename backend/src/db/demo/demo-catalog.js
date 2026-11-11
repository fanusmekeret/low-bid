// Demo marketplace data for development and demos. NOT for production.
// Prices are rough 2026 Addis Ababa market levels in ETB, for realism only.
//
// schedule (minutes, relative to when the script runs):
//   { live: { startedAgo, endsIn } }
//   { upcoming: { startsIn, duration } }
//   { closed: { endedAgo, duration } }
// bids: how many bids to generate (0 on a closed auction = no sale).
// Spec sheets and card highlights live in demo-specs.js.

export const DEMO_BIDDERS = [
  { phone: '0900000201', firstName: 'Abebe', lastName: 'Kebede' },
  { phone: '0900000202', firstName: 'Hanna', lastName: 'Tesfaye' },
  { phone: '0900000203', firstName: 'Dawit', lastName: 'Bekele' },
  { phone: '0900000204', firstName: 'Selam', lastName: 'Girma' },
  { phone: '0900000205', firstName: 'Yonas', lastName: 'Alemu' },
  { phone: '0900000206', firstName: 'Meron', lastName: 'Haile' },
  { phone: '0900000207', firstName: 'Ermias', lastName: 'Wolde' },
  { phone: '0900000208', firstName: 'Liya', lastName: 'Getachew' },
];

export const DEMO_ITEMS = [
  // ─────────────── Mobile phones and tablets ───────────────
  {
    key: 'iphone-15-pro-max', category: 'mobile-phones-tablets', featured: true,
    title: 'iPhone 15 Pro Max 256GB, Natural Titanium',
    condition: 'LIKE_NEW', location: 'Bole, Addis Ababa',
    description: 'Battery health 94%. No scratches, always used with a case. Comes with original box, USB-C cable and 3-month shop warranty. IMEI clean, not iCloud-locked.',
    priceEtb: '145000', schedule: { live: { startedAgo: 2 * 24 * 60, endsIn: 4 } }, bids: 14,
  },
  {
    key: 'galaxy-s24-ultra', category: 'mobile-phones-tablets', featured: true,
    title: 'Samsung Galaxy S24 Ultra 512GB, Titanium Black',
    condition: 'NEW', location: 'Bole, Addis Ababa',
    description: 'Sealed box, dual SIM, international version. Includes S Pen. 1-year shop warranty.',
    priceEtb: '120000', schedule: { live: { startedAgo: 24 * 60, endsIn: 25 } }, bids: 9,
  },
  {
    key: 'tecno-camon-30-pro', category: 'mobile-phones-tablets',
    title: 'Tecno Camon 30 Pro 5G 512GB',
    condition: 'NEW', location: 'Piassa, Addis Ababa',
    description: 'Brand new, sealed. 50MP selfie camera, 5000 mAh battery, 70W fast charging. Official Ethiopian warranty.',
    priceEtb: '22000', schedule: { live: { startedAgo: 6 * 60, endsIn: 3 * 60 } }, bids: 6,
  },
  {
    key: 'infinix-note-40-pro', category: 'mobile-phones-tablets',
    title: 'Infinix Note 40 Pro 256GB',
    condition: 'NEW', location: 'Piassa, Addis Ababa',
    description: 'Sealed box. Curved AMOLED display, wireless charging. Dual SIM.',
    priceEtb: '16500', schedule: { live: { startedAgo: 12 * 60, endsIn: 9 } }, bids: 11,
  },
  {
    key: 'galaxy-a55', category: 'mobile-phones-tablets',
    title: 'Samsung Galaxy A55 5G 256GB, Awesome Iceblue',
    condition: 'NEW', location: 'Bole, Addis Ababa',
    description: 'New in box with charger. IP67 water resistant. 1-year warranty.',
    priceEtb: '32000', schedule: { live: { startedAgo: 3 * 60, endsIn: 2 * 24 * 60 } }, bids: 3,
  },
  {
    key: 'iphone-13', category: 'mobile-phones-tablets',
    title: 'iPhone 13 128GB, Midnight',
    condition: 'USED_GOOD', location: 'Hawassa',
    description: 'Battery health 86%. Small scratch on the back glass, screen perfect. Face ID works. Charger cable included, no box.',
    priceEtb: '52000', schedule: { live: { startedAgo: 20 * 60, endsIn: 50 } }, bids: 8,
  },
  {
    key: 'redmi-note-13-pro', category: 'mobile-phones-tablets',
    title: 'Xiaomi Redmi Note 13 Pro 256GB',
    condition: 'LIKE_NEW', location: 'Piassa, Addis Ababa',
    description: 'Used for two months, with box and 67W charger. 200MP camera.',
    priceEtb: '19000', schedule: { upcoming: { startsIn: 18 * 60, duration: 2 * 24 * 60 } }, bids: 0,
  },
  {
    key: 'galaxy-z-flip6', category: 'mobile-phones-tablets', featured: true,
    title: 'Samsung Galaxy Z Flip6 256GB, Mint',
    condition: 'NEW', location: 'Bole, Addis Ababa',
    description: 'Sealed. Foldable 6.7" display with 3.4" cover screen. 1-year warranty.',
    priceEtb: '82000', schedule: { upcoming: { startsIn: 3 * 60, duration: 24 * 60 } }, bids: 0,
  },
  {
    key: 'ipad-pro-m4', category: 'mobile-phones-tablets', featured: true,
    title: 'iPad Pro 11" M4 256GB Wi-Fi, Space Black',
    condition: 'LIKE_NEW', location: 'Bole, Addis Ababa',
    description: 'Bought four months ago, used for drawing. Includes Apple Pencil Pro. Screen protector fitted since day one.',
    priceEtb: '140000', schedule: { live: { startedAgo: 30 * 60, endsIn: 6 * 60 } }, bids: 5,
  },
  {
    key: 'ipad-10th-gen', category: 'mobile-phones-tablets',
    title: 'iPad 10th generation 64GB Wi-Fi, Blue',
    condition: 'USED_GOOD', location: 'Piassa, Addis Ababa',
    description: 'Light signs of use on the edges. Battery good. Comes with charger. Great for students.',
    priceEtb: '38000', schedule: { closed: { endedAgo: 5 * 60, duration: 2 * 24 * 60 } }, bids: 7,
  },
  {
    key: 'galaxy-tab-s9-fe', category: 'mobile-phones-tablets',
    title: 'Samsung Galaxy Tab S9 FE 128GB with S Pen',
    condition: 'NEW', location: 'Bole, Addis Ababa',
    description: 'Sealed box. 10.9" display, IP68, S Pen included. 1-year warranty.',
    priceEtb: '36000', schedule: { live: { startedAgo: 8 * 60, endsIn: 26 * 60 } }, bids: 4,
  },
  {
    key: 'lenovo-tab-m11', category: 'mobile-phones-tablets',
    title: 'Lenovo Tab M11 128GB with pen',
    condition: 'NEW', location: 'Piassa, Addis Ababa',
    description: 'New, sealed. 11" display, quad speakers. Good for kids and reading.',
    priceEtb: '16000', schedule: { closed: { endedAgo: 26 * 60, duration: 24 * 60 } }, bids: 0,
  },

  // ─────────────── Home appliances ───────────────
  {
    key: 'samsung-fridge-415', category: 'home-appliances', featured: true,
    title: 'Samsung 415 L two-door refrigerator, inverter',
    condition: 'NEW', location: 'Merkato, Addis Ababa',
    description: 'Digital inverter compressor (quiet, saves power during outages and voltage swings). Frost-free. Delivery inside Addis included.',
    priceEtb: '78000', schedule: { live: { startedAgo: 24 * 60, endsIn: 7 } }, bids: 10,
  },
  {
    key: 'lg-washer-7kg', category: 'home-appliances',
    title: 'LG 7 kg front-load washing machine',
    condition: 'NEW', location: 'Merkato, Addis Ababa',
    description: 'Inverter direct drive, 6 Motion wash. 1200 rpm spin. 2-year warranty.',
    priceEtb: '52000', schedule: { live: { startedAgo: 10 * 60, endsIn: 90 } }, bids: 6,
  },
  {
    key: 'electric-mitad', category: 'home-appliances', featured: true,
    title: 'Electric injera mitad, 60 cm, with lid',
    condition: 'NEW', location: 'Merkato, Addis Ababa',
    description: 'Heavy clay-ceramic plate, even heating for perfect injera. Thermostat control and woven lid included.',
    priceEtb: '7800', schedule: { live: { startedAgo: 4 * 60, endsIn: 40 } }, bids: 12,
  },
  {
    key: 'water-dispenser', category: 'home-appliances',
    title: 'Hot and cold water dispenser with fridge cabinet',
    condition: 'USED_GOOD', location: 'Hawassa',
    description: 'Works perfectly, two years old. Bottom cabinet cools drinks. Selling because I am relocating.',
    priceEtb: '9000', schedule: { live: { startedAgo: 15 * 60, endsIn: 5 * 60 } }, bids: 3,
  },
  {
    key: 'philips-air-fryer', category: 'home-appliances',
    title: 'Philips Airfryer XXL 7.3 L',
    condition: 'NEW', location: 'Merkato, Addis Ababa',
    description: 'Fat-removal technology, digital display, dishwasher-safe basket. Sealed box.',
    priceEtb: '14500', schedule: { live: { startedAgo: 2 * 60, endsIn: 3 * 24 * 60 } }, bids: 2,
  },
  {
    key: 'gas-cooker-4-burner', category: 'home-appliances',
    title: 'Ariston 4-burner gas cooker with electric oven',
    condition: 'NEW', location: 'Merkato, Addis Ababa',
    description: 'Freestanding, 60 cm. Auto ignition, electric oven with grill. Gas cylinder not included.',
    priceEtb: '36000', schedule: { upcoming: { startsIn: 2 * 24 * 60, duration: 3 * 24 * 60 } }, bids: 0,
  },
  {
    key: 'deep-freezer-300', category: 'home-appliances',
    title: 'Hisense 300 L chest deep freezer',
    condition: 'NEW', location: 'Merkato, Addis Ababa',
    description: 'Ideal for shops and large families. Keeps frozen for hours during power cuts. Lockable lid.',
    priceEtb: '45000', schedule: { closed: { endedAgo: 2 * 60, duration: 24 * 60 } }, bids: 9,
  },
  {
    key: 'delonghi-espresso', category: 'home-appliances',
    title: "De'Longhi Dedica espresso machine",
    condition: 'USED_GOOD', location: 'Hawassa',
    description: 'Makes excellent macchiato. Descaled monthly. Milk frother works well.',
    priceEtb: '24000',
    schedule: { closed: { endedAgo: 30 * 60, duration: 2 * 24 * 60 } }, bids: 4, // reserve not met
  },
  {
    key: 'samsung-microwave', category: 'home-appliances',
    title: 'Samsung 23 L microwave with grill',
    condition: 'NEW', location: 'Merkato, Addis Ababa',
    description: 'Ceramic enamel interior, easy to clean. Grill function. 1-year warranty.',
    priceEtb: '9500', schedule: { live: { startedAgo: 60, endsIn: 20 * 60 } }, bids: 1,
  },
  {
    key: 'kenwood-blender', category: 'home-appliances',
    title: 'Kenwood 2 L blender with grinder mill',
    condition: 'LIKE_NEW', location: 'Hawassa',
    description: 'Used a few times. Grinder mill is great for spices and berbere.',
    priceEtb: '5500', schedule: { upcoming: { startsIn: 45, duration: 24 * 60 } }, bids: 0,
  },
];
