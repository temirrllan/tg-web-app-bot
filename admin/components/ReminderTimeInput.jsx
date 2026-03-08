import React, { useState } from 'react'

// Map hour → day period label
function getPeriodLabel(hour) {
  if (hour >= 6  && hour < 12) return '🌅 Утро (06–11)'
  if (hour >= 12 && hour < 18) return '☀️ День (12–17)'
  if (hour >= 18)              return '🌙 Вечер (18–23)'
  return '🌃 Ночь (00–05)'
}

// Parse stored value "HH:MM:SS" or "HH:MM" or ISO datetime → "HH:MM"
function parseToHHMM(val) {
  if (!val) return ''
  // ISO datetime
  if (val.includes('T')) {
    const d = new Date(val)
    if (!isNaN(d.getTime())) {
      const h = String(d.getUTCHours()).padStart(2, '0')
      const m = String(d.getUTCMinutes()).padStart(2, '0')
      return `${h}:${m}`
    }
  }
  // HH:MM:SS or HH:MM
  const match = val.match(/^(\d{1,2}):(\d{2})/)
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}`
  return ''
}

const ReminderTimeInput = ({ property, record, onChange }) => {
  const rawValue = record.params[property.path] ?? record.params['reminder_time'] ?? ''
  const [timeVal, setTimeVal] = useState(() => parseToHHMM(rawValue))

  const hour = timeVal ? parseInt(timeVal.split(':')[0], 10) : null

  const handleChange = (e) => {
    const val = e.target.value // "HH:MM"
    setTimeVal(val)
    onChange(property.path, val)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      {/* Native browser time picker */}
      <input
        type="time"
        value={timeVal}
        onChange={handleChange}
        style={{
          fontSize: '18px',
          padding: '8px 14px',
          borderRadius: '10px',
          border: '1.5px solid #D1D5DB',
          outline: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: '#111827',
          backgroundColor: '#FFFFFF',
          minWidth: '140px',
        }}
      />

      {/* Auto period badge */}
      {hour !== null && (
        <span style={{
          display: 'inline-block',
          padding: '6px 14px',
          borderRadius: '20px',
          backgroundColor: '#F0FDF4',
          border: '1.5px solid #86EFAC',
          color: '#15803D',
          fontSize: '13px',
          fontWeight: '600',
        }}>
          {getPeriodLabel(hour)}
        </span>
      )}
    </div>
  )
}

export default ReminderTimeInput
