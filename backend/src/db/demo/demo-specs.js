// Specification sheets for the demo items, stored in products.attributes as
//   { highlights: string[3], specs: [{ group, rows: [{ label, value }] }] }
// highlights → shown on auction cards (cards never show prices)
// specs      → full spec sheet on the auction detail page
// Phone and tablet specs follow the manufacturers' published specifications;
// appliance figures are typical for the class and illustrative only.

const g = (group, ...rows) => ({ group, rows: rows.map(([label, value]) => ({ label, value })) });

export const DEMO_SPECS = {
  // ─────────────── Mobile phones and tablets ───────────────
  'iphone-15-pro-max': {
    highlights: ['256GB', '6.7" 120 Hz OLED', 'Battery 94%'],
    specs: [
      g('General', ['Brand', 'Apple'], ['Model', 'iPhone 15 Pro Max'], ['Colour', 'Natural Titanium'], ['Operating system', 'iOS'], ['Weight', '221 g']),
      g('Display', ['Size', '6.7 inch'], ['Type', 'Super Retina XDR OLED, ProMotion'], ['Resolution', '2796 × 1290'], ['Refresh rate', 'Up to 120 Hz']),
      g('Performance', ['Chip', 'A17 Pro'], ['RAM', '8GB'], ['Storage', '256GB']),
      g('Cameras', ['Main', '48MP'], ['Ultra wide', '12MP'], ['Telephoto', '12MP, 5× optical zoom'], ['Front', '12MP']),
      g('Battery and charging', ['Battery health', '94%'], ['Port', 'USB-C (USB 3)'], ['Wireless', 'MagSafe and Qi2']),
      g('Connectivity', ['Network', '5G'], ['SIM', 'Nano-SIM + eSIM'], ['Wi-Fi', 'Wi-Fi 6E']),
      g('Condition and box', ['Condition', 'Like new, no scratches'], ['In the box', 'Original box, USB-C cable'], ['iCloud', 'Not locked, IMEI clean'], ['Warranty', '3 months (shop)']),
    ],
  },
  'galaxy-s24-ultra': {
    highlights: ['512GB · 12GB RAM', '200MP camera', 'S Pen'],
    specs: [
      g('General', ['Brand', 'Samsung'], ['Model', 'Galaxy S24 Ultra'], ['Colour', 'Titanium Black'], ['Operating system', 'Android, One UI'], ['Weight', '232 g'], ['Water resistance', 'IP68']),
      g('Display', ['Size', '6.8 inch'], ['Type', 'Dynamic AMOLED 2X'], ['Resolution', '3120 × 1440 (QHD+)'], ['Refresh rate', '1–120 Hz']),
      g('Performance', ['Chip', 'Snapdragon 8 Gen 3 for Galaxy'], ['RAM', '12GB'], ['Storage', '512GB']),
      g('Cameras', ['Main', '200MP'], ['Ultra wide', '12MP'], ['Telephoto', '10MP 3× and 50MP 5×'], ['Front', '12MP']),
      g('Battery and charging', ['Battery', '5000 mAh'], ['Wired charging', '45 W'], ['Wireless', 'Yes']),
      g('Connectivity', ['Network', '5G'], ['SIM', 'Dual SIM'], ['Wi-Fi', 'Wi-Fi 7']),
      g('Condition and box', ['Condition', 'New, sealed box'], ['Extras', 'Built-in S Pen'], ['Warranty', '12 months (shop)']),
    ],
  },
  'tecno-camon-30-pro': {
    highlights: ['512GB · 12GB RAM', '144 Hz AMOLED', '70 W charging'],
    specs: [
      g('General', ['Brand', 'Tecno'], ['Model', 'Camon 30 Pro 5G'], ['Operating system', 'Android, HiOS']),
      g('Display', ['Size', '6.78 inch'], ['Type', 'AMOLED'], ['Refresh rate', '144 Hz']),
      g('Performance', ['Chip', 'MediaTek Dimensity 8200 Ultimate'], ['RAM', '12GB'], ['Storage', '512GB']),
      g('Cameras', ['Main', '50MP with OIS'], ['Ultra wide', '50MP'], ['Front', '50MP']),
      g('Battery and charging', ['Battery', '5000 mAh'], ['Wired charging', '70 W']),
      g('Connectivity', ['Network', '5G'], ['SIM', 'Dual SIM']),
      g('Condition and box', ['Condition', 'New, sealed box'], ['Warranty', '12 months (official)']),
    ],
  },
  'infinix-note-40-pro': {
    highlights: ['256GB · 8GB RAM', '108MP camera', 'Wireless charging'],
    specs: [
      g('General', ['Brand', 'Infinix'], ['Model', 'Note 40 Pro'], ['Operating system', 'Android, XOS']),
      g('Display', ['Size', '6.78 inch'], ['Type', 'Curved AMOLED'], ['Refresh rate', '120 Hz']),
      g('Performance', ['Chip', 'MediaTek Helio G99 Ultimate'], ['RAM', '8GB'], ['Storage', '256GB']),
      g('Cameras', ['Main', '108MP'], ['Front', '32MP']),
      g('Battery and charging', ['Battery', '5000 mAh'], ['Wired charging', '45 W'], ['Wireless', '20 W magnetic']),
      g('Connectivity', ['Network', '4G'], ['SIM', 'Dual SIM']),
      g('Condition and box', ['Condition', 'New, sealed box']),
    ],
  },
  'galaxy-a55': {
    highlights: ['256GB · 8GB RAM', '50MP OIS camera', 'IP67'],
    specs: [
      g('General', ['Brand', 'Samsung'], ['Model', 'Galaxy A55 5G'], ['Colour', 'Awesome Iceblue'], ['Operating system', 'Android, One UI'], ['Water resistance', 'IP67']),
      g('Display', ['Size', '6.6 inch'], ['Type', 'Super AMOLED'], ['Resolution', '2340 × 1080 (FHD+)'], ['Refresh rate', '120 Hz']),
      g('Performance', ['Chip', 'Exynos 1480'], ['RAM', '8GB'], ['Storage', '256GB']),
      g('Cameras', ['Main', '50MP with OIS'], ['Ultra wide', '12MP'], ['Macro', '5MP'], ['Front', '32MP']),
      g('Battery and charging', ['Battery', '5000 mAh'], ['Wired charging', '25 W']),
      g('Connectivity', ['Network', '5G'], ['SIM', 'Dual SIM']),
      g('Condition and box', ['Condition', 'New in box'], ['In the box', 'Charger included'], ['Warranty', '12 months (shop)']),
    ],
  },
  'iphone-13': {
    highlights: ['128GB', 'Battery 86%', 'Face ID works'],
    specs: [
      g('General', ['Brand', 'Apple'], ['Model', 'iPhone 13'], ['Colour', 'Midnight'], ['Operating system', 'iOS']),
      g('Display', ['Size', '6.1 inch'], ['Type', 'Super Retina XDR OLED'], ['Resolution', '2532 × 1170']),
      g('Performance', ['Chip', 'A15 Bionic'], ['Storage', '128GB']),
      g('Cameras', ['Main', '12MP'], ['Ultra wide', '12MP'], ['Front', '12MP']),
      g('Battery and charging', ['Battery health', '86%'], ['Port', 'Lightning']),
      g('Connectivity', ['Network', '5G'], ['SIM', 'Nano-SIM + eSIM']),
      g('Condition and box', ['Condition', 'Used, small scratch on back glass; screen perfect'], ['In the box', 'Cable only, no box']),
    ],
  },
  'redmi-note-13-pro': {
    highlights: ['256GB · 8GB RAM', '200MP camera', '67 W charging'],
    specs: [
      g('General', ['Brand', 'Xiaomi'], ['Model', 'Redmi Note 13 Pro'], ['Operating system', 'Android, HyperOS']),
      g('Display', ['Size', '6.67 inch'], ['Type', 'AMOLED'], ['Refresh rate', '120 Hz']),
      g('Performance', ['Chip', 'MediaTek Helio G99 Ultra'], ['RAM', '8GB'], ['Storage', '256GB']),
      g('Cameras', ['Main', '200MP with OIS'], ['Ultra wide', '8MP'], ['Macro', '2MP'], ['Front', '16MP']),
      g('Battery and charging', ['Battery', '5000 mAh'], ['Wired charging', '67 W']),
      g('Connectivity', ['Network', '4G'], ['SIM', 'Dual SIM']),
      g('Condition and box', ['Condition', 'Like new, used two months'], ['In the box', 'Box and 67 W charger']),
    ],
  },
  'galaxy-z-flip6': {
    highlights: ['Foldable', '256GB · 12GB RAM', '3.4" cover screen'],
    specs: [
      g('General', ['Brand', 'Samsung'], ['Model', 'Galaxy Z Flip6'], ['Colour', 'Mint'], ['Operating system', 'Android, One UI'], ['Water resistance', 'IP48']),
      g('Display', ['Main screen', '6.7 inch Dynamic AMOLED 2X, 120 Hz'], ['Cover screen', '3.4 inch Super AMOLED']),
      g('Performance', ['Chip', 'Snapdragon 8 Gen 3 for Galaxy'], ['RAM', '12GB'], ['Storage', '256GB']),
      g('Cameras', ['Main', '50MP'], ['Ultra wide', '12MP'], ['Front', '10MP']),
      g('Battery and charging', ['Battery', '4000 mAh'], ['Wired charging', '25 W'], ['Wireless', 'Yes']),
      g('Connectivity', ['Network', '5G']),
      g('Condition and box', ['Condition', 'New, sealed box'], ['Warranty', '12 months (shop)']),
    ],
  },
  'ipad-pro-m4': {
    highlights: ['M4 chip', '11" OLED 120 Hz', 'Apple Pencil Pro'],
    specs: [
      g('General', ['Brand', 'Apple'], ['Model', 'iPad Pro 11-inch (M4)'], ['Colour', 'Space Black'], ['Operating system', 'iPadOS'], ['Weight', '444 g']),
      g('Display', ['Size', '11 inch'], ['Type', 'Ultra Retina XDR (tandem OLED), ProMotion'], ['Resolution', '2420 × 1668'], ['Refresh rate', 'Up to 120 Hz']),
      g('Performance', ['Chip', 'Apple M4'], ['RAM', '8GB'], ['Storage', '256GB']),
      g('Cameras', ['Rear', '12MP'], ['Front', '12MP landscape']),
      g('Connectivity', ['Wireless', 'Wi-Fi 6E'], ['Port', 'USB-C (Thunderbolt / USB 4)'], ['Cellular', 'No (Wi-Fi model)']),
      g('Condition and box', ['Condition', 'Like new, screen protector since day one'], ['Extras', 'Apple Pencil Pro']),
    ],
  },
  'ipad-10th-gen': {
    highlights: ['64GB', '10.9" Liquid Retina', 'USB-C'],
    specs: [
      g('General', ['Brand', 'Apple'], ['Model', 'iPad (10th generation)'], ['Colour', 'Blue'], ['Operating system', 'iPadOS']),
      g('Display', ['Size', '10.9 inch'], ['Type', 'Liquid Retina'], ['Resolution', '2360 × 1640']),
      g('Performance', ['Chip', 'A14 Bionic'], ['Storage', '64GB']),
      g('Cameras', ['Rear', '12MP'], ['Front', '12MP landscape']),
      g('Connectivity', ['Wireless', 'Wi-Fi 6'], ['Port', 'USB-C'], ['Security', 'Touch ID in top button']),
      g('Condition and box', ['Condition', 'Used, light marks on edges'], ['In the box', 'Charger']),
    ],
  },
  'galaxy-tab-s9-fe': {
    highlights: ['128GB + microSD', 'S Pen included', 'IP68'],
    specs: [
      g('General', ['Brand', 'Samsung'], ['Model', 'Galaxy Tab S9 FE'], ['Operating system', 'Android, One UI'], ['Water resistance', 'IP68']),
      g('Display', ['Size', '10.9 inch'], ['Type', 'LCD'], ['Resolution', '2304 × 1440'], ['Refresh rate', '90 Hz']),
      g('Performance', ['Chip', 'Exynos 1380'], ['RAM', '6GB'], ['Storage', '128GB, microSD slot']),
      g('Cameras', ['Rear', '8MP'], ['Front', '12MP ultra wide']),
      g('Battery and charging', ['Battery', '8000 mAh'], ['Wired charging', '45 W']),
      g('Connectivity', ['Wireless', 'Wi-Fi'], ['Port', 'USB-C']),
      g('Condition and box', ['Condition', 'New, sealed box'], ['Extras', 'S Pen'], ['Warranty', '12 months (shop)']),
    ],
  },
  'lenovo-tab-m11': {
    highlights: ['11" 90 Hz screen', '128GB + microSD', 'Pen included'],
    specs: [
      g('General', ['Brand', 'Lenovo'], ['Model', 'Tab M11'], ['Operating system', 'Android']),
      g('Display', ['Size', '10.95 inch'], ['Type', 'LCD'], ['Resolution', '1920 × 1200'], ['Refresh rate', '90 Hz']),
      g('Performance', ['Chip', 'MediaTek Helio G88'], ['RAM', '4GB'], ['Storage', '128GB, microSD slot']),
      g('Cameras', ['Rear', '13MP'], ['Front', '8MP']),
      g('Audio and battery', ['Speakers', 'Quad speakers, Dolby Atmos'], ['Battery', '7040 mAh']),
      g('Condition and box', ['Condition', 'New, sealed box'], ['Extras', 'Lenovo Tab Pen']),
    ],
  },

  // ─────────────── Home appliances ───────────────
  'samsung-fridge-415': {
    highlights: ['415 L', 'Digital inverter', 'No frost'],
    specs: [
      g('General', ['Brand', 'Samsung'], ['Type', 'Two-door, top freezer'], ['Colour', 'Silver']),
      g('Capacity', ['Total', '415 L'], ['Shelves', 'Tempered glass']),
      g('Performance', ['Compressor', 'Digital inverter'], ['Defrost', 'No frost (automatic)'], ['Voltage', '220–240 V']),
      g('Features', ['Power cuts', 'Inverter restarts gently after outages'], ['Noise', 'Quiet operation']),
      g('Condition and service', ['Condition', 'New'], ['Delivery', 'Free inside Addis Ababa'], ['Warranty', '24 months']),
    ],
  },
  'lg-washer-7kg': {
    highlights: ['7 kg', 'Front load', '1200 rpm'],
    specs: [
      g('General', ['Brand', 'LG'], ['Type', 'Front-load automatic'], ['Colour', 'White']),
      g('Capacity and spin', ['Wash capacity', '7 kg'], ['Max spin', '1200 rpm']),
      g('Technology', ['Motor', 'Inverter Direct Drive'], ['Wash motions', '6 Motion'], ['Voltage', '220–240 V']),
      g('Condition and service', ['Condition', 'New'], ['Warranty', '24 months']),
    ],
  },
  'electric-mitad': {
    highlights: ['60 cm plate', 'Clay ceramic', 'Thermostat'],
    specs: [
      g('General', ['Product', 'Electric injera mitad'], ['Plate diameter', '60 cm'], ['Plate', 'Clay ceramic']),
      g('Power', ['Power', '3000 W'], ['Voltage', '220 V'], ['Control', 'Adjustable thermostat']),
      g('Included', ['Lid', 'Woven lid (mesob style)'], ['Stand', 'Steel stand']),
      g('Condition', ['Condition', 'New']),
    ],
  },
  'water-dispenser': {
    highlights: ['Hot and cold', 'Fridge cabinet', '2 years old'],
    specs: [
      g('General', ['Type', 'Top-load water dispenser'], ['Bottle size', '18.9 L (5 gallon)']),
      g('Performance', ['Hot water', 'About 90 °C'], ['Cold water', 'About 10 °C'], ['Cabinet', 'Refrigerated, for drinks']),
      g('Safety', ['Child lock', 'On hot tap']),
      g('Condition', ['Condition', 'Used, fully working'], ['Age', '2 years']),
    ],
  },
  'philips-air-fryer': {
    highlights: ['7.3 L XXL', 'Digital display', '2225 W'],
    specs: [
      g('General', ['Brand', 'Philips'], ['Model', 'Airfryer XXL'], ['Colour', 'Black']),
      g('Capacity and power', ['Capacity', '7.3 L'], ['Power', '2225 W'], ['Voltage', '220–240 V']),
      g('Features', ['Controls', 'Digital touch display'], ['Fat removal', 'Yes'], ['Basket', 'Dishwasher safe']),
      g('Condition', ['Condition', 'New, sealed box']),
    ],
  },
  'gas-cooker-4-burner': {
    highlights: ['4 gas burners', 'Electric oven', '60 cm'],
    specs: [
      g('General', ['Brand', 'Ariston'], ['Type', 'Freestanding cooker'], ['Size', '60 × 60 cm']),
      g('Hob', ['Burners', '4 gas'], ['Ignition', 'Automatic'], ['Safety', 'Flame failure device']),
      g('Oven', ['Type', 'Electric with grill'], ['Light', 'Yes']),
      g('Condition', ['Condition', 'New'], ['Gas cylinder', 'Not included']),
    ],
  },
  'deep-freezer-300': {
    highlights: ['300 L', 'Chest freezer', 'Lockable'],
    specs: [
      g('General', ['Brand', 'Hisense'], ['Type', 'Chest deep freezer'], ['Colour', 'White']),
      g('Capacity', ['Gross', '300 L'], ['Baskets', '1 hanging basket']),
      g('Performance', ['Temperature', '−18 °C and below'], ['Power cuts', 'Holds frozen for hours'], ['Voltage', '220–240 V']),
      g('Features', ['Lock', 'Key lock'], ['Wheels', 'Castor wheels']),
      g('Condition', ['Condition', 'New']),
    ],
  },
  'delonghi-espresso': {
    highlights: ['15 bar pump', 'Milk frother', 'Slim 15 cm'],
    specs: [
      g('General', ['Brand', "De'Longhi"], ['Model', 'Dedica'], ['Type', 'Pump espresso machine']),
      g('Performance', ['Pressure', '15 bar'], ['Power', '1350 W'], ['Water tank', '1.1 L']),
      g('Features', ['Milk', 'Manual steam frother'], ['Width', '15 cm']),
      g('Condition', ['Condition', 'Used, descaled monthly']),
    ],
  },
  'samsung-microwave': {
    highlights: ['23 L', 'Grill', 'Ceramic interior'],
    specs: [
      g('General', ['Brand', 'Samsung'], ['Type', 'Microwave with grill'], ['Colour', 'Black']),
      g('Capacity and power', ['Capacity', '23 L'], ['Microwave power', '800 W'], ['Grill power', '1100 W']),
      g('Features', ['Interior', 'Ceramic enamel, easy to clean'], ['Controls', 'Digital']),
      g('Condition and service', ['Condition', 'New'], ['Warranty', '12 months']),
    ],
  },
  'kenwood-blender': {
    highlights: ['2 L jug', 'Spice mill', 'Like new'],
    specs: [
      g('General', ['Brand', 'Kenwood'], ['Type', 'Blender with grinder mill']),
      g('Capacity and power', ['Jug', '2 L'], ['Mill', 'Included, for spices and berbere']),
      g('Condition', ['Condition', 'Like new, used a few times']),
    ],
  },
};
