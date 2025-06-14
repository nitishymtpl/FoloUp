import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { CreditService } from '@/services/credits.service'; // Adjust path if necessary
// Database type might not be directly needed here unless we do direct DB ops,
// but CreditService handles that. Included for consistency if ever needed.
import type { Database } from '@/types/database.types'; // Adjust path if necessary

const LEMONSQUEEZY_WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

if (!LEMONSQUEEZY_WEBHOOK_SECRET) {
  // Log a warning if the secret is not set during server startup/initialization phase
  // For a serverless function, this check will run on each invocation if not handled carefully.
  // It's good for awareness, but repeated logging might be noisy.
  console.warn('LEMONSQUEEZY_WEBHOOK_SECRET is not set in environment variables. Webhook verification will fail.');
}

// Helper to verify signature
// Note: Lemon Squeezy sends the signature in base64, but hmac digest is usually hex.
// The example uses hex for both digest and sig. Ensure this matches Lemon Squeezy's actual signature format.
// Lemon Squeezy docs state: "The X-Signature header is a HMAC SHA256 signature of the raw request body, signed using your webhook signing secret."
// They don't explicitly state the encoding of the signature itself (hex or base64). Assuming hex based on common practice.
async function verifySignature(req: NextRequest, rawBody: string): Promise<boolean> {
  if (!LEMONSQUEEZY_WEBHOOK_SECRET) {
    console.error("Cannot verify webhook signature: LEMONSQUEEZY_WEBHOOK_SECRET is not set.");
    return false;
  }
  const signatureHeader = req.headers.get('X-Signature');
  if (!signatureHeader) {
    console.warn("Webhook request is missing X-Signature header.");
    return false;
  }

  try {
    const hmac = crypto.createHmac('sha256', LEMONSQUEEZY_WEBHOOK_SECRET);
    const computedDigest = hmac.update(rawBody).digest('hex');

    // Ensure the comparison is done with buffers of the same length if timingSafeEqual is used.
    // However, since we are comparing hex strings, a direct string comparison is also possible,
    // but timingSafeEqual is preferred for security against timing attacks.
    // For timingSafeEqual, buffers must be of the same byte length.
    // Hex strings are twice the byte length.
    const computedDigestBuffer = Buffer.from(computedDigest, 'hex');
    const signatureBuffer = Buffer.from(signatureHeader, 'hex');

    if (computedDigestBuffer.length !== signatureBuffer.length) {
        console.warn("Webhook signature length mismatch after hex decoding.");
        return false;
    }

    return crypto.timingSafeEqual(computedDigestBuffer, signatureBuffer);
  } catch (error) {
    console.error("Error during webhook signature verification:", error);
    return false;
  }
}

export async function POST(req: NextRequest) {
  let rawBodyText = "";
  try {
    rawBodyText = await req.text(); // Read raw body for signature verification

    if (!LEMONSQUEEZY_WEBHOOK_SECRET) {
      // This check is important before attempting verification
      console.error('Webhook secret not configured. Cannot process webhook.');
      return NextResponse.json({ error: 'Webhook secret not configured. Critical server error.' }, { status: 500 });
    }

    if (!await verifySignature(req, rawBodyText)) {
      console.warn('Invalid Lemon Squeezy webhook signature.');
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
    }

    const event = JSON.parse(rawBodyText); // Parse body after verification

    // Primary event for successful one-time payments is 'order_created'
    // Subscription payments might use 'subscription_payment_succeeded' or similar.
    if (event.meta.event_name === 'order_created') {
      const orderData = event.data;
      const orderAttributes = orderData.attributes;

      // Check if the order status is 'paid'
      if (orderAttributes.status === 'paid') {
        // Custom data passed during checkout creation - expected in event.meta.custom_data
        const customData = event.meta?.custom_data;

        if (!customData || !customData.entity_id || !customData.entity_type) {
          console.error('Missing entity_id or entity_type in webhook custom_data. Expected in event.meta.custom_data. Found:', customData);
          return NextResponse.json({ error: 'Missing or invalid custom data in webhook payload (expected in event.meta.custom_data).' }, { status: 400 });
        }

        const entityId = customData.entity_id as string;
        const entityType = customData.entity_type as 'user' | 'organization';

        // Validate entityType again to be safe
        if (entityType !== 'user' && entityType !== 'organization') {
            console.error('Invalid entity_type in webhook custom_data:', entityType);
            return NextResponse.json({ error: 'Invalid entity type in custom data.' }, { status: 400 });
        }

        // Amount paid: `total` is in cents (integer)
        const amountInCents = orderAttributes.total as number;
        if (typeof amountInCents !== 'number') {
            console.error('Invalid or missing total amount in webhook payload:', orderAttributes.total);
            return NextResponse.json({ error: 'Invalid total amount in payload.' }, { status: 400 });
        }
        const amountInUSD = amountInCents / 100;

        // Lemon Squeezy Order ID (the 'id' of the order object)
        const paymentGatewayTxId = orderData.id as string;
        if (!paymentGatewayTxId) {
            console.error('Missing order ID in webhook payload:', orderData);
            return NextResponse.json({ error: 'Missing order ID in payload.' }, { status: 400 });
        }

        const success = await CreditService.addCredits(
          entityType,
          entityId,
          amountInUSD,
          'recharge', // transactionType
          `Credit recharge via Lemon Squeezy (Order: ${paymentGatewayTxId})`, // description
          paymentGatewayTxId // payment_gateway_transaction_id
        );

        if (!success) {
          console.error(`Failed to add credits for ${entityType} ${entityId} (Order: ${paymentGatewayTxId}). This requires investigation as payment was successful.`);
          // This is a critical error. Payment was made, but internal crediting failed.
          return NextResponse.json({ error: 'Failed to update credits in database after successful payment.' }, { status: 500 });
        }

        console.log(`Successfully processed Lemon Squeezy webhook for order ${paymentGatewayTxId}. Added ${amountInUSD} credits to ${entityType} ${entityId}.`);
      } else {
        // Order status is not 'paid' (e.g., 'pending', 'failed'). Log and ignore for credit addition.
        console.log(`Lemon Squeezy Order ${orderData.id} status is '${orderAttributes.status}'. No credits added.`);
      }
    } else {
      // Log other event types received, helps in debugging or discovering other useful events.
      console.log(`Received unhandled Lemon Squeezy event: '${event.meta.event_name}'.`);
    }

    return NextResponse.json({ received: true, processed_event: event.meta.event_name });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error('Error processing Lemon Squeezy webhook:', errorMessage, error);
    if (errorMessage.includes('JSON.parse') && rawBodyText) {
        // Log the raw body if JSON parsing failed, as it might be malformed.
        console.error("Webhook raw body causing JSON parse error was: ", rawBodyText.substring(0, 500) + "..."); // Log a snippet
    }
    return NextResponse.json({ error: 'Internal server error processing webhook.' }, { status: 500 });
  }
}
