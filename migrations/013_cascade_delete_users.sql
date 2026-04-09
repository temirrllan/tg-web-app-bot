-- 013: Все FK на users → ON DELETE CASCADE
-- Чтобы при удалении юзера автоматически удалялись все связанные записи

-- subscription_history
ALTER TABLE subscription_history DROP CONSTRAINT IF EXISTS subscription_history_user_id_fkey;
ALTER TABLE subscription_history ADD CONSTRAINT subscription_history_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- subscriptions
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- telegram_payments
ALTER TABLE telegram_payments DROP CONSTRAINT IF EXISTS telegram_payments_user_id_fkey;
ALTER TABLE telegram_payments ADD CONSTRAINT telegram_payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- habits
ALTER TABLE habits DROP CONSTRAINT IF EXISTS habits_user_id_fkey;
ALTER TABLE habits ADD CONSTRAINT habits_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- habit_marks
ALTER TABLE habit_marks DROP CONSTRAINT IF EXISTS habit_marks_user_id_fkey;
ALTER TABLE habit_marks ADD CONSTRAINT habit_marks_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- shared_habits
ALTER TABLE shared_habits DROP CONSTRAINT IF EXISTS shared_habits_owner_user_id_fkey;
ALTER TABLE shared_habits ADD CONSTRAINT shared_habits_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE;

-- habit_members
ALTER TABLE habit_members DROP CONSTRAINT IF EXISTS habit_members_user_id_fkey;
ALTER TABLE habit_members ADD CONSTRAINT habit_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- habit_punches
ALTER TABLE habit_punches DROP CONSTRAINT IF EXISTS habit_punches_from_user_id_fkey;
ALTER TABLE habit_punches ADD CONSTRAINT habit_punches_from_user_id_fkey
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE habit_punches DROP CONSTRAINT IF EXISTS habit_punches_to_user_id_fkey;
ALTER TABLE habit_punches ADD CONSTRAINT habit_punches_to_user_id_fkey
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE;

-- special_habit_purchases
ALTER TABLE special_habit_purchases DROP CONSTRAINT IF EXISTS special_habit_purchases_user_id_fkey;
ALTER TABLE special_habit_purchases ADD CONSTRAINT special_habit_purchases_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- pack_achievement_progress
ALTER TABLE pack_achievement_progress DROP CONSTRAINT IF EXISTS pack_achievement_progress_user_id_fkey;
ALTER TABLE pack_achievement_progress ADD CONSTRAINT pack_achievement_progress_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- payment_invoices (если есть)
DO $$ BEGIN
  ALTER TABLE payment_invoices DROP CONSTRAINT IF EXISTS payment_invoices_user_id_fkey;
  ALTER TABLE payment_invoices ADD CONSTRAINT payment_invoices_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- promo_uses
DO $$ BEGIN
  ALTER TABLE promo_uses DROP CONSTRAINT IF EXISTS promo_uses_user_id_fkey;
  ALTER TABLE promo_uses ADD CONSTRAINT promo_uses_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- stars_transfers
DO $$ BEGIN
  ALTER TABLE stars_transfers DROP CONSTRAINT IF EXISTS stars_transfers_from_user_id_fkey;
  ALTER TABLE stars_transfers ADD CONSTRAINT stars_transfers_from_user_id_fkey
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- reminder_history (через habit_id, не user_id — пропускаем)
