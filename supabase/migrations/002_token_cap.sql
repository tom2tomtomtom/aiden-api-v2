-- AIDEN Brain API v2 - Enterprise licensing (token cap model)
-- Replaces self-serve Stripe with flat annual license + monthly token cap.
-- NULL monthly_token_cap = unlimited (pilot / trusted partner).

ALTER TABLE tenants
  ADD COLUMN monthly_token_cap INTEGER,
  ADD COLUMN billing_period_start TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE tenants
  DROP COLUMN stripe_customer_id,
  DROP COLUMN stripe_subscription_id;

-- Returns total (input + output) tokens used by tenant since p_period_start.
CREATE OR REPLACE FUNCTION get_monthly_token_usage(
  p_tenant_id UUID,
  p_period_start TIMESTAMPTZ
) RETURNS INTEGER AS $$
  SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::int
  FROM usage_logs
  WHERE tenant_id = p_tenant_id
    AND created_at >= p_period_start;
$$ LANGUAGE sql STABLE;
