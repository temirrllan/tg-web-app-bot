/* @jsxRuntime classic */
/* @jsx React.createElement */
import React from 'react'

function getPeriodLabel(hour) {
  if (hour >= 6  && hour < 12) return '🌅 Утро (06–11)'
  if (hour >= 12 && hour < 18) return '☀️ День (12–17)'
  if (hour >= 18)               return '🌙 Вечер (18–23)'
  return '🌃 Ночь (00–05)'
}

function parseToHHMM(val) {
  if (!val) return ''
  if (val.indexOf('T') !== -1) {
    var d = new Date(val)
    if (!isNaN(d.getTime())) {
      var h = String(d.getUTCHours()).padStart(2, '0')
      var m = String(d.getUTCMinutes()).padStart(2, '0')
      return h + ':' + m
    }
  }
  var match = val.match(/^(\d{1,2}):(\d{2})/)
  if (match) return match[1].padStart(2, '0') + ':' + match[2]
  return ''
}

var ReminderTimeInput = function(props) {
  var property = props.property
  var record = props.record
  var onChange = props.onChange

  var rawValue = (record.params && record.params[property.path]) || ''
  var state = React.useState(parseToHHMM(rawValue))
  var timeVal = state[0]
  var setTimeVal = state[1]

  var hour = timeVal ? parseInt(timeVal.split(':')[0], 10) : null

  function handleChange(e) {
    var val = e.target.value
    setTimeVal(val)
    onChange(property.path, val)
  }

  return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
    React.createElement('input', {
      type: 'time',
      value: timeVal,
      onChange: handleChange,
      style: {
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
      },
    }),
    hour !== null && React.createElement('span', {
      style: {
        display: 'inline-block',
        padding: '6px 14px',
        borderRadius: '20px',
        backgroundColor: '#F0FDF4',
        border: '1.5px solid #86EFAC',
        color: '#15803D',
        fontSize: '13px',
        fontWeight: '600',
      },
    }, getPeriodLabel(hour))
  )
}

export default ReminderTimeInput
