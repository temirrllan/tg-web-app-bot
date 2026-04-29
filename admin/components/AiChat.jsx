import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Box, Loader } from '@adminjs/design-system'

const styled = window.styled?.default ?? window.styled

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  blue: '#3B82F6', green: '#10B981', indigo: '#6366F1', purple: '#8B5CF6',
  pink: '#EC4899', amber: '#F59E0B', teal: '#14B8A6', rose: '#F43F5E',
  red: '#EF4444', sky: '#0EA5E9', orange: '#F97316', grey: '#6B7280',
  white: '#FFFFFF', dark: '#111827', text: '#374151', muted: '#9CA3AF',
  border: '#E5E7EB', bg: '#F3F4F6', surface: '#F9FAFB',
}

// ─── Quick actions ────────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { icon: '🔥', label: 'Топ-10 по стрику',     prompt: 'Покажи топ-10 пользователей по best_streak с активной привычкой. Колонки: имя, username, лучший стрик, текущий, премиум.' },
  { icon: '⭐', label: 'Доход за неделю',      prompt: 'Сколько Stars заработали за последние 7 дней? Разбей по дням и по источникам (пакеты vs подписки), сделай таблицу и линейный график.' },
  { icon: '💎', label: 'Конверсия в Premium', prompt: 'Какая конверсия Free → Premium за последние 30 дней? Покажи общее число users, премиумов и процент.' },
  { icon: '👥', label: 'Активные за 24ч',      prompt: 'Сколько уникальных юзеров отметили хотя бы одну привычку за последние 24 часа? Раздели по языкам (ru/en/kk).' },
  { icon: '📦', label: 'Топ пакетов',          prompt: 'Топ-5 special habit packs по числу покупок и заработанным звёздам. Покажи таблицу.' },
  { icon: '🏷️', label: 'Эффективность промо', prompt: 'Какие промокоды используются и сколько раз? Сколько подписок куплено по промо и общая скидка в Stars.' },
  { icon: '📈', label: 'Регистрации 14 дней', prompt: 'Покажи регистрации новых пользователей по дням за последние 14 дней. Сделай bar chart.' },
  { icon: '⏳', label: 'Подписки истекают',   prompt: 'Сколько подписок истекает в ближайшие 7 дней? Покажи список с user_id, plan_type и датой окончания.' },
]

// ─── Styled ───────────────────────────────────────────────────────────────────
const Page = styled(Box)`
  display: flex; height: calc(100vh - 60px); background: ${C.bg};
`
const Sidebar = styled.div`
  width: 280px; background: ${C.white}; border-right: 1px solid ${C.border};
  display: flex; flex-direction: column; flex-shrink: 0;
`
const SidebarHeader = styled.div`
  padding: 16px; border-bottom: 1px solid ${C.border};
`
const NewChatBtn = styled.button`
  width: 100%; padding: 10px 14px; border-radius: 8px; border: none; cursor: pointer;
  background: linear-gradient(135deg, ${C.indigo}, ${C.purple});
  color: #fff; font-weight: 600; font-size: 13px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  transition: opacity 0.15s, transform 0.1s;
  &:hover { opacity: 0.9; transform: translateY(-1px); }
`
const SessionList = styled.div`
  flex: 1; overflow-y: auto; padding: 8px;
`
const SessionItem = styled.div`
  padding: 10px 12px; border-radius: 8px; cursor: pointer;
  margin-bottom: 4px; transition: background 0.15s;
  background: ${({ active }) => (active ? '#EEF2FF' : 'transparent')};
  border-left: 3px solid ${({ active }) => (active ? C.indigo : 'transparent')};
  &:hover { background: ${({ active }) => (active ? '#EEF2FF' : C.surface)}; }
`
const SessionTitle = styled.div`
  font-size: 13px; color: ${C.dark}; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`
const SessionMeta = styled.div`
  font-size: 11px; color: ${C.muted}; margin-top: 2px;
`
const UsageBar = styled.div`
  padding: 12px 16px; border-top: 1px solid ${C.border};
  background: ${C.surface};
`

const Main = styled.div`
  flex: 1; display: flex; flex-direction: column; min-width: 0;
`
const ChatHeader = styled.div`
  padding: 14px 24px; border-bottom: 1px solid ${C.border}; background: ${C.white};
  display: flex; align-items: center; justify-content: space-between;
`
const ChatTitle = styled.div`
  font-size: 15px; font-weight: 700; color: ${C.dark};
`
const Messages = styled.div`
  flex: 1; overflow-y: auto; padding: 24px;
`
const MsgRow = styled.div`
  display: flex; gap: 12px; margin-bottom: 20px;
  flex-direction: ${({ isUser }) => (isUser ? 'row-reverse' : 'row')};
`
const Avatar = styled.div`
  width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 16px;
  background: ${({ isUser }) => (isUser ? C.indigo : `linear-gradient(135deg, ${C.purple}, ${C.pink})`)};
  color: #fff;
`
const Bubble = styled.div`
  max-width: 720px; padding: 12px 16px; border-radius: 12px; font-size: 14px;
  line-height: 1.55; color: ${C.dark}; word-break: break-word;
  background: ${({ isUser }) => (isUser ? '#EEF2FF' : C.white)};
  border: 1px solid ${({ isUser }) => (isUser ? '#C7D2FE' : C.border)};
  box-shadow: ${({ isUser }) => (isUser ? 'none' : '0 1px 3px rgba(0,0,0,0.04)')};
`
const ToolCallBadge = styled.div`
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
  background: #FEF3C7; color: #92400E; font-size: 11px; font-weight: 600;
  border-radius: 12px; margin: 4px 0;
`

const QuickActionsBar = styled.div`
  padding: 12px 24px 0; display: flex; gap: 8px; flex-wrap: wrap;
  background: ${C.bg};
`
const QuickBtn = styled.button`
  padding: 6px 12px; border-radius: 16px; border: 1px solid ${C.border};
  background: ${C.white}; font-size: 12px; color: ${C.text}; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  transition: all 0.15s;
  &:hover { background: #EEF2FF; border-color: ${C.indigo}; color: ${C.indigo}; }
`

const InputBox = styled.div`
  padding: 16px 24px; background: ${C.white}; border-top: 1px solid ${C.border};
  display: flex; gap: 10px; align-items: flex-end;
`
const TextArea = styled.textarea`
  flex: 1; resize: none; min-height: 44px; max-height: 200px;
  padding: 11px 14px; border: 1.5px solid ${C.border}; border-radius: 10px;
  font-size: 14px; font-family: inherit; line-height: 1.5;
  background: ${C.white}; outline: none; color: ${C.dark};
  transition: border 0.15s;
  &:focus { border-color: ${C.indigo}; }
`
const SendBtn = styled.button`
  padding: 11px 20px; border-radius: 10px; border: none; cursor: pointer;
  background: linear-gradient(135deg, ${C.indigo}, ${C.purple});
  color: #fff; font-weight: 600; font-size: 13px;
  transition: opacity 0.15s;
  &:hover { opacity: 0.9; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`

const Empty = styled.div`
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  color: ${C.muted}; padding: 40px;
`
const EmptyTitle = styled.div`
  font-size: 22px; font-weight: 700; color: ${C.dark}; margin-bottom: 4px;
`
const EmptySub = styled.div` font-size: 13px; max-width: 480px; text-align: center; line-height: 1.6; `

// ─── Markdown rendering ──────────────────────────────────────────────────────
// Minimal markdown → HTML. Handles tables, code blocks (incl. ```chart), bold,
// italic, code, headings, lists, links, line breaks. Sanitises by escaping
// HTML in non-code segments.
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderInline(s) {
  let out = escapeHtml(s)
  // Bold
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  // Inline code
  out = out.replace(/`([^`]+)`/g, '<code style="background:#F3F4F6;padding:2px 6px;border-radius:4px;font-size:12px;font-family:monospace;color:#7C3AED">$1</code>')
  // Links
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" style="color:#6366F1;text-decoration:underline">$1</a>')
  return out
}

// Tiny SVG bar/line chart (no external deps).
function ChartBlock({ spec }) {
  const data = (spec.data || []).slice(0, 50)
  if (data.length === 0) return <div style={{ color: C.muted, fontSize: 12 }}>Нет данных для графика</div>
  const max = Math.max(...data.map((d) => Number(d.value) || 0), 1)
  const W = 520, H = 180, padX = 32, padY = 24
  const innerW = W - padX * 2, innerH = H - padY * 2
  const stepX = innerW / Math.max(1, data.length - (spec.type === 'bar' ? 0 : 1))
  const colors = [C.indigo, C.teal, C.amber, C.rose]
  const color = colors[0]

  if (spec.type === 'pie') {
    const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0) || 1
    let acc = 0
    const cx = W / 2, cy = H / 2 + 6, r = 70
    const slices = data.map((d, i) => {
      const a0 = (acc / total) * 2 * Math.PI - Math.PI / 2
      acc += Number(d.value) || 0
      const a1 = (acc / total) * 2 * Math.PI - Math.PI / 2
      const large = a1 - a0 > Math.PI ? 1 : 0
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0)
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
      return (
        <path key={i}
          d={`M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`}
          fill={colors[i % colors.length]} stroke="#fff" strokeWidth={2} />
      )
    })
    return (
      <div style={{ margin: '12px 0' }}>
        {spec.title && <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{spec.title}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <svg width={W / 2} height={H} viewBox={`0 0 ${W} ${H}`}>{slices}</svg>
          <div>
            {data.map((d, i) => (
              <div key={i} style={{ fontSize: 12, color: C.text, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, background: colors[i % colors.length], borderRadius: 2, display: 'inline-block' }} />
                {d.label}: <strong>{d.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Bar / line
  return (
    <div style={{ margin: '12px 0' }}>
      {spec.title && <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{spec.title}</div>}
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ background: C.surface, borderRadius: 8 }}>
        {/* axis */}
        <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke={C.border} />
        {data.map((d, i) => {
          const v = Number(d.value) || 0
          const h = Math.max(2, (v / max) * innerH)
          const x = padX + i * stepX
          const y = H - padY - h
          if (spec.type === 'line') return null
          return (
            <g key={i}>
              <rect x={x + stepX * 0.15} y={y} width={stepX * 0.7} height={h} fill={color} opacity={0.85} />
              <text x={x + stepX / 2} y={y - 4} textAnchor="middle" fontSize={9} fontWeight={700} fill={color}>{v}</text>
              <text x={x + stepX / 2} y={H - padY + 12} textAnchor="middle" fontSize={9} fill={C.muted}>{String(d.label).slice(-5)}</text>
            </g>
          )
        })}
        {spec.type === 'line' && (() => {
          const pts = data.map((d, i) => {
            const v = Number(d.value) || 0
            const x = padX + i * stepX
            const y = H - padY - (v / max) * innerH
            return `${x},${y}`
          }).join(' ')
          return (
            <>
              <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} />
              {data.map((d, i) => {
                const v = Number(d.value) || 0
                const x = padX + i * stepX
                const y = H - padY - (v / max) * innerH
                return <circle key={i} cx={x} cy={y} r={3} fill={color} />
              })}
              {data.map((d, i) => (
                <text key={`l${i}`} x={padX + i * stepX} y={H - padY + 12} textAnchor="middle" fontSize={9} fill={C.muted}>{String(d.label).slice(-5)}</text>
              ))}
            </>
          )
        })()}
      </svg>
    </div>
  )
}

function MarkdownTable({ headers, rows }) {
  return (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ padding: '8px 12px', textAlign: 'left', borderBottom: `2px solid ${C.border}`, color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: `1px solid ${C.border}` }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: '8px 12px', color: C.text }}
                  dangerouslySetInnerHTML={{ __html: renderInline(cell) }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Parse markdown text into renderable React fragments
function parseMarkdown(md) {
  if (!md) return []
  const blocks = []
  const lines = md.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const start = i + 1
      let end = start
      while (end < lines.length && !lines[end].startsWith('```')) end++
      const code = lines.slice(start, end).join('\n')
      i = end + 1

      if (lang === 'chart') {
        try {
          const spec = JSON.parse(code)
          blocks.push({ type: 'chart', spec })
        } catch {
          blocks.push({ type: 'code', lang, code })
        }
      } else {
        blocks.push({ type: 'code', lang, code })
      }
      continue
    }

    // Markdown table
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s\-:|]+\|?\s*$/.test(lines[i + 1])) {
      const headers = line.split('|').map((s) => s.trim()).filter(Boolean)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(lines[i].split('|').map((s) => s.trim()).filter((_, idx, arr) => idx > 0 || arr[0] !== '').slice(0, headers.length))
        i++
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    // Heading
    const h = line.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2] })
      i++
      continue
    }

    // List item
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && (/^[-*]\s+/.test(lines[i]) || /^\d+\.\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^[-*]\s+|^\d+\.\s+/, ''))
        i++
      }
      blocks.push({ type: 'list', items })
      continue
    }

    // Paragraph (collapse consecutive non-empty lines)
    if (line.trim()) {
      const para = []
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```') && !lines[i].includes('|') && !/^#{1,3}\s+/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
        para.push(lines[i])
        i++
      }
      blocks.push({ type: 'paragraph', text: para.join(' ') })
      continue
    }

    i++
  }

  return blocks
}

function renderBlock(block, idx) {
  if (block.type === 'paragraph') {
    return <div key={idx} style={{ margin: '6px 0' }} dangerouslySetInnerHTML={{ __html: renderInline(block.text) }} />
  }
  if (block.type === 'heading') {
    const tag = ['h3', 'h4', 'h5'][block.level - 1] || 'h5'
    const sizes = { 1: 18, 2: 16, 3: 14 }
    return React.createElement(tag, { key: idx, style: { margin: '12px 0 6px', fontSize: sizes[block.level], fontWeight: 700, color: C.dark } }, block.text)
  }
  if (block.type === 'list') {
    return (
      <ul key={idx} style={{ margin: '6px 0', paddingLeft: 22 }}>
        {block.items.map((it, i) => (
          <li key={i} style={{ marginBottom: 3 }} dangerouslySetInnerHTML={{ __html: renderInline(it) }} />
        ))}
      </ul>
    )
  }
  if (block.type === 'code') {
    return (
      <pre key={idx} style={{ background: '#1F2937', color: '#E5E7EB', padding: '12px 14px', borderRadius: 8, overflowX: 'auto', fontSize: 12, lineHeight: 1.5, margin: '8px 0' }}>
        <code>{block.code}</code>
      </pre>
    )
  }
  if (block.type === 'chart') {
    return <ChartBlock key={idx} spec={block.spec} />
  }
  if (block.type === 'table') {
    return <MarkdownTable key={idx} headers={block.headers} rows={block.rows} />
  }
  return null
}

// Extract a CSV-able tabular section from a message (first markdown table in content)
function extractTableForCsv(content) {
  const blocks = parseMarkdown(content)
  const t = blocks.find((b) => b.type === 'table')
  if (!t) return null
  const lines = [t.headers.join(',')]
  for (const row of t.rows) {
    lines.push(row.map((c) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(','))
  }
  return lines.join('\n')
}

// ─── Streaming chat ──────────────────────────────────────────────────────────
async function* readSseStream(response) {
  const reader = response.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop()
    for (const p of parts) {
      const line = p.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const payload = line.slice(5).trim()
      if (!payload) continue
      try { yield JSON.parse(payload) } catch (e) { /* skip malformed */ }
    }
  }
}

// ─── Main component ──────────────────────────────────────────────────────────
const AiChat = () => {
  const [sessions, setSessions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [toolEvents, setToolEvents] = useState([])
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const messagesEndRef = useRef(null)

  // Load sessions + usage on mount
  useEffect(() => {
    Promise.all([
      fetch('/admin/api/ai/sessions', { credentials: 'same-origin' }).then((r) => r.json()),
      fetch('/admin/api/ai/usage', { credentials: 'same-origin' }).then((r) => r.json()),
    ]).then(([s, u]) => {
      setSessions(s.sessions || [])
      setUsage(u)
      setLoading(false)
    }).catch((e) => {
      console.error('Failed to load AI data:', e)
      setLoading(false)
    })
  }, [])

  // Load messages when active changes
  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    fetch(`/admin/api/ai/sessions/${activeId}/messages`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setMessages(d.messages || []))
      .catch((e) => console.error('Load messages:', e))
  }, [activeId])

  // Auto-scroll on new messages or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streamText, toolEvents])

  const refreshSessions = useCallback(async () => {
    const r = await fetch('/admin/api/ai/sessions', { credentials: 'same-origin' })
    const d = await r.json()
    setSessions(d.sessions || [])
  }, [])

  const refreshUsage = useCallback(async () => {
    const r = await fetch('/admin/api/ai/usage', { credentials: 'same-origin' })
    const d = await r.json()
    setUsage(d)
  }, [])

  const newChat = () => {
    setActiveId(null)
    setMessages([])
    setInput('')
    setStreamText('')
    setToolEvents([])
  }

  const deleteSession = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Удалить чат?')) return
    await fetch(`/admin/api/ai/sessions/${id}`, { method: 'DELETE', credentials: 'same-origin' })
    if (activeId === id) newChat()
    refreshSessions()
  }

  const send = async (text) => {
    const msg = (text ?? input).trim()
    if (!msg || streaming) return

    setInput('')
    setStreaming(true)
    setStreamText('')
    setToolEvents([])

    // Optimistic: append user message
    const tempUserMsg = { id: -1, role: 'user', content: msg, created_at: new Date().toISOString() }
    setMessages((m) => [...m, tempUserMsg])

    let assistantText = ''
    let currentSessionId = activeId

    try {
      // AdminJS uses express-formidable which doesn't parse JSON bodies, so we
      // send as x-www-form-urlencoded — same trick as the broadcast endpoint.
      const formBody = new URLSearchParams()
      if (activeId) formBody.set('sessionId', String(activeId))
      formBody.set('message', msg)

      const resp = await fetch('/admin/api/ai/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      })

      if (!resp.ok) {
        const errText = await resp.text()
        try { const errJson = JSON.parse(errText); throw new Error(errJson.error || errText) }
        catch { throw new Error(errText || `HTTP ${resp.status}`) }
      }

      for await (const ev of readSseStream(resp)) {
        if (ev.type === 'session') {
          currentSessionId = ev.sessionId
          if (!activeId) setActiveId(ev.sessionId)
        } else if (ev.type === 'delta') {
          assistantText += ev.text
          setStreamText(assistantText)
        } else if (ev.type === 'tool_start') {
          setToolEvents((t) => [...t, { name: ev.name, args: ev.args, status: 'running' }])
        } else if (ev.type === 'tool_end') {
          setToolEvents((t) => {
            const last = [...t]
            const idx = last.findIndex((x) => x.name === ev.name && x.status === 'running')
            if (idx >= 0) last[idx] = { ...last[idx], status: 'done', result: ev.result }
            return last
          })
        } else if (ev.type === 'done') {
          // cost arrived
        } else if (ev.type === 'end') {
          // Replace stream with final
          setMessages((m) => [
            ...m.filter((x) => x.id !== -1),
            tempUserMsg,
            { id: ev.assistantMessageId, role: 'assistant', content: assistantText, created_at: new Date().toISOString() },
          ])
          setStreamText('')
          setToolEvents([])
        } else if (ev.type === 'error') {
          throw new Error(ev.error)
        }
      }
    } catch (e) {
      setMessages((m) => [
        ...m.filter((x) => x.id !== -1),
        tempUserMsg,
        { id: -2, role: 'assistant', content: `❌ Ошибка: ${e.message}`, created_at: new Date().toISOString() },
      ])
      setStreamText('')
      setToolEvents([])
    } finally {
      setStreaming(false)
      refreshSessions()
      refreshUsage()
    }
  }

  const exportCsv = (content) => {
    const csv = extractTableForCsv(content)
    if (!csv) { alert('В этом ответе нет таблицы для экспорта.'); return }
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const usagePct = usage ? Math.min(100, Math.round((usage.costUsd / usage.capUsd) * 100)) : 0
  const usageColor = usagePct > 80 ? C.red : usagePct > 50 ? C.amber : C.green

  return (
    <Page>
      <Sidebar>
        <SidebarHeader>
          <NewChatBtn onClick={newChat}>+ Новый чат</NewChatBtn>
        </SidebarHeader>
        <SessionList>
          {loading && <Loader />}
          {!loading && sessions.length === 0 && (
            <div style={{ color: C.muted, fontSize: 12, textAlign: 'center', padding: 20 }}>
              Чатов пока нет. Создай первый.
            </div>
          )}
          {sessions.map((s) => (
            <SessionItem key={s.id} active={s.id === activeId} onClick={() => setActiveId(s.id)}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                <SessionTitle>{s.title}</SessionTitle>
                <span onClick={(e) => deleteSession(s.id, e)}
                  style={{ cursor: 'pointer', color: C.muted, fontSize: 12, padding: 2 }}
                  onMouseEnter={(e) => (e.target.style.color = C.red)}
                  onMouseLeave={(e) => (e.target.style.color = C.muted)}>
                  ✕
                </span>
              </div>
              <SessionMeta>
                {s.message_count} сообщ. · {new Date(s.updated_at).toLocaleDateString('ru-RU')}
              </SessionMeta>
              <SessionMeta style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{s.admin_email}</SessionMeta>
            </SessionItem>
          ))}
        </SessionList>
        {usage && (
          <UsageBar>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, fontWeight: 600 }}>
              РАСХОД ЗА МЕСЯЦ
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: C.dark, fontWeight: 700 }}>${usage.costUsd.toFixed(3)}</span>
              <span style={{ color: C.muted }}>из ${usage.capUsd}</span>
            </div>
            <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${usagePct}%`, height: '100%', background: usageColor, transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
              {usage.requestCount} запросов
            </div>
          </UsageBar>
        )}
      </Sidebar>

      <Main>
        <ChatHeader>
          <ChatTitle>
            {activeId ? sessions.find((s) => s.id === activeId)?.title || 'Чат' : '🤖 AI Ассистент'}
          </ChatTitle>
          <div style={{ fontSize: 11, color: C.muted }}>
            Read-only • Asia/Almaty • OpenAI
          </div>
        </ChatHeader>

        {messages.length === 0 && !streaming ? (
          <Empty>
            <div style={{ fontSize: 64 }}>🤖</div>
            <EmptyTitle>Привет! Спроси что угодно о метриках</EmptyTitle>
            <EmptySub>
              Я могу искать данные в БД, считать агрегаты, делать графики и таблицы.
              Доступ только на чтение — ничего не сломаю. Начни с быстрых вопросов или напиши свой.
            </EmptySub>
          </Empty>
        ) : (
          <Messages>
            {messages.map((m) => (
              <MsgRow key={m.id} isUser={m.role === 'user'}>
                <Avatar isUser={m.role === 'user'}>{m.role === 'user' ? '👤' : '🤖'}</Avatar>
                <Bubble isUser={m.role === 'user'}>
                  {m.role === 'user'
                    ? <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                    : (
                      <>
                        {parseMarkdown(m.content).map((b, i) => renderBlock(b, i))}
                        {extractTableForCsv(m.content) && (
                          <button onClick={() => exportCsv(m.content)}
                            style={{ marginTop: 8, padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.white, color: C.text, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                            📥 Экспорт CSV
                          </button>
                        )}
                      </>
                    )
                  }
                </Bubble>
              </MsgRow>
            ))}

            {streaming && (
              <MsgRow isUser={false}>
                <Avatar isUser={false}>🤖</Avatar>
                <Bubble isUser={false}>
                  {toolEvents.map((t, i) => (
                    <ToolCallBadge key={i}>
                      {t.status === 'running' ? '⚙️' : '✅'} {t.name}
                      {t.args?.purpose && <span style={{ color: C.grey, fontWeight: 400 }}> · {t.args.purpose}</span>}
                    </ToolCallBadge>
                  ))}
                  {streamText
                    ? parseMarkdown(streamText).map((b, i) => renderBlock(b, i))
                    : (toolEvents.length === 0 && <Loader />)
                  }
                </Bubble>
              </MsgRow>
            )}
            <div ref={messagesEndRef} />
          </Messages>
        )}

        <QuickActionsBar>
          {QUICK_ACTIONS.map((q, i) => (
            <QuickBtn key={i} onClick={() => !streaming && send(q.prompt)} disabled={streaming}>
              <span>{q.icon}</span> {q.label}
            </QuickBtn>
          ))}
        </QuickActionsBar>

        <InputBox>
          <TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Спроси о метриках... (Enter — отправить, Shift+Enter — новая строка)"
            disabled={streaming}
          />
          <SendBtn onClick={() => send()} disabled={streaming || !input.trim()}>
            {streaming ? '...' : 'Отправить'}
          </SendBtn>
        </InputBox>
      </Main>
    </Page>
  )
}

export default AiChat
