import React, { useEffect, useState } from 'react'
import { Box, Loader } from '@adminjs/design-system'

// window.styled — это { default: styledFn }, Rollup interop не нужен
const styled = window.styled?.default ?? window.styled

// ─── Палитра ──────────────────────────────────────────────────────────────────
const C = {
  blue:    '#3B82F6',
  green:   '#10B981',
  indigo:  '#6366F1',
  pink:    '#EC4899',
  amber:   '#F59E0B',
  yellow:  '#FBBF24',
  purple:  '#8B5CF6',
  teal:    '#14B8A6',
  rose:    '#F43F5E',
  sky:     '#0EA5E9',
  orange:  '#F97316',
  lime:    '#84CC16',
  grey:    '#6B7280',
  greyBg:  '#F9FAFB',
  border:  '#E5E7EB',
  white:   '#FFFFFF',
  dark:    '#111827',
  text:    '#374151',
  muted:   '#9CA3AF',
}

// ─── Styled components ────────────────────────────────────────────────────────
const Page = styled(Box)`
  padding: 24px 32px;
  background: #F3F4F6;
  min-height: 100vh;
`
const Hero = styled.div`
  background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #1e3a5f 100%);
  border-radius: 16px; padding: 36px 44px;
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 24px; overflow: hidden; position: relative;
  &::before { content:''; position:absolute; top:-80px; right:80px; width:320px; height:320px; border-radius:50%; background:rgba(99,102,241,0.12); }
  &::after  { content:''; position:absolute; bottom:-100px; left:25%; width:250px; height:250px; border-radius:50%; background:rgba(16,185,129,0.07); }
`
const HeroLeft  = styled.div` display:flex; flex-direction:column; gap:10px; z-index:1; `
const HeroPill  = styled.span`
  display:inline-flex; align-items:center; gap:6px;
  background:rgba(99,102,241,0.3); border:1px solid rgba(99,102,241,0.5);
  color:#c7d2fe; font-size:12px; font-weight:600; letter-spacing:0.5px;
  padding:4px 14px; border-radius:20px; width:fit-content;
`
const HeroTitle = styled.h1` margin:0; color:#fff; font-size:26px; font-weight:700; line-height:1.3; `
const HeroSub   = styled.p`  margin:0; color:rgba(255,255,255,0.55); font-size:13px; line-height:1.6; max-width:420px; `
const HeroEmoji = styled.div` font-size:88px; z-index:1; filter:drop-shadow(0 8px 24px rgba(0,0,0,0.4)); flex-shrink:0; margin-left:20px; `

const SectionLabel = styled.p`
  margin:0 0 12px; font-size:11px; font-weight:700; letter-spacing:1.2px;
  text-transform:uppercase; color:${C.muted};
`
const Grid = styled.div`
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(${({ min }) => min || 180}px, 1fr));
  gap:${({ gap }) => gap || 14}px;
  margin-bottom:${({ mb }) => mb || 24}px;
`
const TwoCol = styled.div`
  display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px;
  @media(max-width:900px){ grid-template-columns:1fr; }
`
const ThreeCol = styled.div`
  display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-bottom:24px;
  @media(max-width:900px){ grid-template-columns:1fr; }
`

const Card = styled.div`
  background:${C.white}; border-radius:12px; padding:20px 18px;
  display:flex; flex-direction:column;
  box-shadow:0 1px 3px rgba(0,0,0,0.06); border:1px solid ${C.border};
  position:relative; overflow:hidden;
  transition:box-shadow 0.15s, transform 0.15s;
  &:hover{ box-shadow:0 6px 20px rgba(0,0,0,0.09); transform:translateY(-2px); }
  &::before{
    content:''; position:absolute; top:0; left:0; right:0; height:3px;
    background:${({ accent }) => accent || C.indigo};
    border-radius:12px 12px 0 0;
  }
`
const CardIcon  = styled.div` font-size:24px; margin-bottom:10px; line-height:1; `
const CardValue = styled.div` font-size:28px; font-weight:800; color:${C.dark}; line-height:1; margin-bottom:4px; `
const CardLabel = styled.div` font-size:12px; color:${C.muted}; line-height:1.4; `
const CardSub   = styled.span`
  display:inline-block; margin-top:6px; font-size:11px; font-weight:600;
  color:${({ positive }) => positive ? C.green : C.rose};
`

const WideCard = styled.div`
  background:${C.white}; border-radius:12px; padding:24px;
  box-shadow:0 1px 3px rgba(0,0,0,0.06); border:1px solid ${C.border};
  margin-bottom:0;
`
const CardTitle = styled.h3` margin:0 0 16px; font-size:14px; font-weight:700; color:${C.dark}; `

const ErrBox = styled.div`
  background:#fef2f2; border:1px solid #fecaca; border-radius:10px;
  padding:14px 18px; color:#b91c1c; display:flex; align-items:center;
  gap:10px; margin-bottom:20px; font-size:13px;
`
const Badge = styled.span`
  display:inline-flex; align-items:center; padding:3px 10px; border-radius:20px;
  font-size:11px; font-weight:600;
  background:${({ bg }) => bg || '#EEF2FF'};
  color:${({ col }) => col || C.indigo};
`

// ─── Мини бар-чарт ───────────────────────────────────────────────────────────
const BarChart = ({ data, valueKey = 'count', color = C.indigo, height = 70, showDates = true }) => {
  if (!data || data.length === 0) return (
    <div style={{ height, display:'flex', alignItems:'center', justifyContent:'center', color:C.muted, fontSize:12 }}>
      Нет данных
    </div>
  )
  const max = Math.max(...data.map(d => Number(d[valueKey]) || 0), 1)
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:3, height }}>
      {data.map((d, i) => {
        const val = Number(d[valueKey]) || 0
        const h   = Math.max(Math.round((val / max) * (height - 18)), 3)
        const label = d.date ? String(d.date).slice(5) : ''
        return (
          <div key={i} title={`${label}: ${val}`}
            style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
            <div style={{ width:'100%', height:h, background:color, borderRadius:'3px 3px 0 0', opacity:0.85 }} />
            {showDates && data.length <= 14 && (
              <span style={{ fontSize:9, color:C.muted, transform:'rotate(-45deg)', whiteSpace:'nowrap', transformOrigin:'top center', marginTop:2 }}>
                {label}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Двойной бар-чарт (completion) ───────────────────────────────────────────
const DualBarChart = ({ data, height = 70 }) => {
  if (!data || data.length === 0) return (
    <div style={{ height, display:'flex', alignItems:'center', justifyContent:'center', color:C.muted, fontSize:12 }}>Нет данных</div>
  )
  const max = Math.max(...data.map(d => Number(d.total) || 0), 1)
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:3, height }}>
      {data.map((d, i) => {
        const total     = Number(d.total) || 0
        const completed = Number(d.completed) || 0
        const hTotal    = Math.max(Math.round((total / max) * (height - 18)), 3)
        const hDone     = total > 0 ? Math.round((completed / total) * hTotal) : 0
        const label     = d.date ? String(d.date).slice(5) : ''
        return (
          <div key={i} title={`${label}: ${completed}/${total}`}
            style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
            <div style={{ width:'100%', height:hTotal, borderRadius:'3px 3px 0 0', overflow:'hidden', display:'flex', flexDirection:'column-reverse' }}>
              <div style={{ height:hDone, background:C.green, transition:'height 0.3s' }} />
              <div style={{ flex:1, background:C.border }} />
            </div>
            <span style={{ fontSize:9, color:C.muted, transform:'rotate(-45deg)', whiteSpace:'nowrap', transformOrigin:'top center', marginTop:2 }}>
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Горизонтальный бар ───────────────────────────────────────────────────────
const HBar = ({ label, value, total, color, icon }) => {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, alignItems:'center' }}>
        <span style={{ fontSize:12, color:C.text, fontWeight:600, display:'flex', alignItems:'center', gap:4 }}>
          {icon && <span>{icon}</span>}{label}
        </span>
        <span style={{ fontSize:12, color:C.muted }}>{value.toLocaleString()} <span style={{ color:C.muted, fontSize:10 }}>({pct}%)</span></span>
      </div>
      <div style={{ height:6, background:C.border, borderRadius:3, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color || C.indigo, borderRadius:3, transition:'width 0.6s ease' }} />
      </div>
    </div>
  )
}

// ─── Completion ring ──────────────────────────────────────────────────────────
const Ring = ({ completed, total, label = 'выполнено', size = 100, color = C.teal }) => {
  const pct   = total > 0 ? Math.round((completed / total) * 100) : 0
  const r     = size / 2 - 8
  const circ  = 2 * Math.PI * r
  const dash  = (pct / 100) * circ
  return (
    <div style={{ display:'flex', alignItems:'center', gap:16 }}>
      <svg width={size} height={size} style={{ flexShrink:0 }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={9} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={9}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} style={{ transition:'stroke-dasharray 0.6s ease' }}
        />
        <text x={size/2} y={size/2 - 5} textAnchor="middle" fontSize={size/6} fontWeight={800} fill={C.dark}>{pct}%</text>
        <text x={size/2} y={size/2 + 11} textAnchor="middle" fontSize={size/12} fill={C.muted}>{label}</text>
      </svg>
      <div>
        <div style={{ fontSize:13, color:C.text, marginBottom:4 }}>
          <span style={{ fontWeight:800, color }}>{completed.toLocaleString()}</span> выполнено
        </div>
        <div style={{ fontSize:13, color:C.text }}>
          <span style={{ fontWeight:700 }}>{total.toLocaleString()}</span> всего
        </div>
      </div>
    </div>
  )
}

// ─── Таблица топ пакетов ──────────────────────────────────────────────────────
const PacksTable = ({ packs }) => {
  if (!packs || packs.length === 0) return (
    <p style={{ color:C.muted, fontSize:13, textAlign:'center', padding:'20px 0' }}>Нет данных</p>
  )
  const medalColors = [C.amber, C.muted, '#cd7f32']
  return (
    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
      <thead>
        <tr>
          {['Пакет', 'Покупок', '⭐ Stars'].map(h => (
            <th key={h} style={{ textAlign:'left', padding:'6px 8px', color:C.muted, fontWeight:600, fontSize:11, textTransform:'uppercase', letterSpacing:'0.5px', borderBottom:`1px solid ${C.border}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {packs.map((p, i) => (
          <tr key={i} style={{ borderBottom:`1px solid ${C.border}` }}>
            <td style={{ padding:'10px 8px', color:C.text, fontWeight:500 }}>
              <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:22, height:22, background:medalColors[i] || C.border, borderRadius:4, color:'#fff', fontSize:11, fontWeight:800, marginRight:8 }}>{i+1}</span>
              {p.name}
            </td>
            <td style={{ padding:'10px 8px', color:C.dark, fontWeight:700 }}>{p.purchases}</td>
            <td style={{ padding:'10px 8px', color:C.amber, fontWeight:700 }}>{(p.stars || 0).toLocaleString()} ⭐</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = v => (v !== undefined && v !== null ? Number(v).toLocaleString() : '—')
const fmtF = v => (v !== undefined && v !== null && !isNaN(v) ? Number(v).toFixed(1) : '—')

function fillDays(data, n = 14, valueKey = 'count') {
  const map = {}
  ;(data || []).forEach(d => { map[String(d.date).slice(0,10)] = d })
  const result = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    result.push(map[key] || { date: key, [valueKey]: 0, count: 0 })
  }
  return result
}

const PERIOD_LABEL = { morning:'🌅 Утро', afternoon:'☀️ День', evening:'🌙 Вечер', night:'🌃 Ночь', unknown:'❓ Н/Д' }
const SCHEDULE_LABEL = { daily:'📅 Каждый день', weekly:'📆 Еженедельно', custom:'⚙️ Своё' }
const PLAN_LABEL = {
  '6_months':'6 месяцев', '1_year':'1 год', 'lifetime':'Навсегда',
  '3_months':'3 месяца', '1_month':'1 месяц', 'legacy':'Старый', 'free':'Бесплатно'
}

// ─── Broadcast ────────────────────────────────────────────────────────────────
const BroadcastCard = styled.div`
  background: ${C.white}; border-radius: 16px; padding: 28px 28px 24px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.07); border: 1px solid ${C.border};
  margin-bottom: 24px;
`
const BroadcastTextarea = styled.textarea`
  width: 100%; min-height: 120px; padding: 14px 16px;
  font-size: 14px; font-family: inherit; line-height: 1.6;
  border: 1.5px solid ${C.border}; border-radius: 10px;
  background: #FAFAFA; color: ${C.dark}; resize: vertical;
  outline: none; transition: border 0.15s;
  box-sizing: border-box;
  &:focus { border-color: ${C.indigo}; background: #fff; }
`
const BroadcastPreview = styled.div`
  padding: 14px 16px; border: 1.5px dashed ${C.border}; border-radius: 10px;
  background: #F8F9FF; font-size: 14px; line-height: 1.6; color: ${C.dark};
  min-height: 80px; white-space: pre-wrap; word-break: break-word;
  font-family: 'Segoe UI', sans-serif;
`
const BroadcastBtn = styled.button`
  padding: 11px 28px; border-radius: 10px; border: none; cursor: pointer;
  font-size: 14px; font-weight: 700; letter-spacing: 0.2px;
  transition: opacity 0.15s, transform 0.1s;
  &:hover { opacity: 0.85; transform: translateY(-1px); }
  &:active { transform: translateY(0); }
  &:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
`

const BroadcastSection = () => {
  const [msg, setMsg]           = useState('')
  const [recipientCount, setRC] = useState(null)
  const [step, setStep]         = useState('compose') // compose | confirm | sending | done | error
  const [result, setResult]     = useState(null)
  const [errMsg, setErrMsg]     = useState('')

  useEffect(() => {
    fetch('/admin/api/broadcast/count', { credentials: 'same-origin' })
      .then(r => r.json()).then(d => setRC(d.total)).catch(() => {})
  }, [])

  const handleConfirm = () => { if (msg.trim()) setStep('confirm') }
  const handleCancel  = () => setStep('compose')

  const handleSend = async () => {
    setStep('sending')
    try {
      const r = await fetch('/admin/api/broadcast', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ message: msg.trim() })
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setResult(data)
      setStep('done')
    } catch (e) {
      setErrMsg(e.message)
      setStep('error')
    }
  }

  const reset = () => { setMsg(''); setStep('compose'); setResult(null); setErrMsg('') }

  // Simple HTML → displayable (strip tags for preview safety)
  const previewHtml = msg
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g,'<b>$1</b>')
    .replace(/__(.*?)__/g,'<i>$1</i>')

  return (
    <BroadcastCard>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:42, height:42, borderRadius:12, background:`linear-gradient(135deg,${C.indigo},${C.purple})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>📣</div>
          <div>
            <div style={{ fontWeight:700, fontSize:16, color:C.dark }}>Рассылка пользователям</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
              {recipientCount !== null ? `${recipientCount.toLocaleString()} получателей` : 'загрузка...'}
            </div>
          </div>
        </div>
        <div style={{ fontSize:11, padding:'4px 10px', borderRadius:20, background:'rgba(99,102,241,0.1)', color:C.indigo, fontWeight:600 }}>HTML поддерживается</div>
      </div>

      {/* ── COMPOSE ── */}
      {step === 'compose' && (
        <>
          <div style={{ fontSize:12, fontWeight:600, color:C.muted, textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:8 }}>Текст сообщения</div>
          <BroadcastTextarea
            value={msg}
            onChange={e => setMsg(e.target.value)}
            placeholder={'Введите сообщение...\n\nПоддерживается HTML: <b>жирный</b>, <i>курсив</i>, <a href="...">ссылка</a>'}
          />
          <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10 }}>
            <BroadcastBtn
              style={{ background:`linear-gradient(135deg,${C.indigo},${C.purple})`, color:'#fff', flexShrink:0 }}
              onClick={handleConfirm}
              disabled={!msg.trim()}
            >
              Предварительный просмотр →
            </BroadcastBtn>
            <span style={{ fontSize:12, color:C.muted }}>{msg.length} символов</span>
          </div>
        </>
      )}

      {/* ── CONFIRM ── */}
      {step === 'confirm' && (
        <>
          <div style={{ fontSize:12, fontWeight:600, color:C.muted, textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:8 }}>Предпросмотр (как увидит пользователь)</div>
          <BroadcastPreview dangerouslySetInnerHTML={{ __html: msg.replace(/\n/g,'<br/>') }} />
          <div style={{ marginTop:8, padding:'10px 14px', background:'#FFF8E1', borderRadius:8, fontSize:13, color:'#92400E', border:'1px solid #FDE68A' }}>
            ⚠️ Сообщение будет отправлено <strong>{recipientCount !== null ? recipientCount.toLocaleString() : '...'} пользователям</strong>. Это действие нельзя отменить.
          </div>
          <div style={{ display:'flex', gap:10, marginTop:14 }}>
            <BroadcastBtn
              style={{ background:`linear-gradient(135deg,#10B981,#059669)`, color:'#fff' }}
              onClick={handleSend}
            >
              ✅ Отправить всем
            </BroadcastBtn>
            <BroadcastBtn
              style={{ background:C.border, color:C.text }}
              onClick={handleCancel}
            >
              ← Изменить
            </BroadcastBtn>
          </div>
        </>
      )}

      {/* ── SENDING ── */}
      {step === 'sending' && (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'32px 0', gap:16 }}>
          <div style={{ width:48, height:48, border:`4px solid ${C.border}`, borderTopColor:C.indigo, borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
          <div style={{ fontSize:14, color:C.muted }}>Отправка сообщений... Пожалуйста, не закрывайте страницу</div>
          <style>{`@keyframes spin { to { transform:rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── DONE ── */}
      {step === 'done' && result && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'16px 20px', background:'#ECFDF5', borderRadius:12, border:'1px solid #A7F3D0' }}>
            <span style={{ fontSize:28 }}>✅</span>
            <div>
              <div style={{ fontWeight:700, fontSize:15, color:'#065F46' }}>Рассылка завершена!</div>
              <div style={{ fontSize:13, color:'#047857', marginTop:2 }}>
                Доставлено: <strong>{result.successCount.toLocaleString()}</strong> &nbsp;·&nbsp;
                Ошибки: <strong style={{ color: result.failCount > 0 ? '#DC2626' : '#047857' }}>{result.failCount}</strong> &nbsp;·&nbsp;
                Всего: <strong>{result.total.toLocaleString()}</strong>
              </div>
            </div>
          </div>
          <BroadcastBtn style={{ background:C.indigo, color:'#fff', alignSelf:'flex-start' }} onClick={reset}>
            Новая рассылка
          </BroadcastBtn>
        </div>
      )}

      {/* ── ERROR ── */}
      {step === 'error' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ padding:'16px 20px', background:'#FEF2F2', borderRadius:12, border:'1px solid #FCA5A5', fontSize:14, color:'#7F1D1D' }}>
            ❌ Ошибка: {errMsg}
          </div>
          <BroadcastBtn style={{ background:C.border, color:C.text, alignSelf:'flex-start' }} onClick={reset}>
            ← Попробовать снова
          </BroadcastBtn>
        </div>
      )}
    </BroadcastCard>
  )
}

// ─── Maintenance Toggle ──────────────────────────────────────────────────────
const MaintenanceToggle = () => {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/admin/api/maintenance/status', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => { setEnabled(d.maintenance); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const toggle = async () => {
    setLoading(true)
    try {
      const r = await fetch('/admin/api/maintenance/toggle', {
        method: 'POST', credentials: 'same-origin'
      })
      const d = await r.json()
      setEnabled(d.maintenance)
    } catch (e) {
      console.error('Maintenance toggle error:', e)
    }
    setLoading(false)
  }

  return (
    <div style={{
      background: enabled ? '#FEF2F2' : C.white,
      border: `1px solid ${enabled ? '#FECACA' : C.border}`,
      borderRadius: 12, padding: '16px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 24, transition: 'all 0.2s'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          background: enabled
            ? 'linear-gradient(135deg, #EF4444, #F97316)'
            : 'linear-gradient(135deg, #10B981, #14B8A6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
        }}>
          {enabled ? '🔧' : '✅'}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.dark }}>
            Режим обслуживания
          </div>
          <div style={{ fontSize: 12, color: enabled ? '#B91C1C' : C.muted, marginTop: 2 }}>
            {enabled ? 'Приложение недоступно для пользователей' : 'Приложение работает нормально'}
          </div>
        </div>
      </div>
      <button
        onClick={toggle}
        disabled={loading}
        style={{
          padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
          fontWeight: 600, fontSize: 13, color: '#fff',
          background: enabled
            ? 'linear-gradient(135deg, #10B981, #14B8A6)'
            : 'linear-gradient(135deg, #EF4444, #F97316)',
          opacity: loading ? 0.5 : 1,
          transition: 'all 0.15s'
        }}
      >
        {loading ? '...' : enabled ? 'Выключить' : 'Включить'}
      </button>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
const Dashboard = () => {
  const [stats, setStats]     = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/admin/api/stats', { credentials:'same-origin' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => { setStats(data); setLoading(false) })
      .catch(e  => { setError(e.message); setLoading(false) })
  }, [])

  return (
    <Page>

      {/* ── Hero ── */}
      <Hero>
        <HeroLeft>
          <HeroPill>✦ Habit Tracker · Admin Panel</HeroPill>
          <HeroTitle>Панель аналитики</HeroTitle>
          <HeroSub>
            Пользователи, привычки, монетизация, активность —<br />
            полная статистика в реальном времени.
          </HeroSub>
        </HeroLeft>
        <HeroEmoji>📊</HeroEmoji>
      </Hero>

      {/* ── Maintenance ── */}
      <MaintenanceToggle />

      {/* ── Broadcast ── */}
      <BroadcastSection />

      {error && <ErrBox>❌ Ошибка загрузки: {error}</ErrBox>}

      {loading && !error && (
        <div style={{ display:'flex', justifyContent:'center', padding:80 }}>
          <Loader />
        </div>
      )}

      {!loading && stats && (() => {
        const reg14  = fillDays(stats.weekly_registrations, 14)
        const comp14 = fillDays(stats.completion_14d, 14, 'total').map(d => {
          const found = (stats.completion_14d || []).find(x => String(x.date).slice(0,10) === d.date)
          return found || d
        })
        const rev30  = stats.revenue_30d || []
        const rem14  = fillDays(stats.reminders_14d, 14, 'sent').map(d => {
          const found = (stats.reminders_14d || []).find(x => String(x.date).slice(0,10) === d.date)
          return found || d
        })

        const totalLang = stats.total_users || ((stats.users_ru || 0) + (stats.users_en || 0) + (stats.users_kk || 0))
        const habSched  = stats.habits_by_schedule || []
        const habPeriod = stats.habits_by_period || []
        const habCat    = stats.habits_by_category || []
        const totalCat  = habCat.reduce((s, x) => s + (x.count || 0), 0)
        const subPlans  = stats.subscription_plans || []
        const totalSub  = subPlans.reduce((s, x) => s + (x.count || 0), 0)
        const habSchedTotal = habSched.reduce((s, x) => s + (x.count || 0), 0)
        const habPeriodTotal = habPeriod.reduce((s, x) => s + (x.count || 0), 0)

        return (
          <>
            {/* ── KPI: Пользователи ── */}
            <SectionLabel>Аудитория</SectionLabel>
            <Grid min={160} mb={16}>
              <Card accent={C.blue}>
                <CardIcon>👥</CardIcon>
                <CardValue>{fmt(stats.total_users)}</CardValue>
                <CardLabel>Всего пользователей</CardLabel>
                <CardSub positive>+{fmt(stats.new_users_today)} сегодня</CardSub>
              </Card>
              <Card accent={C.green}>
                <CardIcon>📅</CardIcon>
                <CardValue>{fmt(stats.dau)}</CardValue>
                <CardLabel>DAU (сегодня)</CardLabel>
                <CardSub positive>WAU: {fmt(stats.wau)} · MAU: {fmt(stats.mau)}</CardSub>
              </Card>
              <Card accent={C.pink}>
                <CardIcon>💎</CardIcon>
                <CardValue>{fmt(stats.premium_users)}</CardValue>
                <CardLabel>Premium пользователей</CardLabel>
                <CardSub positive>{stats.premium_rate}% от всех</CardSub>
              </Card>
              <Card accent={C.indigo}>
                <CardIcon>📈</CardIcon>
                <CardValue>{fmt(stats.new_users_week)}</CardValue>
                <CardLabel>Новых за 7 дней</CardLabel>
                <CardSub positive>За 30 дн: {fmt(stats.new_users_month)}</CardSub>
              </Card>
            </Grid>

            {/* ── KPI: Привычки ── */}
            <SectionLabel>Привычки</SectionLabel>
            <Grid min={155} mb={24}>
              <Card accent={C.teal}>
                <CardIcon>✅</CardIcon>
                <CardValue>{fmt(stats.active_habits)}</CardValue>
                <CardLabel>Активных привычек</CardLabel>
                <CardSub positive>Всего: {fmt(stats.total_habits)}</CardSub>
              </Card>
              <Card accent={C.sky}>
                <CardIcon>📊</CardIcon>
                <CardValue>{fmtF(stats.avg_habits_per_user)}</CardValue>
                <CardLabel>Ср. привычек на юзера</CardLabel>
                <CardSub positive>Спец: {fmt(stats.special_habits)}</CardSub>
              </Card>
              <Card accent={C.purple}>
                <CardIcon>🔥</CardIcon>
                <CardValue>{fmtF(stats.avg_streak)}</CardValue>
                <CardLabel>Средний стрик</CardLabel>
                <CardSub positive>Рекорд: {fmt(stats.max_streak)} дн.</CardSub>
              </Card>
              <Card accent={C.rose}>
                <CardIcon>🚫</CardIcon>
                <CardValue>{fmt(stats.bad_habits)}</CardValue>
                <CardLabel>Вредных привычек</CardLabel>
                <CardSub positive>Шеринг: {fmt(stats.shared_habits_count)}</CardSub>
              </Card>
            </Grid>

            {/* ── Графики: Регистрации + Revenue ── */}
            <SectionLabel>Рост и доход</SectionLabel>
            <TwoCol>
              <WideCard>
                <CardTitle>👥 Новые пользователи (14 дней)</CardTitle>
                <BarChart data={reg14} color={C.blue} height={80} />
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:16, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize:20, fontWeight:800, color:C.blue }}>{fmt(stats.new_users_today)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>сегодня</div>
                  </div>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:20, fontWeight:800, color:C.indigo }}>{fmt(stats.new_users_week)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>за 7 дней</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:20, fontWeight:800, color:C.dark }}>{fmt(stats.new_users_month)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>за 30 дней</div>
                  </div>
                </div>
              </WideCard>

              <WideCard>
                <CardTitle>💰 Доход ⭐ Stars (30 дней)</CardTitle>
                <BarChart data={rev30} valueKey="total" color={C.amber} height={80} showDates={false} />
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:16, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize:20, fontWeight:800, color:C.amber }}>{fmt(stats.total_stars_earned)} ⭐</div>
                    <div style={{ fontSize:11, color:C.muted }}>всего заработано</div>
                  </div>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:20, fontWeight:800, color:C.yellow }}>{fmt(stats.total_stars_packs)} ⭐</div>
                    <div style={{ fontSize:11, color:C.muted }}>из пакетов</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:20, fontWeight:800, color:C.orange }}>{fmt(stats.total_stars_subscriptions)} ⭐</div>
                    <div style={{ fontSize:11, color:C.muted }}>подписки</div>
                  </div>
                </div>
              </WideCard>
            </TwoCol>

            {/* ── Графики: Completion + Ремайндеры ── */}
            <SectionLabel>Активность</SectionLabel>
            <TwoCol>
              <WideCard>
                <CardTitle>✅ Выполнение привычек (14 дней)</CardTitle>
                <DualBarChart data={comp14} height={80} />
                <div style={{ display:'flex', gap:16, marginTop:12 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ width:12, height:12, background:C.green, borderRadius:2 }} />
                    <span style={{ fontSize:11, color:C.muted }}>Выполнено</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ width:12, height:12, background:C.border, borderRadius:2 }} />
                    <span style={{ fontSize:11, color:C.muted }}>Всего</span>
                  </div>
                  <div style={{ marginLeft:'auto', fontSize:12, color:C.text, fontWeight:600 }}>
                    Сегодня: {fmt(stats.marks_completed_today)} / {fmt(stats.marks_today)}
                  </div>
                </div>
              </WideCard>

              <WideCard>
                <CardTitle>🔔 Напоминания (14 дней)</CardTitle>
                <BarChart data={rem14} valueKey="sent" color={C.purple} height={80} />
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:16, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize:20, fontWeight:800, color:C.purple }}>{fmt(stats.reminders_today)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>сегодня</div>
                  </div>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:20, fontWeight:800, color:C.indigo }}>{fmt(stats.reminders_week)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>за 7 дней</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:20, fontWeight:800, color:C.green }}>{stats.reminder_response_rate}%</div>
                    <div style={{ fontSize:11, color:C.muted }}>отклик</div>
                  </div>
                </div>
              </WideCard>
            </TwoCol>

            {/* ── Привычки: по категориям + по расписанию/периоду ── */}
            <SectionLabel>Структура привычек</SectionLabel>
            <TwoCol>
              <WideCard>
                <CardTitle>🗂️ По категориям</CardTitle>
                {habCat.length === 0
                  ? <p style={{ color:C.muted, fontSize:13, textAlign:'center', padding:'20px 0' }}>Нет данных</p>
                  : habCat.map((c, i) => (
                    <HBar key={i} label={c.name} value={c.count || 0} total={totalCat} color={c.color || C.indigo} />
                  ))
                }
              </WideCard>

              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                <WideCard>
                  <CardTitle>📅 По расписанию</CardTitle>
                  {habSched.map((s, i) => (
                    <HBar key={i} label={SCHEDULE_LABEL[s.schedule_type] || s.schedule_type} value={s.count || 0} total={habSchedTotal} color={[C.blue, C.teal, C.purple][i] || C.grey} />
                  ))}
                </WideCard>
                <WideCard>
                  <CardTitle>⏰ По периоду дня</CardTitle>
                  {habPeriod.map((p, i) => (
                    <HBar key={i} label={PERIOD_LABEL[p.period] || p.period} value={p.count || 0} total={habPeriodTotal} color={[C.amber, C.sky, C.indigo, C.grey][i] || C.grey} />
                  ))}
                </WideCard>
              </div>
            </TwoCol>

            {/* ── Языки + Completion Ring ── */}
            <SectionLabel>Аудитория детально</SectionLabel>
            <TwoCol>
              <WideCard>
                <CardTitle>🌍 Аудитория по языкам</CardTitle>
                <HBar label="Русский 🇷🇺"    value={stats.users_ru  || 0} total={totalLang} color={C.blue}   />
                <HBar label="Английский 🇬🇧"  value={stats.users_en  || 0} total={totalLang} color={C.indigo} />
                <HBar label="Казахский 🇰🇿"   value={stats.users_kk  || 0} total={totalLang} color={C.teal}   />
                <div style={{ marginTop:16, paddingTop:12, borderTop:`1px solid ${C.border}`, display:'flex', gap:24 }}>
                  <div>
                    <div style={{ fontSize:18, fontWeight:800, color:C.pink }}>{fmt(stats.premium_users)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>premium</div>
                  </div>
                  <div>
                    <div style={{ fontSize:18, fontWeight:800, color:C.blue }}>{fmt(stats.total_users)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>всего</div>
                  </div>
                  <div>
                    <div style={{ fontSize:18, fontWeight:800, color:C.green }}>{stats.premium_rate}%</div>
                    <div style={{ fontSize:11, color:C.muted }}>конверсия</div>
                  </div>
                </div>
              </WideCard>

              <WideCard>
                <CardTitle>✅ Выполнение привычек сегодня</CardTitle>
                <Ring completed={stats.marks_completed_today || 0} total={stats.marks_today || 0} />
                <div style={{ marginTop:16, paddingTop:12, borderTop:`1px solid ${C.border}`, display:'flex', gap:24 }}>
                  <div>
                    <div style={{ fontSize:18, fontWeight:800, color:C.teal }}>{fmt(stats.active_habits)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>активных привычек</div>
                  </div>
                  <div>
                    <div style={{ fontSize:18, fontWeight:800, color:C.purple }}>{fmt(stats.special_habits)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>из пакетов</div>
                  </div>
                  <div>
                    <div style={{ fontSize:18, fontWeight:800, color:C.sky }}>{fmtF(stats.avg_streak)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>средний стрик</div>
                  </div>
                </div>
              </WideCard>
            </TwoCol>

            {/* ── Пакеты + Подписки ── */}
            <SectionLabel>Монетизация</SectionLabel>
            <TwoCol>
              <WideCard>
                <CardTitle>🏆 Топ пакетов по продажам</CardTitle>
                <PacksTable packs={stats.top_packs} />
              </WideCard>

              <WideCard>
                <CardTitle>💳 Подписки по планам</CardTitle>
                {subPlans.length === 0
                  ? <p style={{ color:C.muted, fontSize:13, textAlign:'center', padding:'20px 0' }}>Нет активных подписок</p>
                  : subPlans.map((p, i) => (
                    <HBar key={i}
                      label={PLAN_LABEL[p.plan_type] || p.plan_type}
                      value={p.count || 0}
                      total={totalSub}
                      color={[C.indigo, C.blue, C.teal, C.purple, C.green][i] || C.grey}
                    />
                  ))
                }
                <div style={{ marginTop:16, paddingTop:12, borderTop:`1px solid ${C.border}`, display:'flex', gap:24 }}>
                  <div>
                    <div style={{ fontSize:18, fontWeight:800, color:C.indigo }}>{fmt(stats.active_subscriptions)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>активных</div>
                  </div>
                  {stats.expiring_soon > 0 && (
                    <div>
                      <div style={{ fontSize:18, fontWeight:800, color:C.rose }}>{fmt(stats.expiring_soon)}</div>
                      <div style={{ fontSize:11, color:C.muted }}>истекают за 7 дн.</div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize:18, fontWeight:800, color:C.amber }}>{fmt(stats.paid_payments)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>оплат подписок</div>
                  </div>
                </div>
              </WideCard>
            </TwoCol>

            {/* ── Промокоды ── */}
            {stats.top_promo_codes && stats.top_promo_codes.length > 0 && (
              <>
                <SectionLabel>Промокоды</SectionLabel>
                <WideCard style={{ marginBottom:24 }}>
                  <CardTitle>🏷️ Топ промокодов по использованию</CardTitle>
                  <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                    {stats.top_promo_codes.map((p, i) => (
                      <div key={i} style={{ background:C.greyBg, border:`1px solid ${C.border}`, borderRadius:10, padding:'10px 16px', minWidth:120 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:C.dark, marginBottom:4 }}>{p.promo_code}</div>
                        <div style={{ fontSize:12, color:C.muted }}>{p.uses} использований</div>
                      </div>
                    ))}
                  </div>
                </WideCard>
              </>
            )}

            {/* ── Контент и система ── */}
            <SectionLabel>Контент и система</SectionLabel>
            <Grid min={150} mb={0}>
              <Card accent={C.purple}>
                <CardIcon>📦</CardIcon>
                <CardValue>{fmt(stats.active_packs)}</CardValue>
                <CardLabel>Активных пакетов</CardLabel>
                <CardSub positive>Всего: {fmt(stats.total_packs)}</CardSub>
              </Card>
              <Card accent={C.sky}>
                <CardIcon>📋</CardIcon>
                <CardValue>{fmt(stats.total_templates)}</CardValue>
                <CardLabel>Шаблонов привычек</CardLabel>
                <CardSub positive>Покупок: {fmt(stats.total_purchases)}</CardSub>
              </Card>
              <Card accent={C.green}>
                <CardIcon>🏷️</CardIcon>
                <CardValue>{fmt(stats.active_promo_codes)}</CardValue>
                <CardLabel>Активных промокодов</CardLabel>
                <CardSub positive>{fmt(stats.promo_uses_total)} использований</CardSub>
              </Card>
              <Card accent={C.purple}>
                <CardIcon>🎁</CardIcon>
                <CardValue>{fmt(stats.promo_subscriptions)}</CardValue>
                <CardLabel>Подписок по промо</CardLabel>
                <CardSub positive>Скидка: {fmt(stats.promo_total_discount)} ⭐ | Бесплатных: {fmt(stats.promo_free_activations)}</CardSub>
              </Card>
              <Card accent={C.rose}>
                <CardIcon>💬</CardIcon>
                <CardValue>{fmt(stats.total_phrases)}</CardValue>
                <CardLabel>Мотив. фраз</CardLabel>
              </Card>
              <Card accent={C.grey}>
                <CardIcon>🗂️</CardIcon>
                <CardValue>{fmt(stats.total_categories)}</CardValue>
                <CardLabel>Категорий</CardLabel>
              </Card>
              <Card accent={C.teal}>
                <CardIcon>👥</CardIcon>
                <CardValue>{fmt(stats.habit_members_count)}</CardValue>
                <CardLabel>Участников в шеринге</CardLabel>
                <CardSub positive>Привычек: {fmt(stats.shared_habits_count)}</CardSub>
              </Card>
            </Grid>
          </>
        )
      })()}
    </Page>
  )
}

export default Dashboard
