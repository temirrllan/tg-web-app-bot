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
  const priceStars       = Number(p.price_stars) || 0
  const originalPrice    = Number(p.original_price_stars) || 0

  const bgGradient = GRADIENT_PRESETS[bgColorKey] || FALLBACK_BG
  const isFree     = priceStars === 0
  const hasDiscount = originalPrice > 0 && originalPrice > priceStars

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
        {/* ── Card Preview (replicates frontend PackCard) ── */}
        <div style={{
          width: 180,
          background: '#fff',
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 2px 10px rgba(0,0,0,0.07)',
          flexShrink: 0,
        }}>
          {/* Image area with gradient */}
          <div style={{
            width: '100%',
            aspectRatio: '1 / 1',
            background: bgGradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
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
              <span style={{ fontSize: 52, lineHeight: 1 }}>✨</span>
            )}
          </div>

          {/* Info area */}
          <div style={{
            padding: '10px 13px 13px',
            background: '#fff',
          }}>
            <p style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#1c1c1e',
              margin: '0 0 2px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.3,
            }}>
              {name}
            </p>
            <p style={{
              fontSize: 12,
              color: '#8e8e93',
              margin: '0 0 8px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.3,
            }}>
              {shortDescription}
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {isFree ? (
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1c1c1e' }}>FREE</span>
              ) : (
                <>
                  {hasDiscount && (
                    <span style={{ fontSize: 12, color: '#aaa', textDecoration: 'line-through' }}>
                      ⭐ {originalPrice}
                    </span>
                  )}
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1c1c1e' }}>
                    ⭐ {priceStars}
                  </span>
                </>
              )}
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
          Так карточка будет выглядеть в магазине Special Habits.
          Заполните поля выше — превью обновится автоматически.
        </div>
      </div>
    </div>
  )
}

export default PackCardPreview
