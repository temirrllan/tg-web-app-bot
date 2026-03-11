import React, { useState, useRef } from 'react'

const PhotoUrlInput = ({ property, record, onChange }) => {
  const currentValue = record?.params?.[property.path] ?? ''
  const [url, setUrl]         = useState(currentValue)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const fileRef               = useRef(null)
  const cameraRef             = useRef(null)

  // ── Обновляем поле вручную (URL из инпута) ──────────────────────────────
  const handleUrlChange = (e) => {
    setUrl(e.target.value)
    setError('')
    onChange(property.path, e.target.value)
  }

  // ── Загрузка файла на сервер ─────────────────────────────────────────────
  const uploadFile = async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Можно загружать только изображения')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Файл слишком большой (максимум 5 МБ)')
      return
    }

    setLoading(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/admin/api/upload', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки')

      setUrl(data.url)
      onChange(property.path, data.url)
    } catch (err) {
      setError(err.message || 'Ошибка загрузки файла')
    } finally {
      setLoading(false)
    }
  }

  const handleFileChange = (e) => uploadFile(e.target.files?.[0])

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  const [dragging, setDragging] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    uploadFile(e.dataTransfer.files?.[0])
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  const s = {
    wrap: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    },
    preview: {
      width: '100%',
      maxWidth: 280,
      height: 160,
      objectFit: 'cover',
      borderRadius: 10,
      border: '1px solid #E5E7EB',
      background: '#F9FAFB',
    },
    placeholder: {
      width: '100%',
      maxWidth: 280,
      height: 160,
      borderRadius: 10,
      border: '2px dashed #D1D5DB',
      background: '#F9FAFB',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#9CA3AF',
      fontSize: 13,
      cursor: 'pointer',
      transition: 'border-color .15s, background .15s',
    },
    placeholderActive: {
      borderColor: '#3B82F6',
      background: '#EFF6FF',
    },
    urlInput: {
      width: '100%',
      padding: '8px 12px',
      border: '1.5px solid #D1D5DB',
      borderRadius: 8,
      fontSize: 13,
      color: '#111827',
      outline: 'none',
      fontFamily: 'inherit',
      boxSizing: 'border-box',
    },
    label: {
      fontSize: 11,
      fontWeight: 600,
      color: '#6B7280',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      marginBottom: 4,
    },
    btnRow: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
    },
    btn: (color = '#3B82F6') => ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '7px 14px',
      background: color,
      color: '#fff',
      borderRadius: 8,
      border: 'none',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'inherit',
      opacity: loading ? 0.6 : 1,
      transition: 'opacity .15s',
    }),
    btnOutline: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '7px 14px',
      background: '#fff',
      color: '#374151',
      borderRadius: 8,
      border: '1.5px solid #D1D5DB',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'inherit',
    },
    err: {
      color: '#DC2626',
      fontSize: 12,
      padding: '6px 10px',
      background: '#FEF2F2',
      border: '1px solid #FECACA',
      borderRadius: 6,
    },
    spinner: {
      display: 'inline-block',
      width: 14,
      height: 14,
      border: '2px solid rgba(255,255,255,0.4)',
      borderTopColor: '#fff',
      borderRadius: '50%',
      animation: 'spin 0.6s linear infinite',
    },
  }

  return (
    <div style={s.wrap}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── Превью ── */}
      {url ? (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img
            src={url}
            alt="preview"
            style={s.preview}
            onError={(e) => { e.target.style.display = 'none' }}
          />
          <button
            type="button"
            title="Удалить изображение"
            onClick={() => { setUrl(''); onChange(property.path, '') }}
            style={{
              position: 'absolute', top: 6, right: 6,
              background: 'rgba(0,0,0,0.55)', color: '#fff',
              border: 'none', borderRadius: '50%',
              width: 24, height: 24, cursor: 'pointer',
              fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>
      ) : (
        <div
          style={{ ...s.placeholder, ...(dragging ? s.placeholderActive : {}) }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          {dragging ? '📂 Отпустите файл' : '🖼️ Превью появится здесь'}
        </div>
      )}

      {/* ── URL input ── */}
      <div>
        <div style={s.label}>URL изображения</div>
        <input
          type="text"
          value={url}
          onChange={handleUrlChange}
          placeholder="https://example.com/image.jpg"
          style={s.urlInput}
        />
      </div>

      {/* ── Кнопки загрузки ── */}
      <div>
        <div style={s.label}>Или загрузите файл</div>
        <div style={s.btnRow}>
          {/* Файл с компьютера / галерея */}
          <button
            type="button"
            disabled={loading}
            style={s.btn('#3B82F6')}
            onClick={() => fileRef.current?.click()}
          >
            {loading ? <span style={s.spinner} /> : '📁'}
            С устройства
          </button>

          {/* Камера (только мобильные) */}
          <button
            type="button"
            disabled={loading}
            style={s.btn('#10B981')}
            onClick={() => cameraRef.current?.click()}
          >
            {loading ? <span style={s.spinner} /> : '📷'}
            Камера
          </button>

          {/* Очистить */}
          {url && (
            <button
              type="button"
              style={s.btnOutline}
              onClick={() => { setUrl(''); onChange(property.path, '') }}
            >
              🗑️ Очистить
            </button>
          )}
        </div>
      </div>

      {/* ── Скрытые file inputs ── */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* ── Ошибка ── */}
      {error && <div style={s.err}>⚠️ {error}</div>}

      {/* ── Hint ── */}
      <div style={{ fontSize: 11, color: '#9CA3AF' }}>
        Форматы: JPG, PNG, WebP, GIF · Максимум 5 МБ · Можно перетащить файл
      </div>
    </div>
  )
}

export default PhotoUrlInput
