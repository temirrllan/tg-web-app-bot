import React, { useState } from 'react'

const DAYS = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 7, label: 'Вс' },
]

const PRESETS = [
  { label: '📅 Каждый день',  days: [1, 2, 3, 4, 5, 6, 7] },
  { label: '💼 По будням',    days: [1, 2, 3, 4, 5] },
  { label: '🏖 В выходные',  days: [6, 7] },
]

function parseValue(val) {
  if (Array.isArray(val)) return val.map(Number).filter(Boolean)
  if (typeof val === 'string') {
    const cleaned = val.replace(/[{}\[\]]/g, '').trim()
    if (!cleaned) return []
    return cleaned.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
  }
  return []
}

const ScheduleDaysInput = ({ property, record, onChange }) => {
  const rawValue = record.params[property.path] ?? record.params['schedule_days'] ?? ''
  const [selected, setSelected] = useState(() => parseValue(rawValue))

  const commit = (days) => {
    const sorted = [...days].sort((a, b) => a - b)
    setSelected(sorted)
    // send as PostgreSQL array literal: {1,2,3}
    onChange(property.path, `{${sorted.join(',')}}`)
  }

  const toggleDay = (day) => {
    const next = selected.includes(day)
      ? selected.filter(d => d !== day)
      : [...selected, day]
    commit(next)
  }

  const isPresetActive = (presetDays) =>
    presetDays.length === selected.length &&
    presetDays.every(d => selected.includes(d))

  const btnBase = {
    cursor: 'pointer',
    border: '2px solid',
    fontFamily: 'inherit',
    transition: 'all .15s',
  }

  const presetActive = {
    ...btnBase,
    borderColor: '#3B82F6',
    backgroundColor: '#EFF6FF',
    color: '#1D4ED8',
    fontWeight: '600',
    borderRadius: '20px',
    padding: '6px 16px',
    fontSize: '13px',
  }

  const presetInactive = {
    ...btnBase,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    color: '#374151',
    fontWeight: '400',
    borderRadius: '20px',
    padding: '6px 16px',
    fontSize: '13px',
  }

  const dayActive = {
    ...btnBase,
    width: '42px',
    height: '42px',
    borderRadius: '50%',
    borderColor: '#3B82F6',
    backgroundColor: '#3B82F6',
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: '13px',
  }

  const dayInactive = {
    ...btnBase,
    width: '42px',
    height: '42px',
    borderRadius: '50%',
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    color: '#374151',
    fontWeight: '500',
    fontSize: '13px',
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Preset row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {PRESETS.map(p => (
          <button
            key={p.label}
            type="button"
            style={isPresetActive(p.days) ? presetActive : presetInactive}
            onClick={() => commit(p.days)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Individual days */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {DAYS.map(d => (
          <button
            key={d.value}
            type="button"
            style={selected.includes(d.value) ? dayActive : dayInactive}
            onClick={() => toggleDay(d.value)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Summary */}
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#6B7280' }}>
        {selected.length === 0
          ? 'Дни не выбраны'
          : `Выбрано: ${selected.map(n => DAYS[n - 1]?.label).join(', ')}`}
      </div>
    </div>
  )
}

export default ScheduleDaysInput
