import sharp from 'sharp';

// Generated stand-in photos for demo listings: a simple device or appliance drawing with the
// item's name, clearly marked "Demo photo". They go through the same image pipeline as
// real uploads, so the app exercises every size and URL exactly as in production.

const PALETTES = {
  'mobile-phones-tablets': { bg: '#E6EEF0', ink: '#0F4C5C', accent: '#F2A541' },
  'home-appliances': { bg: '#F4EFE6', ink: '#5C3A00', accent: '#0F4C5C' },
  default: { bg: '#EEEEEE', ink: '#333333', accent: '#F2A541' },
};

const esc = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

/** Greedy word wrap to at most `maxLines` lines of `width` characters. */
function wrap(text, width, maxLines) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width && line) {
      lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, width - 1)}…`;
  }
  return lines;
}

function drawing(kind, ink, accent, view) {
  // Three views per item so the gallery has variety: front, angled, detail.
  if (kind === 'phone') {
    const tilt = [0, -12, 0][view];
    const scale = [1, 1, 1.35][view];
    return `<g transform="translate(600 360) rotate(${tilt}) scale(${scale})">
      <rect x="-90" y="-170" width="180" height="340" rx="28" fill="${ink}"/>
      <rect x="-78" y="-150" width="156" height="300" rx="14" fill="#ffffff" opacity="0.92"/>
      <rect x="-24" y="-162" width="48" height="8" rx="4" fill="#ffffff" opacity="0.5"/>
      <circle cx="0" cy="0" r="34" fill="${accent}" opacity="0.85"/>
    </g>`;
  }
  if (kind === 'tablet') {
    const scale = [1, 0.9, 1.3][view];
    return `<g transform="translate(600 360) rotate(${[0, 8, 0][view]}) scale(${scale})">
      <rect x="-200" y="-150" width="400" height="300" rx="22" fill="${ink}"/>
      <rect x="-186" y="-136" width="372" height="272" rx="10" fill="#ffffff" opacity="0.92"/>
      <circle cx="0" cy="0" r="40" fill="${accent}" opacity="0.85"/>
    </g>`;
  }
  // appliance: a box with a door line and controls
  const scale = [1, 0.95, 1.3][view];
  return `<g transform="translate(600 360) scale(${scale})">
    <rect x="-150" y="-190" width="300" height="380" rx="18" fill="#ffffff" stroke="${ink}" stroke-width="10"/>
    <line x1="-150" y1="-60" x2="150" y2="-60" stroke="${ink}" stroke-width="8"/>
    <rect x="100" y="-170" width="14" height="80" rx="7" fill="${ink}"/>
    <rect x="100" y="-30" width="14" height="140" rx="7" fill="${ink}"/>
    <circle cx="-100" cy="-150" r="12" fill="${accent}"/>
  </g>`;
}

const kindFor = (item) => {
  if (item.category !== 'mobile-phones-tablets') return 'appliance';
  return /ipad|tab\b|tab |tablet/i.test(`${item.key} ${item.title}`) ? 'tablet' : 'phone';
};

/**
 * @param {{ key: string, title: string, category: string }} item
 * @param {number} view 0, 1 or 2
 * @returns {Promise<Buffer>} 1200 × 900 PNG
 */
export async function makeDemoPhoto(item, view) {
  const { bg, ink, accent } = PALETTES[item.category] ?? PALETTES.default;
  const lines = wrap(item.title, 34, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
    <rect width="1200" height="900" fill="${bg}"/>
    <circle cx="1050" cy="120" r="260" fill="${accent}" opacity="0.12"/>
    ${drawing(kindFor(item), ink, accent, view)}
    ${lines.map((l, i) => `<text x="600" y="${700 + i * 58}" font-family="DejaVu Sans, Arial, sans-serif" font-size="46" font-weight="bold" fill="${ink}" text-anchor="middle">${esc(l)}</text>`).join('')}
    <rect x="40" y="40" width="250" height="56" rx="28" fill="${ink}"/>
    <text x="165" y="77" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#ffffff" text-anchor="middle">Demo photo ${view + 1}/3</text>
    <text x="1160" y="870" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="bold" fill="${ink}" opacity="0.55" text-anchor="end">LOW BID</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
