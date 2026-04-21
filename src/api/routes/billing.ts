/**
 * Billing Endpoints - Stripe integration
 *
 * POST /api/v1/billing/checkout - Create Stripe checkout session
 * POST /api/v1/webhooks/stripe - Handle Stripe webhook events
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../../config/index.js';

const router = Router();

// ── Checkout Session ─────────────────────────────────────��────────────────────

const CheckoutSchema = z.object({
  plan: z.enum(['starter', 'pro', 'enterprise']),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
});

router.post('/billing/checkout', async (req: Request, res: Response) => {
  const parsed = CheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (!config.stripeSecretKey) {
    res.status(503).json({ success: false, error: 'Billing not configured' });
    return;
  }

  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;
  const { plan, success_url, cancel_url } = parsed.data;

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(config.stripeSecretKey);

    // Price IDs per plan (configured in Stripe dashboard)
    const priceMap: Record<string, string> = {
      starter: process.env.STRIPE_PRICE_STARTER || 'price_starter',
      pro: process.env.STRIPE_PRICE_PRO || 'price_pro',
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise',
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceMap[plan], quantity: 1 }],
      success_url,
      cancel_url,
      metadata: { tenant_id: tenantId, plan },
      client_reference_id: tenantId,
    });

    res.json({
      success: true,
      data: {
        checkout_url: session.url,
        session_id: session.id,
      },
    });
  } catch (err) {
    console.error('[Billing] Checkout error:', err);
    res.status(500).json({ success: false, error: 'Failed to create checkout session' });
  }
});

// ── Stripe Webhook ────────────────────────────────────────────────────────────

router.post('/webhooks/stripe', async (req: Request, res: Response) => {
  if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
    res.status(503).json({ error: 'Billing not configured' });
    return;
  }

  const signature = req.headers['stripe-signature'] as string;
  if (!signature) {
    res.status(400).json({ error: 'Missing signature' });
    return;
  }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(config.stripeSecretKey);

    // Raw body is needed for signature verification
    const rawBody = (req as unknown as Record<string, unknown>).rawBody as string || JSON.stringify(req.body);
    const event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as unknown as Record<string, unknown>;
        const tenantId = session.client_reference_id as string;
        const subscriptionId = session.subscription as string;
        const customerId = session.customer as string;

        // Update tenant record
        if (config.supabaseUrl && config.supabaseServiceKey) {
          const { createClient } = await import('@supabase/supabase-js');
          const db = createClient(config.supabaseUrl, config.supabaseServiceKey);
          await db.from('tenants').update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            plan: (session.metadata as Record<string, string>)?.plan || 'starter',
            status: 'active',
          }).eq('id', tenantId);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as unknown as Record<string, unknown>;
        const customerId = subscription.customer as string;

        if (config.supabaseUrl && config.supabaseServiceKey) {
          const { createClient } = await import('@supabase/supabase-js');
          const db = createClient(config.supabaseUrl, config.supabaseServiceKey);
          await db.from('tenants').update({
            status: 'cancelled',
          }).eq('stripe_customer_id', customerId);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as unknown as Record<string, unknown>;
        const customerId = invoice.customer as string;

        if (config.supabaseUrl && config.supabaseServiceKey) {
          const { createClient } = await import('@supabase/supabase-js');
          const db = createClient(config.supabaseUrl, config.supabaseServiceKey);
          await db.from('tenants').update({
            status: 'payment_failed',
          }).eq('stripe_customer_id', customerId);
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Billing] Webhook error:', err);
    res.status(400).json({ error: 'Webhook verification failed' });
  }
});

export default router;
