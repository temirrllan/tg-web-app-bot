// Gradient presets for special habit pack cards.
// Keys are stored in DB (bg_color column), CSS values used on the frontend.

const GRADIENT_PRESETS = [
  { key: 'sunset',       label: 'Sunset',        css: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
  { key: 'ocean',        label: 'Ocean',          css: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
  { key: 'forest',       label: 'Forest',         css: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  { key: 'lavender',     label: 'Lavender',       css: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
  { key: 'peach',        label: 'Peach',          css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
  { key: 'aurora',       label: 'Aurora',         css: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { key: 'mint',         label: 'Mint',           css: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)' },
  { key: 'flamingo',     label: 'Flamingo',       css: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
  { key: 'berry',        label: 'Berry',          css: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)' },
  { key: 'sky',          label: 'Sky',            css: 'linear-gradient(135deg, #c1dfc4 0%, #deecdd 100%)' },
  { key: 'coral',        label: 'Coral',          css: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)' },
  { key: 'arctic',       label: 'Arctic',         css: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)' },
];

module.exports = GRADIENT_PRESETS;
