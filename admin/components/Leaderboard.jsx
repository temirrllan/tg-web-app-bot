import React, { useEffect, useState, useCallback } from 'react'
import { Box, Loader } from '@adminjs/design-system'

const styled = window.styled?.default ?? window.styled

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  gold:    '#F59E0B',
  silver:  '#9CA3AF',
  bronze:  '#D97706',
  blue:    '#3B82F6',
  green:   '#10B981',
  indigo:  '#6366F1',
  pink:    '#EC4899',
  white:   '#FFFFFF',
  dark:    '#111827',
  text:    '#374151',
  muted:   '#9CA3AF',
  border:  '#E5E7EB',
  bg:      '#F3F4F6',
  premium: '#8B5CF6',
}

// ─── Styled ──────────────────────────────────────────────────────────────────
const Page = styled(Box)`
  padding: 24px 32px;
  background: ${C.bg};
  min-height: 100vh;
`
const Hero = styled.div`
  background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #1e3a5f 100%);
  border-radius: 16px; padding: 32px 40px;
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 24px; overflow: hidden; position: relative;
  &::before { content:''; position:absolute; top:-80px; right:80px; width:320px; height:320px; border-radius:50%; background:rgba(245,158,11,0.1); }
`
const HeroTitle = styled.h1` margin:0; color:#fff; font-size:26px; font-weight:700; `
const HeroSub   = styled.p` margin:4px 0 0; color:rgba(255,255,255,0.55); font-size:13px; `
const HeroEmoji = styled.div` font-size:72px; z-index:1; `

const Controls = styled.div`
  display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; align-items: center;
`
const Select = styled.select`
  padding: 8px 14px; border-radius: 8px; border: 1px solid ${C.border};
  background: ${C.white}; font-size: 13px; color: ${C.text}; cursor: pointer;
  &:focus { outline: none; border-color: ${C.blue}; }
`
const SearchInput = styled.input`
  padding: 8px 14px; border-radius: 8px; border: 1px solid ${C.border};
  background: ${C.white}; font-size: 13px; color: ${C.text}; min-width: 220px;
  &:focus { outline: none; border-color: ${C.blue}; }
  &::placeholder { color: ${C.muted}; }
`

const Table = styled.table`
  width: 100%; border-collapse: collapse; background: ${C.white};
  border-radius: 12px; overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid ${C.border};
`
const Th = styled.th`
  padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.8px; color: ${C.muted};
  background: #FAFAFA; border-bottom: 1px solid ${C.border};
  white-space: nowrap;
`
const Td = styled.td`
  padding: 12px 16px; font-size: 13px; color: ${C.text};
  border-bottom: 1px solid ${C.border}; vertical-align: middle;
`
const Tr = styled.tr`
  transition: background 0.1s;
  &:hover { background: #F9FAFB; }
  &:last-child td { border-bottom: none; }
`

const RankBadge = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 50%;
  font-size: ${({ top }) => top ? '16px' : '12px'};
  font-weight: 700;
  background: ${({ rank }) =>
    rank === 1 ? 'linear-gradient(135deg, #F59E0B, #FBBF24)' :
    rank === 2 ? 'linear-gradient(135deg, #9CA3AF, #D1D5DB)' :
    rank === 3 ? 'linear-gradient(135deg, #D97706, #F59E0B)' :
    '#F3F4F6'};
  color: ${({ rank }) => rank <= 3 ? '#fff' : C.text};
`

const PremiumBadge = styled.span`
  display: inline-flex; align-items: center; gap: 4px;
  background: #EDE9FE; color: ${C.premium}; font-size: 11px; font-weight: 600;
  padding: 2px 8px; border-radius: 10px;
`

const StreakVal = styled.span`
  font-size: 18px; font-weight: 700;
  color: ${({ val }) => val > 0 ? C.green : C.muted};
`

const TopHabitChip = styled.span`
  display: inline-flex; align-items: center; gap: 4px;
  background: ${({ special }) => special ? '#EDE9FE' : '#ECFDF5'};
  color: ${({ special }) => special ? C.premium : C.green};
  font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 8px;
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`

const Pagination = styled.div`
  display: flex; align-items: center; justify-content: center;
  gap: 8px; margin-top: 20px;
`
const PageBtn = styled.button`
  padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 500;
  border: 1px solid ${({ active }) => active ? C.blue : C.border};
  background: ${({ active }) => active ? C.blue : C.white};
  color: ${({ active }) => active ? C.white : C.text};
  cursor: pointer; transition: all 0.15s;
  &:hover { border-color: ${C.blue}; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`
const PageInfo = styled.span`
  font-size: 13px; color: ${C.muted}; margin: 0 8px;
`

const StatsRow = styled.div`
  display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap;
`
const StatCard = styled.div`
  background: ${C.white}; border-radius: 12px; padding: 16px 20px;
  border: 1px solid ${C.border}; min-width: 160px; flex: 1;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
`
const StatLabel = styled.div` font-size: 11px; color: ${C.muted}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; `
const StatValue = styled.div` font-size: 24px; font-weight: 700; color: ${C.dark}; margin-top: 4px; `

const EmptyState = styled.div`
  text-align: center; padding: 60px 20px; color: ${C.muted}; font-size: 15px;
`

// ─── Component ───────────────────────────────────────────────────────────────
const Leaderboard = () => {
  const [data, setData]           = useState([])
  const [pagination, setPagination] = useState({ page: 1, perPage: 25, total: 0, totalPages: 0 })
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('all')
  const [habitType, setHabitType] = useState('all')
  const [search, setSearch]       = useState('')
  const [searchInput, setSearchInput] = useState('')

  const fetchData = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page, perPage: 25, filter, habitType, search
      })
      const res = await fetch(`/admin/api/leaderboard?${params}`, { credentials: 'same-origin' })
      const json = await res.json()
      setData(json.leaderboard || [])
      setPagination(json.pagination || { page: 1, perPage: 25, total: 0, totalPages: 0 })
    } catch (err) {
      console.error('Failed to load leaderboard:', err)
    } finally {
      setLoading(false)
    }
  }, [filter, habitType, search])

  useEffect(() => { fetchData(1) }, [fetchData])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const { page, total, totalPages } = pagination

  return (
    <Page>
      <Hero>
        <div>
          <HeroTitle>Leaderboard</HeroTitle>
          <HeroSub>Users ranked by best streak across all habits</HeroSub>
        </div>
        <HeroEmoji>🏆</HeroEmoji>
      </Hero>

      {/* Stats summary */}
      {!loading && data.length > 0 && (
        <StatsRow>
          <StatCard>
            <StatLabel>Total Users</StatLabel>
            <StatValue>{total}</StatValue>
          </StatCard>
          <StatCard>
            <StatLabel>#1 Best Streak</StatLabel>
            <StatValue>{data[0]?.bestStreak || 0} days</StatValue>
          </StatCard>
          <StatCard>
            <StatLabel>#1 User</StatLabel>
            <StatValue style={{ fontSize: 16 }}>{data[0]?.firstName || '-'}</StatValue>
          </StatCard>
          <StatCard>
            <StatLabel>#1 Top Habit</StatLabel>
            <StatValue style={{ fontSize: 14 }}>{data[0]?.topHabit?.title || '-'}</StatValue>
          </StatCard>
        </StatsRow>
      )}

      {/* Controls */}
      <Controls>
        <Select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All Users</option>
          <option value="premium">Premium Only</option>
          <option value="free">Free Only</option>
        </Select>
        <Select value={habitType} onChange={e => setHabitType(e.target.value)}>
          <option value="all">All Habits</option>
          <option value="regular">Regular Only</option>
          <option value="special">Special Only</option>
        </Select>
        <SearchInput
          placeholder="Search by name, username or ID..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
        />
      </Controls>

      {/* Table */}
      {loading ? (
        <Box style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader />
        </Box>
      ) : data.length === 0 ? (
        <EmptyState>No users found matching your filters</EmptyState>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>User</Th>
                <Th>Telegram ID</Th>
                <Th>Status</Th>
                <Th>Language</Th>
                <Th>Habits</Th>
                <Th>Best Streak</Th>
                <Th>Current Best</Th>
                <Th>Total Current</Th>
                <Th>Top Habit</Th>
                <Th>Registered</Th>
              </tr>
            </thead>
            <tbody>
              {data.map(row => (
                <Tr key={row.userId}>
                  <Td>
                    <RankBadge rank={row.rank} top={row.rank <= 3}>
                      {row.rank <= 3
                        ? ['🥇','🥈','🥉'][row.rank - 1]
                        : row.rank}
                    </RankBadge>
                  </Td>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{row.firstName || '—'}</div>
                    {row.username && (
                      <div style={{ fontSize: 11, color: C.muted }}>@{row.username}</div>
                    )}
                  </Td>
                  <Td style={{ fontFamily: 'monospace', fontSize: 12 }}>{row.telegramId}</Td>
                  <Td>
                    {row.isPremium
                      ? <PremiumBadge>💎 Premium</PremiumBadge>
                      : <span style={{ fontSize: 12, color: C.muted }}>Free</span>}
                  </Td>
                  <Td>{row.language?.toUpperCase() || '—'}</Td>
                  <Td style={{ fontWeight: 600 }}>{row.totalHabits}</Td>
                  <Td><StreakVal val={row.bestStreak}>{row.bestStreak} 🔥</StreakVal></Td>
                  <Td><StreakVal val={row.bestCurrentStreak}>{row.bestCurrentStreak}</StreakVal></Td>
                  <Td>{row.totalCurrentStreak}</Td>
                  <Td>
                    {row.topHabit ? (
                      <TopHabitChip special={row.topHabit.isSpecial} title={row.topHabit.title}>
                        {row.topHabit.isSpecial ? '✨ ' : ''}{row.topHabit.title}
                      </TopHabitChip>
                    ) : '—'}
                  </Td>
                  <Td style={{ fontSize: 12, color: C.muted }}>
                    {row.registeredAt ? new Date(row.registeredAt).toLocaleDateString() : '—'}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <Pagination>
              <PageBtn
                disabled={page <= 1}
                onClick={() => fetchData(page - 1)}
              >
                ← Prev
              </PageBtn>

              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum
                if (totalPages <= 7) {
                  pageNum = i + 1
                } else if (page <= 4) {
                  pageNum = i + 1
                } else if (page >= totalPages - 3) {
                  pageNum = totalPages - 6 + i
                } else {
                  pageNum = page - 3 + i
                }
                return (
                  <PageBtn
                    key={pageNum}
                    active={pageNum === page}
                    onClick={() => fetchData(pageNum)}
                  >
                    {pageNum}
                  </PageBtn>
                )
              })}

              <PageInfo>{total} users</PageInfo>

              <PageBtn
                disabled={page >= totalPages}
                onClick={() => fetchData(page + 1)}
              >
                Next →
              </PageBtn>
            </Pagination>
          )}
        </>
      )}
    </Page>
  )
}

export default Leaderboard
