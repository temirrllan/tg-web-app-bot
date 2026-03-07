/* @jsxRuntime classic */
/* @jsx React.createElement */
import React from 'react'

var DAYS = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 7, label: 'Вс' },
]

var PRESETS = [
  { label: '📅 Каждый день', days: [1, 2, 3, 4, 5, 6, 7] },
  { label: '💼 По будням',   days: [1, 2, 3, 4, 5] },
  { label: '🏖 В выходные', days: [6, 7] },
]

function parseValue(val) {
  if (Array.isArray(val)) return val.map(Number).filter(Boolean)
  if (typeof val === 'string') {
    var cleaned = val.replace(/[{}\[\]\s]/g, '')
    if (!cleaned) return []
    return cleaned.split(',').map(Number).filter(function(n) { return !isNaN(n) && n > 0 })
  }
  return []
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false
  return a.every(function(v) { return b.indexOf(v) !== -1 })
}

var ScheduleDaysInput = function(props) {
  var property = props.property
  var record = props.record
  var onChange = props.onChange

  var rawValue = (record.params && record.params[property.path]) || ''
  var initial = parseValue(rawValue)

  var state = React.useState(initial)
  var selected = state[0]
  var setSelected = state[1]

  function commit(days) {
    var sorted = days.slice().sort(function(a, b) { return a - b })
    setSelected(sorted)
    onChange(property.path, '{' + sorted.join(',') + '}')
  }

  function toggleDay(day) {
    var next = selected.indexOf(day) !== -1
      ? selected.filter(function(d) { return d !== day })
      : selected.concat([day])
    commit(next)
  }

  function isPresetActive(presetDays) {
    return arraysEqual(presetDays, selected)
  }

  // styles
  var base = { cursor: 'pointer', border: '2px solid', fontFamily: 'inherit', background: 'none' }

  function presetStyle(active) {
    return Object.assign({}, base, {
      borderColor: active ? '#3B82F6' : '#D1D5DB',
      backgroundColor: active ? '#EFF6FF' : '#FFFFFF',
      color: active ? '#1D4ED8' : '#374151',
      fontWeight: active ? '700' : '400',
      borderRadius: '20px',
      padding: '6px 16px',
      fontSize: '13px',
    })
  }

  function dayStyle(active) {
    return Object.assign({}, base, {
      width: '42px',
      height: '42px',
      borderRadius: '50%',
      borderColor: active ? '#3B82F6' : '#D1D5DB',
      backgroundColor: active ? '#3B82F6' : '#FFFFFF',
      color: active ? '#FFFFFF' : '#374151',
      fontWeight: '700',
      fontSize: '13px',
      lineHeight: '1',
    })
  }

  var summaryText = selected.length === 0
    ? 'Дни не выбраны'
    : 'Выбрано: ' + selected.map(function(n) { return DAYS[n - 1] ? DAYS[n - 1].label : n }).join(', ')

  return React.createElement('div', { style: { padding: '4px 0' } },
    // Preset row
    React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' } },
      PRESETS.map(function(p) {
        return React.createElement('button', {
          key: p.label,
          type: 'button',
          style: presetStyle(isPresetActive(p.days)),
          onClick: function() { commit(p.days) },
        }, p.label)
      })
    ),
    // Individual days
    React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      DAYS.map(function(d) {
        var active = selected.indexOf(d.value) !== -1
        return React.createElement('button', {
          key: d.value,
          type: 'button',
          style: dayStyle(active),
          onClick: function() { toggleDay(d.value) },
        }, d.label)
      })
    ),
    // Summary
    React.createElement('div', {
      style: { marginTop: '8px', fontSize: '12px', color: '#6B7280' }
    }, summaryText)
  )
}

export default ScheduleDaysInput
