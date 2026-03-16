import React, { useState, useEffect } from 'react'

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
  // AdminJS (via flat lib) may unflatten dot-keys → plain object {"0":1,"1":2}
  if (val !== null && val !== undefined && typeof val === 'object') {
    return Object.values(val).map(Number).filter(Boolean)
  }
  if (typeof val === 'string') {
    const cleaned = val.replace(/[{}\[\]]/g, '').trim()
    if (!cleaned) return []
    return cleaned.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
  }
  return []
}

// @adminjs/sql stores INTEGER[] columns as indexed keys in record.params.
// Depending on the AdminJS version the flat library may unflatten them before
// reaching the component, so we handle all three forms:
//   1. Already an array:  schedule_days = [1,2,3]
//   2. Object with num keys: schedule_days = {"0":1,"1":2}  (flat.unflatten)
//   3. Dot-notation flat keys: schedule_days.0 = 1, schedule_days.1 = 2
function getScheduleDaysFromParams(params) {
  const direct = params['schedule_days']
  if (Array.isArray(direct) && direct.length > 0) return direct
  if (direct !== null && direct !== undefined && typeof direct === 'object' && Object.keys(direct).length > 0) {
    return Object.values(direct)
  }
  if (typeof direct === 'string' && direct.trim() !== '') return direct
  // Flat dot-notation keys
  const indexed = []
  let i = 0
  while (params[`schedule_days.${i}`] !== undefined) {
    indexed.push(params[`schedule_days.${i}`])
    i++
  }
  return indexed.length > 0 ? indexed : ''
}

const ScheduleDaysInput = ({ property, record, onChange }) => {
  const rawValue = record.params[property.path] ?? getScheduleDaysFromParams(record.params) ?? ''
  const isNew = !record.params.id

  const [selected, setSelected] = useState(() => {
    const parsed = parseValue(rawValue)
    // For new records default to all 7 days (matches DB DEFAULT ARRAY[1..7])
    return parsed.length > 0 ? parsed : (isNew ? [1, 2, 3, 4, 5, 6, 7] : [])
  })

  // Push initial value into AdminJS form state so it's included in payload
  // even if the user never touches the component.
  useEffect(() => {
    onChange(property.path, `{${selected.join(',')}}`)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
