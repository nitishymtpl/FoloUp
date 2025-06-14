import { NextRequest, NextResponse } from 'next/server';
import { createLsCheckoutUrl } from '@/lib/lemonsqueezy'; // Adjust path if necessary
import { getAuth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database.types'; // For typing Supabase client

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
// Use Database type for better type safety with Supabase client
const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { amount, entityType, entityId } = body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount.' }, { status: 400 });
    }
    if (!entityType || (entityType !== 'user' && entityType !== 'organization')) {
      return NextResponse.json({ error: 'Invalid entity type.' }, { status: 400 });
    }
    if (!entityId || typeof entityId !== 'string') { // Ensure entityId is a string
      return NextResponse.json({ error: 'Invalid entity ID.' }, { status: 400 });
    }

    const { userId: clerkUserId } = getAuth(req); // orgId from Clerk not directly used here for entity selection
    if (!clerkUserId) {
      return NextResponse.json({ error: 'User not authenticated.' }, { status: 401 });
    }

    let userEmail: string | undefined;
    let userName: string | undefined; // Optional: fetch user name if available

    // Fetch user from Supabase to get email and name
    // clerkUserId from getAuth() is the ID of the authenticated user.
    // We assume this clerkUserId corresponds to the 'id' field in our public.user table.
    const { data: userData, error: userError } = await supabase
      .from('user') // Corrected table name to 'user'
      .select('email, id') // Assuming 'name' is not on 'user' table, or fetch if it is.
      .eq('id', clerkUserId)
      .single();

    if (userError || !userData) {
        console.error("Could not fetch user email for checkout using clerkUserId:", clerkUserId, userError);
    } else {
        userEmail = userData.email ?? undefined; // userData.email is `string | null`
        // If you have a name field on your user table, you can fetch it:
        // userName = userData.name ?? undefined;
    }

    if (!userEmail) {
         // Log the entity details for which email fetch failed
         console.error(`Could not determine user email for checkout. Clerk User ID: ${clerkUserId}, Entity ID: ${entityId}, Entity Type: ${entityType}`);
         return NextResponse.json({ error: 'Could not determine user email for checkout.' }, { status: 500 });
    }

    // Amount should be in cents for Lemon Squeezy
    const amountInCents = Math.round(amount * 100);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    // Construct redirect URL. Consider making it more dynamic or entity-specific if needed.
    const redirectUrl = `${appUrl}/dashboard?recharge_status=pending`; // Start with pending, webhook will confirm

    const checkoutUrl = await createLsCheckoutUrl({
      amount: amountInCents,
      entityType,
      entityId, // This is the ID of the user/org to credit, passed from frontend
      userEmail,
      userName,
      redirectUrl,
    });

    if (!checkoutUrl) {
      return NextResponse.json({ error: 'Failed to create checkout session.' }, { status: 500 });
    }

    return NextResponse.json({ checkoutUrl });

  } catch (error) {
    console.error('Recharge checkout error:', error);
    // Check if error is an instance of Error to access message property
    const errorMessage = error instanceof Error ? error.message : 'Internal server error.';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
