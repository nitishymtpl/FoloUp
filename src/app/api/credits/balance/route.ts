import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@clerk/nextjs/server';
import { CreditService } from '@/services/credits.service'; // Adjust path as necessary
import { logger } from '@/lib/logger'; // Adjust path as necessary

export async function GET(req: NextRequest) {
  try {
    const { userId } = getAuth(req); // orgId might be useful later, but not used for user balance

    if (!userId) {
      logger.warn('GET /api/credits/balance: User not authenticated.');
      return NextResponse.json({ error: 'User not authenticated.' }, { status: 401 });
    }

    // This endpoint specifically fetches the individual user's balance.
    // Future enhancements could involve query parameters for entityType and entityId if needed.
    const balance = await CreditService.getCreditBalance('user', userId);

    logger.info(`GET /api/credits/balance: Fetched credit balance for user ${userId}: ${balance}`);
    return NextResponse.json({ balance });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(`GET /api/credits/balance: Error fetching credit balance for user. Error: ${errorMessage}`, error);
    return NextResponse.json({ error: 'Internal server error fetching balance.' }, { status: 500 });
  }
}
