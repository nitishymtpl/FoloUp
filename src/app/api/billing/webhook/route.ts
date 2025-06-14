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

// Import Supabase client and BillingService
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'; // Or your server-side client
import { BillingService } from '@/services/billing.service';

const supabase = createClientComponentClient(); // Or your preferred way to get a server-side client

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

  // Actual Lemonsqueezy signature verification
  try {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8');
    const receivedSignatureBuffer = Buffer.from(signature, 'utf8');

    if (!crypto.timingSafeEqual(digest, receivedSignatureBuffer)) {
      console.warn('Invalid webhook signature: Hashes do not match.');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
    console.log('Webhook signature verified successfully.');
  } catch (error: any) {
    // This catch block handles errors primarily from crypto.timingSafeEqual (e.g. different buffer lengths)
    // or other unexpected errors during the crypto operations.
    console.warn('Error during signature verification:', error.message);
    return NextResponse.json({ error: 'Invalid signature format or verification error' }, { status: 400 });
  }

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
  // const organizationId = customData.organization_id; // Initial declaration removed
  // const creditPurchaseId = customData.credit_purchase_id; // Initial declaration removed

  // Extract relevant data from webhook payload
  const lemonsqueezyOrderId = attributes.order_number?.toString(); // Ensure it's a string if it can be number
  const organizationId = customData.organization_id; // Use this single declaration
  const creditPurchaseId = customData.credit_purchase_id; // Use this single declaration
  const variantIdRequested = attributes.first_order_item?.variant_id?.toString(); // Example path, adjust as per actual payload
  const totalFromAttributes = attributes.total; // This is usually in cents

  if (!lemonsqueezyOrderId) {
    console.warn('Webhook payload missing lemonsqueezy_order_id (data.attributes.order_number)');
    return NextResponse.json({ error: 'Missing order number in webhook payload' }, { status: 400 });
  }
  if (!organizationId || !creditPurchaseId) {
    console.warn('Webhook payload missing organization_id or credit_purchase_id in custom_data');
    return NextResponse.json({ error: 'Missing custom_data fields in webhook payload' }, { status: 400 });
  }


  console.log(`Processing event: ${eventName}, LS Order ID: ${lemonsqueezyOrderId}, Org ID: ${organizationId}, Credit Purchase ID: ${creditPurchaseId}`);

  // --- Processing Logic for 'order_created' (or relevant success event) ---
  // TODO: Confirm 'order_created' is the correct event from Lemonsqueezy for a successful one-time purchase.
  if (eventName === 'order_created') {
    const amount_usd = typeof totalFromAttributes === 'number' ? totalFromAttributes / 100 : 0;
    // TODO: Determine credits_granted based on variantIdRequested or other product info in webhook
    // This is a placeholder calculation. In reality, you'd map variantIdRequested to a specific credit amount.
    let credits_granted = 0;
    if (amount_usd > 0) {
        credits_granted = Math.floor(amount_usd * 10); // Example: 10 credits per dollar, ensuring integer
        console.log(`Calculated ${credits_granted} credits for $${amount_usd} for LS Order ID: ${lemonsqueezyOrderId}`);
    } else {
        console.warn(`LS Order ID ${lemonsqueezyOrderId} has $0 total or invalid total, 0 credits granted.`);
    }

    // 1. Attempt to record the purchase (Idempotency)
    try {
      console.log(`Attempting to insert into credit_purchases for LS Order ID: ${lemonsqueezyOrderId}, Credit Purchase ID: ${creditPurchaseId}`);
      const { error: insertError } = await supabase
        .from('credit_purchases')
        .insert({
          id: creditPurchaseId, // Our generated UUID
          lemonsqueezy_order_id: lemonsqueezyOrderId,
          organization_id: organizationId,
          variant_id_requested: variantIdRequested,
          amount_usd: amount_usd,
          credits_granted: credits_granted,
          status: 'pending_processing', // Initial status
          lemonsqueezy_response: eventPayload, // Store the raw webhook payload
        })
        .select() // Not strictly needed to chain .single() after insert if not using the returned data immediately
        .single(); // Use .single() if you expect to use the inserted data or want stricter error on multiple inserts (though PK should prevent)

      if (insertError) {
        // PostgreSQL unique_violation error code
        if (insertError.code === '23505') {
          console.warn(`Duplicate event: Credit purchase for LS Order ID ${lemonsqueezyOrderId} (Our ID: ${creditPurchaseId}) already exists. Idempotency check passed.`);
          return NextResponse.json({ message: 'Duplicate event: Already processed or being processed.' }, { status: 200 });
        } else {
          console.error(`Database error inserting credit purchase for LS Order ID ${lemonsqueezyOrderId}:`, insertError);
          return NextResponse.json({ error: 'Database error recording purchase.' }, { status: 500 });
        }
      }
      console.log(`Successfully inserted into credit_purchases for LS Order ID: ${lemonsqueezyOrderId}, Credit Purchase ID: ${creditPurchaseId}. Status: pending_processing.`);

    } catch (e: any) { // Catch any other unexpected error during insert attempt
        console.error(`Unexpected error during credit_purchases insert for LS Order ID ${lemonsqueezyOrderId}:`, e.message);
        return NextResponse.json({ error: 'Unexpected error recording purchase.' }, { status: 500 });
    }

    // 2. Call BillingService to add credits and update purchase record
    try {
      if (credits_granted > 0 && organizationId) {
        await BillingService.addCreditsToOrganization(organizationId, credits_granted); // amount_usd is used by addCreditsToOrganization for logging/audit if needed, but credits_granted is the key value.
        console.log(`Successfully called addCreditsToOrganization for Org ID: ${organizationId}, Credits: ${credits_granted}.`);
      } else if (credits_granted === 0) {
        console.log(`No credits to grant for Org ID: ${organizationId} (amount_usd was ${amount_usd}). Purchase will be marked processed without credit addition.`);
      }


      // Update status in credit_purchases to 'processed'
      const { error: updateStatusError } = await supabase
        .from('credit_purchases')
        .update({ status: 'processed', processed_at: new Date().toISOString() })
        .eq('id', creditPurchaseId);

      if (updateStatusError) {
        console.error(`Error updating credit_purchase ${creditPurchaseId} to 'processed' for LS Order ID ${lemonsqueezyOrderId}:`, updateStatusError);
        // Critical: Credits might have been applied, but status update failed. Manual reconciliation might be needed.
        // For now, return 500, but consider more robust retry or alerting here.
        return NextResponse.json({ error: 'Failed to finalize purchase status.' }, { status: 500 });
      }

      console.log(`Successfully processed event for LS Order ID: ${lemonsqueezyOrderId}. Org: ${organizationId} granted ${credits_granted} credits. Purchase ID ${creditPurchaseId} marked 'processed'.`);
      return NextResponse.json({ message: 'Webhook processed successfully.' }, { status: 200 });

    } catch (serviceError: any) {
      console.error(`Error processing credits for LS Order ID ${lemonsqueezyOrderId} (Org: ${organizationId}):`, serviceError.message);
      // Update status in credit_purchases to 'failed'
      try {
        const { error: updateFailError } = await supabase
          .from('credit_purchases')
          .update({ status: 'failed', failure_reason: serviceError.message || 'Failed to apply credits to organization.' })
          .eq('id', creditPurchaseId);
        if (updateFailError) {
          console.error(`CRITICAL: Error updating credit_purchase ${creditPurchaseId} to 'failed' after service error:`, updateFailError);
        }
      } catch (nestedError: any) {
         console.error(`CRITICAL: Nested error while updating credit_purchase ${creditPurchaseId} to 'failed':`, nestedError.message);
      }
      return NextResponse.json({ error: 'Failed to process credits for organization.' }, { status: 500 });
    }
  } else {
    console.log(`Received and ignoring unhandled event_name: ${eventName}.`);
    return NextResponse.json({ message: `Unhandled event: ${eventName}` }, { status: 200 });
  }
}
