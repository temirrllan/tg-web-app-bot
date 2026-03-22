import React from 'react'

const GRADIENT_PRESETS = [
  { key: 'sunset',   label: 'Sunset',   css: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
  { key: 'ocean',    label: 'Ocean',    css: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
  { key: 'forest',   label: 'Forest',   css: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  { key: 'lavender', label: 'Lavender', css: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
  { key: 'peach',    label: 'Peach',    css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
  { key: 'aurora',   label: 'Aurora',   css: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { key: 'mint',     label: 'Mint',     css: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)' },
  { key: 'flamingo', label: 'Flamingo', css: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
  { key: 'berry',    label: 'Berry',    css: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)' },
  { key: 'sky',      label: 'Sky',      css: 'linear-gradient(135deg, #c1dfc4 0%, #deecdd 100%)' },
  { key: 'coral',    label: 'Coral',    css: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)' },
  { key: 'arctic',   label: 'Arctic',   css: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)' },
]

const SWATCH_STYLE = {
  width: 20,
  height: 20,
  borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.1)',
  flexShrink: 0,
}

const GradientSelect = ({ property, record, onChange }) => {
  const currentValue = record?.params?.[property.path] || ''

  const currentPreset = GRADIENT_PRESETS.find(g => g.key === currentValue)

  return (
    <div style={{ marginBottom: 24 }}>
      <label style={{
        display: 'block',
        fontFamily: 'Roboto, sans-serif',
        fontSize: 12,
        lineHeight: '16px',
        color: '#898A9A',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>
        {property.label || 'Bg color'}
      </label>

      {/* Current selection indicator */}
      {currentPreset && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
          padding: '6px 10px',
          background: '#f4f4f8',
          borderRadius: 8,
          width: 'fit-content',
        }}>
          <div style={{
            ...SWATCH_STYLE,
            width: 28,
            height: 28,
            borderRadius: 8,
            background: currentPreset.css,
          }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>
            {currentPreset.label}
          </span>
        </div>
      )}

      {/* Grid of gradient options */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
        gap: 6,
      }}>
        {GRADIENT_PRESETS.map(g => {
          const isSelected = currentValue === g.key
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => onChange(property.path, g.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                border: isSelected ? '2px solid #3040D6' : '1px solid #e0e0e4',
                borderRadius: 10,
                background: isSelected ? '#f0f1ff' : '#fff',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                ...SWATCH_STYLE,
                background: g.css,
              }} />
              <span style={{
                fontSize: 13,
                fontWeight: isSelected ? 600 : 400,
                color: isSelected ? '#3040D6' : '#444',
              }}>
                {g.label}
              </span>
            </button>
          )
        })}
      </div>

      {property.description && (
        <div style={{
          fontSize: 12,
          color: '#898A9A',
          marginTop: 6,
          lineHeight: 1.4,
        }}>
          {property.description}
        </div>
      )}
    </div>
  )
}

export default GradientSelect
