import React from 'react'

// Gradient presets — must match tg-web-app-bot/config/gradientPresets.js
const GRADIENT_PRESETS = {
  sunset:   'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  ocean:    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  forest:   'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  lavender: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  peach:    'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  aurora:   'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  mint:     'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)',
  flamingo: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
  berry:    'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)',
  sky:      'linear-gradient(135deg, #c1dfc4 0%, #deecdd 100%)',
  coral:    'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  arctic:   'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
}

const FALLBACK_BG = 'linear-gradient(135deg, #e0e0e0 0%, #bdbdbd 100%)'

const PackCardPreview = ({ record }) => {
  const p = record?.params || {}

  const name             = p.name || 'Pack Name'
  const shortDescription = p.short_description || 'Short description'
  const photoUrl         = p.photo_url || ''
  const bgColorKey       = p.bg_color || ''

  const bgGradient = GRADIENT_PRESETS[bgColorKey] || FALLBACK_BG

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
        Preview
      </label>

      <div style={{
        display: 'flex',
        gap: 24,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }}>
        {/* ── Hero Preview (replicates SpecialHabitPackDetail hero) ── */}
        <div style={{
          width: 320,
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
          flexShrink: 0,
        }}>
          <div style={{
            width: '100%',
            padding: '32px 20px 24px',
            background: bgGradient,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}>
            {/* Avatar circle */}
            <div style={{
              width: 100,
              height: 100,
              borderRadius: '50%',
              overflow: 'hidden',
              marginBottom: 14,
              background: 'rgba(255,255,255,0.4)',
              boxShadow: '0 0 0 4px rgba(255,255,255,0.55)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={name}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'top center',
                    display: 'block',
                  }}
                />
              ) : (
                <span style={{ fontSize: 44, lineHeight: 1 }}>✨</span>
              )}
            </div>

            {/* Name */}
            <div style={{
              fontSize: 20,
              fontWeight: 800,
              color: '#1c1c1e',
              margin: '0 0 4px',
              letterSpacing: -0.3,
            }}>
              {name}
            </div>

            {/* Short description */}
            <div style={{
              fontSize: 14,
              color: '#555',
              margin: 0,
            }}>
              {shortDescription}
            </div>
          </div>
        </div>

        {/* ── Hint ── */}
        <div style={{
          fontSize: 13,
          color: '#898A9A',
          maxWidth: 260,
          lineHeight: 1.5,
          paddingTop: 4,
        }}>
          Так будет выглядеть шапка страницы пакета.
          Измените фото, градиент или текст — превью обновится.
        </div>
      </div>
    </div>
  )
}

export default PackCardPreview
