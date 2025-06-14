import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database.types'; // Adjust path as necessary
import { logger } from '@/lib/logger'; // Adjust path as necessary

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  logger.error('API/credits/transactions: Supabase URL or Service Role Key is not configured.');
  // This error will likely only be seen server-side during startup or first call in serverless
}

// Initialize Supabase client with service role key.
// This client bypasses RLS, so explicit user_id filtering is mandatory.
const supabase = createClient<Database>(supabaseUrl!, supabaseServiceRoleKey!);

export async function GET(req: NextRequest) {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      logger.warn('API/credits/transactions: User not authenticated.');
      return NextResponse.json({ error: 'User not authenticated.' }, { status: 401 });
    }

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      // Check again in case of runtime issues or if logger didn't stop execution.
      logger.error('API/credits/transactions: Supabase client not initialized due to missing config.');
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    const { data: transactions, error } = await supabase
      .from('credit_transactions')
      .select('id, amount, type, description, created_at')
      .eq('user_id', userId) // Crucial filter when using service role key
      .order('created_at', { ascending: false });

    if (error) {
      logger.error(`API/credits/transactions: Error fetching transactions for user ${userId}:`, error);
      // Do not expose detailed error messages to client unless necessary
      return NextResponse.json({ error: 'Failed to retrieve transactions.' }, { status: 500 });
    }

    logger.info(`API/credits/transactions: Fetched ${transactions?.length || 0} transactions for user ${userId}`);
    return NextResponse.json(transactions || []);

  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(`API/credits/transactions: Unhandled exception. Error: ${errorMessage}`, error);
    return NextResponse.json({ error: 'Internal server error fetching transactions.' }, { status: 500 });
  }
}
