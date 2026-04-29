// Tracks monthly OpenAI spending and enforces the cap.
//
// Costs are recorded in `ai_usage_monthly` after every assistant response.
// `assertWithinBudget()` throws if the current month is at/above the cap.

const db = require('../config/database');

// USD price per 1M tokens (as of 2024-12).
// gpt-4o-mini: $0.15 input / $0.60 output
// gpt-4o:      $2.50 input / $10.00 output
const PRICING = {
  'gpt-4o-mini': { in: 0.15 / 1_000_000, out: 0.60 / 1_000_000 },
  'gpt-4o':      { in: 2.50 / 1_000_000, out: 10.00 / 1_000_000 },
};

const MONTHLY_CAP_USD = parseFloat(process.env.AI_MONTHLY_CAP_USD || '5');

function currentMonthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function calcCostUsd(model, tokensIn, tokensOut) {
  const p = PRICING[model] || PRICING['gpt-4o-mini'];
  return (tokensIn || 0) * p.in + (tokensOut || 0) * p.out;
}

async function getMonthUsage() {
  const month = currentMonthStart();
  const r = await db.query(
    `SELECT total_cost_cents::float AS cents, request_count
       FROM ai_usage_monthly
      WHERE month = $1`,
    [month]
  );
  const row = r.rows[0];
  return {
    month,
    costUsd: row ? row.cents / 100 : 0,
    requestCount: row ? row.request_count : 0,
    capUsd: MONTHLY_CAP_USD,
    remainingUsd: Math.max(0, MONTHLY_CAP_USD - (row ? row.cents / 100 : 0)),
  };
}

async function assertWithinBudget() {
  const u = await getMonthUsage();
  if (u.costUsd >= MONTHLY_CAP_USD) {
    const err = new Error(
      `Месячный лимит AI ($${MONTHLY_CAP_USD}) исчерпан. Использовано: $${u.costUsd.toFixed(4)}. ` +
      `Сброс — 1-го числа следующего месяца.`
    );
    err.code = 'AI_BUDGET_EXCEEDED';
    err.usage = u;
    throw err;
  }
  return u;
}

async function recordUsage(model, tokensIn, tokensOut) {
  const month = currentMonthStart();
  const costUsd = calcCostUsd(model, tokensIn, tokensOut);
  const costCents = costUsd * 100;

  await db.query(
    `INSERT INTO ai_usage_monthly (month, total_cost_cents, request_count, tokens_in_total, tokens_out_total, updated_at)
     VALUES ($1, $2, 1, $3, $4, NOW())
     ON CONFLICT (month) DO UPDATE SET
       total_cost_cents  = ai_usage_monthly.total_cost_cents + EXCLUDED.total_cost_cents,
       request_count     = ai_usage_monthly.request_count + 1,
       tokens_in_total   = ai_usage_monthly.tokens_in_total + EXCLUDED.tokens_in_total,
       tokens_out_total  = ai_usage_monthly.tokens_out_total + EXCLUDED.tokens_out_total,
       updated_at        = NOW()`,
    [month, costCents, tokensIn || 0, tokensOut || 0]
  );

  return { costUsd, costCents };
}

module.exports = {
  PRICING,
  MONTHLY_CAP_USD,
  calcCostUsd,
  getMonthUsage,
  assertWithinBudget,
  recordUsage,
};
