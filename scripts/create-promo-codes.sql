-- Расширенная таблица промокодов для подписок
CREATE TABLE IF NOT EXISTS promo_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    discount_percent INTEGER CHECK (discount_percent >= 0 AND discount_percent <= 100),
    discount_stars INTEGER CHECK (discount_stars >= 0),
    bonus_days INTEGER CHECK (bonus_days >= 0),
    max_uses INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    applies_to_plans VARCHAR(100)[], -- Массив типов планов ['6_months', '1_year']
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_discount CHECK (
        (discount_percent IS NOT NULL AND discount_stars IS NULL) OR
        (discount_percent IS NULL AND discount_stars IS NOT NULL) OR
        (discount_percent IS NULL AND discount_stars IS NULL AND bonus_days IS NOT NULL)
    )
);

-- Таблица использования промокодов
CREATE TABLE IF NOT EXISTS promo_uses (
    id SERIAL PRIMARY KEY,
    promo_code_id INTEGER REFERENCES promo_codes(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
    discount_applied_stars INTEGER,
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(promo_code_id, user_id)
);

-- Индексы для оптимизации
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(is_active, valid_until);
CREATE INDEX IF NOT EXISTS idx_promo_uses_user ON promo_uses(user_id);
CREATE INDEX IF NOT EXISTS idx_promo_uses_promo ON promo_uses(promo_code_id);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_promo_codes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для обновления updated_at
DROP TRIGGER IF EXISTS update_promo_codes_updated_at_trigger ON promo_codes;
CREATE TRIGGER update_promo_codes_updated_at_trigger
BEFORE UPDATE ON promo_codes
FOR EACH ROW EXECUTE FUNCTION update_promo_codes_updated_at();

-- Тестовые промокоды
INSERT INTO promo_codes (code, description, discount_percent, max_uses, applies_to_plans, valid_until) VALUES
    ('WELCOME2024', 'Welcome discount for new users', 20, 100, ARRAY['6_months', '1_year'], CURRENT_TIMESTAMP + INTERVAL '30 days'),
    ('NEWYEAR50', 'New Year special offer', 50, 50, ARRAY['1_year'], CURRENT_TIMESTAMP + INTERVAL '7 days'),
    ('FRIEND10', 'Friend referral discount', 10, 1000, ARRAY['6_months', '1_year'], CURRENT_TIMESTAMP + INTERVAL '90 days')
ON CONFLICT (code) DO NOTHING;

-- Функция для проверки валидности промокода
CREATE OR REPLACE FUNCTION validate_promo_code(
    p_code VARCHAR(50),
    p_user_id INTEGER,
    p_plan_type VARCHAR(50)
)
RETURNS TABLE(
    is_valid BOOLEAN,
    promo_id INTEGER,
    discount_percent INTEGER,
    discount_stars INTEGER,
    bonus_days INTEGER,
    error_message TEXT
) AS $$
DECLARE
    v_promo promo_codes%ROWTYPE;
    v_already_used BOOLEAN;
BEGIN
    -- Получаем промокод
    SELECT * INTO v_promo
    FROM promo_codes
    WHERE code = p_code
    AND is_active = true
    AND (valid_from IS NULL OR valid_from <= CURRENT_TIMESTAMP)
    AND (valid_until IS NULL OR valid_until >= CURRENT_TIMESTAMP);
    
    -- Проверка существования
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'Promo code not found or expired'::TEXT;
        RETURN;
    END IF;
    
    -- Проверка лимита использований
    IF v_promo.used_count >= v_promo.max_uses THEN
        RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'Promo code usage limit reached'::TEXT;
        RETURN;
    END IF;
    
    -- Проверка применимости к плану
    IF v_promo.applies_to_plans IS NOT NULL AND NOT (p_plan_type = ANY(v_promo.applies_to_plans)) THEN
        RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'Promo code not applicable to this plan'::TEXT;
        RETURN;
    END IF;
    
    -- Проверка повторного использования
    SELECT EXISTS(
        SELECT 1 FROM promo_uses
        WHERE promo_code_id = v_promo.id
        AND user_id = p_user_id
    ) INTO v_already_used;
    
    IF v_already_used THEN
        RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'You have already used this promo code'::TEXT;
        RETURN;
    END IF;
    
    -- Промокод валиден
    RETURN QUERY SELECT 
        true, 
        v_promo.id, 
        v_promo.discount_percent, 
        v_promo.discount_stars,
        v_promo.bonus_days,
        NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Комментарии
COMMENT ON TABLE promo_codes IS 'Promotional codes for subscription discounts';
COMMENT ON COLUMN promo_codes.discount_percent IS 'Percentage discount (0-100)';
COMMENT ON COLUMN promo_codes.discount_stars IS 'Fixed stars discount amount';
COMMENT ON COLUMN promo_codes.bonus_days IS 'Additional bonus days for subscription';
COMMENT ON COLUMN promo_codes.applies_to_plans IS 'Array of plan types this promo applies to';
COMMENT ON FUNCTION validate_promo_code IS 'Validates promo code and returns discount information';