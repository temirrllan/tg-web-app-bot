import React, { useEffect, useState } from 'react'
import { Box, H2, H3, Text, Loader } from '@adminjs/design-system'

// ── Stat card ─────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, icon, color }) => (
  <Box
    style={{
      background: '#fff',
      borderRadius: 12,
      padding: '24px 20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      minWidth: 140,
      flex: 1,
      boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
      border: `2px solid ${color}22`,
    }}
  >
    <span style={{ fontSize: 36, lineHeight: 1 }}>{icon}</span>
    <div style={{ fontSize: 32, fontWeight: 700, color, margin: '10px 0 4px', fontFamily: 'sans-serif' }}>
      {value !== undefined && value !== null ? Number(value).toLocaleString() : '…'}
    </div>
    <div style={{ fontSize: 13, color: '#666', textAlign: 'center', fontFamily: 'sans-serif' }}>
      {label}
    </div>
  </Box>
)

// ── Dashboard ─────────────────────────────────────────────────────────────────
const Dashboard = () => {
  const [stats, setStats]   = useState(null)
  const [error, setError]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/admin/api/stats', { credentials: 'same-origin' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => { setStats(data); setLoading(false) })
      .catch(err  => { setError(err.message); setLoading(false) })
  }, [])

  return (
    <Box padding="xl">
      {/* Header */}
      <Box marginBottom="xl">
        <H2 style={{ margin: 0, fontFamily: 'sans-serif' }}>📊 Dashboard</H2>
        <Text style={{ color: '#888', marginTop: 4, fontFamily: 'sans-serif' }}>
          Статистика Habit Tracker в реальном времени
        </Text>
      </Box>

      {/* Error */}
      {error && (
        <Box
          style={{
            background: '#fee2e2', color: '#991b1b', borderRadius: 8,
            padding: '12px 16px', marginBottom: 24, fontFamily: 'sans-serif',
          }}
        >
          ❌ Ошибка загрузки статистики: {error}
        </Box>
      )}

      {/* Loading */}
      {loading && !error && (
        <Box style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Loader />
        </Box>
      )}

      {/* Stats grid */}
      {!loading && stats && (
        <>
          {/* Row 1 — Users */}
          <Box marginBottom="default">
            <H3 style={{ fontFamily: 'sans-serif', marginBottom: 12, color: '#444' }}>
              👥 Пользователи
            </H3>
            <Box
              style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}
            >
              <StatCard
                label="Всего пользователей"
                value={stats.total_users}
                icon="👥"
                color="#3B82F6"
              />
              <StatCard
                label="Новых за 7 дней"
                value={stats.new_users_week}
                icon="🆕"
                color="#10B981"
              />
              <StatCard
                label="Новых за 30 дней"
                value={stats.new_users_month}
                icon="📈"
                color="#6366F1"
              />
              <StatCard
                label="Активных подписок"
                value={stats.active_subscriptions}
                icon="⭐"
                color="#EC4899"
              />
            </Box>
          </Box>

          {/* Row 2 — Monetization */}
          <Box marginBottom="default">
            <H3 style={{ fontFamily: 'sans-serif', marginBottom: 12, color: '#444' }}>
              💰 Монетизация
            </H3>
            <Box style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <StatCard
                label="Покупок пакетов"
                value={stats.total_purchases}
                icon="🛒"
                color="#F59E0B"
              />
              <StatCard
                label="Заработано Stars"
                value={stats.total_stars_earned}
                icon="⭐"
                color="#FBBF24"
              />
              <StatCard
                label="Пакетов в магазине"
                value={stats.total_packs}
                icon="📦"
                color="#8B5CF6"
              />
            </Box>
          </Box>

          {/* Row 3 — Content */}
          <Box>
            <H3 style={{ fontFamily: 'sans-serif', marginBottom: 12, color: '#444' }}>
              ✅ Контент
            </H3>
            <Box style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <StatCard
                label="Активных привычек"
                value={stats.total_habits}
                icon="✅"
                color="#14B8A6"
              />
            </Box>
          </Box>
        </>
      )}
    </Box>
  )
}

export default Dashboard
