import React, { useEffect, useState } from 'react'
import { Box, Loader } from '@adminjs/design-system'

// window.styled — это { default: styledFn }, Rollup interop не нужен
const styled = window.styled?.default ?? window.styled

// ─── Theme tokens ─────────────────────────────────────────────────────────────

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

// Hero banner
const Hero = styled.div`
  background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #1e3a5f 100%);
  border-radius: 16px;
  padding: 36px 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  overflow: hidden;
  position: relative;
  &::before {
    content: '';
    position: absolute; top: -80px; right: 80px;
    width: 320px; height: 320px; border-radius: 50%;
    background: rgba(99,102,241,0.12);
  }
  &::after {
    content: '';
    position: absolute; bottom: -100px; left: 25%;
    width: 250px; height: 250px; border-radius: 50%;
    background: rgba(16,185,129,0.07);
  }
`
const HeroLeft = styled.div`
  display: flex; flex-direction: column; gap: 10px; z-index: 1;
`
const HeroPill = styled.span`
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(99,102,241,0.3); border: 1px solid rgba(99,102,241,0.5);
  color: #c7d2fe; font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
  padding: 4px 14px; border-radius: 20px; width: fit-content;
`
const HeroTitle = styled.h1`
  margin: 0; color: #fff; font-size: 26px; font-weight: 700; line-height: 1.3;
`
const HeroSub = styled.p`
  margin: 0; color: rgba(255,255,255,0.55); font-size: 13px; line-height: 1.6; max-width: 420px;
`
const HeroEmoji = styled.div`
  font-size: 88px; z-index: 1; filter: drop-shadow(0 8px 24px rgba(0,0,0,0.4));
  flex-shrink: 0; margin-left: 20px;
`

// Section label
const SectionLabel = styled.p`
  margin: 0 0 12px; font-size: 11px; font-weight: 700; letter-spacing: 1.2px;
  text-transform: uppercase; color: ${C.muted};
`

// Cards grid
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(${({ min }) => min || 180}px, 1fr));
  gap: ${({ gap }) => gap || 14}px;
  margin-bottom: ${({ mb }) => mb || 24}px;
`

// Stat card
const Card = styled.div`
  background: ${C.white};
  border-radius: 12px;
  padding: 20px 18px;
  display: flex; flex-direction: column;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  border: 1px solid ${C.border};
  position: relative; overflow: hidden;
  transition: box-shadow 0.15s, transform 0.15s;
  &:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.09); transform: translateY(-2px); }
  &::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    background: ${({ accent }) => accent || C.indigo};
    border-radius: 12px 12px 0 0;
  }
`
const CardIcon  = styled.div` font-size: 24px; margin-bottom: 10px; line-height: 1; `
const CardValue = styled.div`
  font-size: 28px; font-weight: 800; color: ${C.dark}; line-height: 1; margin-bottom: 4px;
`
const CardLabel = styled.div` font-size: 12px; color: ${C.muted}; line-height: 1.4; `
const CardDelta = styled.span`
  display: inline-block; margin-top: 6px;
  font-size: 11px; font-weight: 600;
  color: ${({ positive }) => positive ? C.green : C.rose};
`

// Wide card (for charts/tables)
const WideCard = styled.div`
  background: ${C.white};
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  border: 1px solid ${C.border};
  margin-bottom: 24px;
`
const WideCardTitle = styled.h3`
  margin: 0 0 20px; font-size: 14px; font-weight: 700; color: ${C.dark};
`

// Two-column layout
const TwoCol = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;
  @media(max-width: 900px) { grid-template-columns: 1fr; }
`

// Error box
const ErrBox = styled.div`
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px;
  padding: 14px 18px; color: #b91c1c; display: flex; align-items: center;
  gap: 10px; margin-bottom: 20px; font-size: 13px;
`

// ─── Mini bar chart ───────────────────────────────────────────────────────────

const BarChart = ({ data, color, height = 60, label = '' }) => {
  if (!data || data.length === 0) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>
      Нет данных
    </div>
  )
  const max = Math.max(...data.map(d => d.count || d.value || 0), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height }}>
        {data.map((d, i) => {
          const val = d.count || d.value || 0
          const h = Math.max(Math.round((val / max) * (height - 16)), 3)
          return (
            <div key={i} title={`${d.date || d.label || ''}: ${val}`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{
                width: '100%', height: h,
                background: color || C.indigo,
                borderRadius: '3px 3px 0 0',
                opacity: 0.85,
                transition: 'opacity 0.15s',
                cursor: 'default',
              }} />
              {data.length <= 7 && (
                <span style={{ fontSize: 9, color: C.muted, transform: 'rotate(-45deg)', whiteSpace: 'nowrap', transformOrigin: 'top center' }}>
                  {val}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {label && <p style={{ margin: '8px 0 0', fontSize: 11, color: C.muted, textAlign: 'center' }}>{label}</p>}
    </div>
  )
}

// ─── Language bar ─────────────────────────────────────────────────────────────

const LangBar = ({ label, value, total, color }) => {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, color: C.muted }}>{value.toLocaleString()} ({pct}%)</span>
      </div>
      <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

// ─── Habit completion ring ────────────────────────────────────────────────────

const CompletionRing = ({ completed, total }) => {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const r = 44, circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width={104} height={104} style={{ flexShrink: 0 }}>
        <circle cx={52} cy={52} r={r} fill="none" stroke={C.border} strokeWidth={10} />
        <circle cx={52} cy={52} r={r} fill="none" stroke={C.teal} strokeWidth={10}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 52 52)" style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <text x={52} y={48} textAnchor="middle" fontSize={18} fontWeight={800} fill={C.dark}>{pct}%</text>
        <text x={52} y={64} textAnchor="middle" fontSize={10} fill={C.muted}>выполнено</text>
      </svg>
      <div>
        <div style={{ fontSize: 13, color: C.text, marginBottom: 6 }}>
          <span style={{ fontWeight: 700, color: C.teal }}>{completed.toLocaleString()}</span> выполнено
        </div>
        <div style={{ fontSize: 13, color: C.text, marginBottom: 6 }}>
          <span style={{ fontWeight: 700 }}>{total.toLocaleString()}</span> всего сегодня
        </div>
        <div style={{ fontSize: 11, color: C.muted }}>Процент выполнения привычек за сегодня</div>
      </div>
    </div>
  )
}

// ─── Top packs table ──────────────────────────────────────────────────────────

const TopPacksTable = ({ packs }) => {
  if (!packs || packs.length === 0) return (
    <p style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>Нет данных о покупках</p>
  )
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          {['Пакет', 'Покупок', 'Заработано ⭐'].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${C.border}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {packs.map((p, i) => (
          <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
            <td style={{ padding: '10px 8px', color: C.text, fontWeight: 500 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, background: [C.amber, C.muted, '#cd7f32'][i] || C.border, borderRadius: 4, color: '#fff', fontSize: 11, fontWeight: 800, marginRight: 8 }}>{i + 1}</span>
              {p.name}
            </td>
            <td style={{ padding: '10px 8px', color: C.dark, fontWeight: 700 }}>{p.purchases}</td>
            <td style={{ padding: '10px 8px', color: C.amber, fontWeight: 700 }}>{(p.stars || 0).toLocaleString()} ⭐</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = v => (v !== undefined && v !== null ? Number(v).toLocaleString() : '—')

// Fill last N days
function fillDays(data, n = 14) {
  const map = {}
  ;(data || []).forEach(d => { map[d.date] = d.count || d.value || 0 })
  const result = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    result.push({ date: key, count: map[key] || 0 })
  }
  return result
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

const Dashboard = () => {
  const [stats, setStats]     = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/admin/api/stats', { credentials: 'same-origin' })
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
          <HeroTitle>Панель управления</HeroTitle>
          <HeroSub>
            Пользователи, привычки, пакеты, платежи —<br />
            вся аналитика в реальном времени.
          </HeroSub>
        </HeroLeft>
        <HeroEmoji>🎯</HeroEmoji>
      </Hero>

      {/* ── Error ── */}
      {error && <ErrBox>❌ Ошибка загрузки статистики: {error}</ErrBox>}

      {/* ── Loading ── */}
      {loading && !error && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <Loader />
        </div>
      )}

      {/* ── Content ── */}
      {!loading && stats && (() => {
        const reg14 = fillDays(stats.weekly_registrations, 14)
        const pur14 = fillDays(stats.weekly_purchases, 14)
        const totalLang = (stats.users_ru || 0) + (stats.users_en || 0) + (stats.users_kk || 0)

        return (
          <>
            {/* KPI strip */}
            <SectionLabel>Ключевые показатели</SectionLabel>
            <Grid min={160} mb={24}>
              <Card accent={C.blue}>
                <CardIcon>👥</CardIcon>
                <CardValue>{fmt(stats.total_users)}</CardValue>
                <CardLabel>Всего пользователей</CardLabel>
                <CardDelta positive>+{fmt(stats.new_users_today)} сегодня</CardDelta>
              </Card>
              <Card accent={C.indigo}>
                <CardIcon>⭐</CardIcon>
                <CardValue>{fmt(stats.total_stars_earned)}</CardValue>
                <CardLabel>Telegram Stars заработано</CardLabel>
                <CardDelta positive>{fmt(stats.total_purchases)} покупок</CardDelta>
              </Card>
              <Card accent={C.pink}>
                <CardIcon>💎</CardIcon>
                <CardValue>{fmt(stats.premium_users)}</CardValue>
                <CardLabel>Премиум пользователей</CardLabel>
                <CardDelta positive>{fmt(stats.active_subscriptions)} активных подписок</CardDelta>
              </Card>
              <Card accent={C.teal}>
                <CardIcon>✅</CardIcon>
                <CardValue>{fmt(stats.active_habits)}</CardValue>
                <CardLabel>Активных привычек</CardLabel>
                <CardDelta positive>{fmt(stats.special_habits)} из пакетов</CardDelta>
              </Card>
            </Grid>

            {/* Charts row */}
            <TwoCol>
              <WideCard>
                <WideCardTitle>📅 Новые пользователи (14 дней)</WideCardTitle>
                <BarChart data={reg14} color={C.blue} height={80} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, padding: '12px 0', borderTop: `1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.blue }}>{fmt(stats.new_users_week)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>за 7 дней</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.indigo }}>{fmt(stats.new_users_month)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>за 30 дней</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.dark }}>{fmt(stats.total_users)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>всего</div>
                  </div>
                </div>
              </WideCard>

              <WideCard>
                <WideCardTitle>💰 Покупки пакетов (14 дней)</WideCardTitle>
                <BarChart data={pur14} color={C.amber} height={80} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, padding: '12px 0', borderTop: `1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.amber }}>{fmt(stats.total_purchases)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>всего покупок</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.yellow }}>{fmt(stats.total_stars_packs)} ⭐</div>
                    <div style={{ fontSize: 11, color: C.muted }}>из пакетов</div>
                  </div>
                </div>
              </WideCard>
            </TwoCol>

            {/* Users detail + habits */}
            <TwoCol>
              <WideCard>
                <WideCardTitle>🌍 Аудитория по языкам</WideCardTitle>
                <LangBar label="Русский 🇷🇺"    value={stats.users_ru  || 0} total={totalLang} color={C.blue}   />
                <LangBar label="Английский 🇬🇧"  value={stats.users_en  || 0} total={totalLang} color={C.indigo} />
                <LangBar label="Казахский 🇰🇿"   value={stats.users_kk  || 0} total={totalLang} color={C.teal}   />
                <div style={{ marginTop: 16, padding: '12px 0', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 24 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.pink }}>{fmt(stats.premium_users)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>премиум</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.dark }}>{fmt(stats.total_users)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>всего</div>
                  </div>
                </div>
              </WideCard>

              <WideCard>
                <WideCardTitle>✅ Выполнение привычек сегодня</WideCardTitle>
                <CompletionRing
                  completed={stats.marks_completed_today || 0}
                  total={stats.marks_today || 0}
                />
                <div style={{ marginTop: 16, padding: '12px 0', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 24 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.teal }}>{fmt(stats.active_habits)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>активных привычек</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.purple }}>{fmt(stats.special_habits)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>из пакетов</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.sky }}>{fmt(stats.reminders_today)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>напоминаний сегодня</div>
                  </div>
                </div>
              </WideCard>
            </TwoCol>

            {/* Top packs */}
            <WideCard>
              <WideCardTitle>🏆 Топ пакетов по продажам</WideCardTitle>
              <TopPacksTable packs={stats.top_packs} />
            </WideCard>

            {/* Packs & Content strip */}
            <SectionLabel>Контент и монетизация</SectionLabel>
            <Grid min={150} mb={24}>
              <Card accent={C.purple}>
                <CardIcon>📦</CardIcon>
                <CardValue>{fmt(stats.active_packs)}</CardValue>
                <CardLabel>Активных пакетов</CardLabel>
                <CardDelta positive>{fmt(stats.total_packs)} всего</CardDelta>
              </Card>
              <Card accent={C.sky}>
                <CardIcon>📋</CardIcon>
                <CardValue>{fmt(stats.total_templates)}</CardValue>
                <CardLabel>Шаблонов привычек</CardLabel>
              </Card>
              <Card accent={C.green}>
                <CardIcon>🏷️</CardIcon>
                <CardValue>{fmt(stats.active_promo_codes)}</CardValue>
                <CardLabel>Активных промокодов</CardLabel>
                <CardDelta positive>{fmt(stats.promo_uses_total)} использований</CardDelta>
              </Card>
              <Card accent={C.amber}>
                <CardIcon>🧾</CardIcon>
                <CardValue>{fmt(stats.paid_invoices)}</CardValue>
                <CardLabel>Оплаченных счетов</CardLabel>
                <CardDelta positive>{fmt(stats.total_stars_invoices)} ⭐</CardDelta>
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
            </Grid>
          </>
        )
      })()}
    </Page>
  )
}

export default Dashboard
