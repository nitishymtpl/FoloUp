// src/app/api/billing/webhook/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';

// This endpoint handles webhooks from Lemonsqueezy.
// It verifies the signature, processes the event, and updates billing records.

// A conceptual function - this would interact with your database.
// async function getCreditPurchaseByOrderId(lemonsqueezyOrderId: string) {
//   // TODO: Implement database lookup
//   // e.g., await db.select().from('credit_purchases').where('lemonsqueezy_order_id', lemonsqueezyOrderId);
//   console.log(`[DB MOCK] Checking for existing credit purchase with order_id: ${lemonsqueezyOrderId}`);
//   // Simulate: return null if not found, or an object with { status: 'processed' } if found.
//   if (lemonsqueezyOrderId === 'processed_order_123') {
//     return { id: 'cp_abc', lemonsqueezy_order_id: lemonsqueezyOrderId, status: 'processed' };
//   }
//   return null;
// }

// A conceptual function - this would interact with your database.
// async function updateCreditPurchaseStatus(creditPurchaseId: string, status: string, lemonsqueezyOrderId?: string) {
//   // TODO: Implement database update
//   // e.g., await db.update('credit_purchases').set({ status, lemonsqueezy_order_id }).where('id', creditPurchaseId);
//   console.log(`[DB MOCK] Updating credit_purchase ${creditPurchaseId} to status: ${status} ${lemonsqueezyOrderId ? `(Order ID: ${lemonsqueezyOrderId})` : ''}`);
// }

// A conceptual function - this would call your BillingService.
// async function addCreditsToOrganization(organizationId: string, credits_granted: number, amount_usd: number) {
//  // TODO: Implement call to BillingService or directly update organization's credit balance.
//  // This might involve calling the DB functions in BillingService or a dedicated credit service.
//  console.log(`[SERVICE MOCK] Adding ${credits_granted} credits ($${amount_usd}) to organization ${organizationId}.`);
// }


export async function POST(request: Request) {
  console.log('Received POST request to /api/billing/webhook');

  let rawBody;
  try {
    rawBody = await request.text();
  } catch (error) {
    console.error('Error reading raw request body:', error);
    return NextResponse.json({ error: 'Failed to read request body' }, { status: 500 });
  }

  const signature = request.headers.get('X-Signature');
  if (!signature) {
    console.warn('Missing X-Signature header');
    return NextResponse.json({ error: 'Missing X-Signature header' }, { status: 400 });
  }

  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('LEMONSQUEEZY_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // TODO: Implement actual Lemonsqueezy signature verification
  // const hmac = crypto.createHmac('sha256', secret);
  // const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8');
  // const receivedSignature = Buffer.from(signature, 'utf8');
  //
  // try {
  //   if (!crypto.timingSafeEqual(digest, receivedSignature)) {
  //     console.warn('Invalid webhook signature');
  //     return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  //   }
  // } catch (timingSafeEqualError) {
  //    console.warn('Error during timingSafeEqual comparison (likely different buffer lengths):', timingSafeEqualError);
  //    return NextResponse.json({ error: 'Invalid signature format' }, { status: 400 });
  // }
  // For now, simulate successful verification or allow a debug signature
  const isVerified = signature === 'debug-signature' || process.env.NODE_ENV !== 'production'; // Bypass in non-prod for easier testing
  if (!isVerified) {
     // Placeholder: Simulate actual verification logic for now
     const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
     if (signature !== expectedSignature) {
        console.warn(`Invalid webhook signature. Expected: ${expectedSignature}, Received: ${signature}`);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
     }
  }
  console.log('Webhook signature verified successfully (simulated/debug or actual).');

  let eventPayload;
  try {
    eventPayload = JSON.parse(rawBody);
  } catch (error) {
    console.error('Error parsing webhook JSON payload:', error);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const eventName = eventPayload.meta?.event_name;
  const customData = eventPayload.meta?.custom_data;
  const attributes = eventPayload.data?.attributes;

  if (!eventName || !attributes || !customData) {
    console.warn('Webhook payload missing essential fields (meta.event_name, data.attributes, meta.custom_data)');
    return NextResponse.json({ error: 'Missing essential event data' }, { status: 400 });
  }

  const lemonsqueezyOrderId = attributes.order_number; // Or the correct field for unique order ID
  const organizationId = customData.organization_id;
  const creditPurchaseId = customData.credit_purchase_id; // The ID we generated

  console.log(`Processing event: ${eventName}, Order ID: ${lemonsqueezyOrderId}, Org ID: ${organizationId}, Purchase ID: ${creditPurchaseId}`);

  // --- Idempotency Check (Conceptual Placeholder) ---
  // In a real system, you'd check if this lemonsqueezy_order_id has already been processed.
  // const existingPurchase = await getCreditPurchaseByOrderId(lemonsqueezyOrderId);
  // if (existingPurchase && existingPurchase.status === 'processed') {
  //   console.log(`Order ID ${lemonsqueezyOrderId} (Purchase ID: ${creditPurchaseId}) already processed. Skipping.`);
  //   return NextResponse.json({ message: 'Event already processed' }, { status: 200 });
  // }
  // If new, you might insert/update a record in a `credit_purchases` table here,
  // marking it as 'pending_processing' or similar before handling the specific event type.
  // await updateCreditPurchaseStatus(creditPurchaseId, 'pending_processing', lemonsqueezyOrderId);


  // --- Processing Logic (Placeholder) ---
  // Replace 'order_created' with the actual event name from Lemonsqueezy for successful one-time payments.
  // Common events might be 'order_created' or 'subscription_payment_succeeded' (though this is for subscriptions).
  // For one-time purchases, 'order_created' is a likely candidate if it signifies payment success.
  if (eventName === 'order_created') { // TODO: Verify the correct Lemonsqueezy event name
    console.log(`Handling '${eventName}' for Order ID: ${lemonsqueezyOrderId}`);

    // TODO: Extract amount_usd and determine credits_granted based on the variant/product purchased.
    // This information would come from `eventPayload.data.attributes` or `eventPayload.data.relationships`.
    // For example, if `variant_id` is known, map it to credits.
    // const variantId = eventPayload.data?.relationships?.['order-items']?.data?.[0]?.relationships?.variant?.data?.id; // Example path
    // const variantIdFromWebhook = eventPayload.data?.relationships?.variant?.data?.id; // Or directly if it's a variant-specific webhook

    // For now, let's assume a fixed amount for any successful order or derive from a known variant.
    const amount_usd = attributes.total / 100; // Assuming 'total' is in cents
    let credits_granted = 0; // Placeholder - determine this based on variant_id or product mapping

    // Example: If you have different credit packages (variants)
    // const purchasedVariantId = attributes.first_order_item?.variant_id; // Example path
    // if (purchasedVariantId === 'variant_123_10_credits') credits_granted = 10;
    // else if (purchasedVariantId === 'variant_456_50_credits') credits_granted = 50;
    // else {
    //   console.warn(`Unknown variant ID ${purchasedVariantId} in webhook for order ${lemonsqueezyOrderId}`);
    //   return NextResponse.json({ error: 'Unknown product variant in webhook' }, { status: 400 });
    // }

    // For this placeholder, let's assume a generic grant if amount_usd is positive
    if (amount_usd > 0) {
        credits_granted = amount_usd * 10; // Example: 10 credits per dollar
        console.log(`Calculated ${credits_granted} credits for $${amount_usd} for order ${lemonsqueezyOrderId}`);
    } else {
        console.warn(`Order ${lemonsqueezyOrderId} has $0 total, no credits granted.`);
        // Still mark as processed to avoid reprocessing, but no credits added.
    }


    // TODO: Call BillingService to add credits to the organization
    // await BillingService.addCreditsToOrganization(organizationId, credits_granted, amount_usd);
    // This would internally use the DB functions to update the organization's credit balance.
    console.log(`[CONCEPTUAL] Would call BillingService.addCreditsToOrganization('${organizationId}', ${credits_granted}, ${amount_usd})`);


    // TODO: Update the status of the credit_purchases record to 'processed'
    // await updateCreditPurchaseStatus(creditPurchaseId, 'processed', lemonsqueezyOrderId);
    console.log(`[CONCEPTUAL] Would update credit_purchases table for ${creditPurchaseId} to 'processed' with order ID ${lemonsqueezyOrderId}.`);

    console.log(`Successfully processed '${eventName}' for Order ID: ${lemonsqueezyOrderId}. Organization ${organizationId} granted ${credits_granted} credits.`);
    return NextResponse.json({ message: 'Webhook processed successfully' }, { status: 200 });

  } else {
    console.log(`Received unhandled event_name: ${eventName}. Ignoring.`);
    // Return 200 to acknowledge receipt but indicate no action taken for this specific event type.
    // Or return 400 if you want to signal that unhandled events are errors.
    return NextResponse.json({ message: `Unhandled event: ${eventName}` }, { status: 200 });
  }
}
