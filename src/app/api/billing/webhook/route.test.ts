// src/app/api/billing/webhook/route.test.ts
import { POST } from './route';
// NextResponse is not directly used in tests but is part of the route's operation
import * as BillingService from '@/services/billing.service';
import crypto from 'crypto'; // Original crypto for test signature generation

// --- Mock crypto module ---
const mockTimingSafeEqual = jest.fn();
const mockDigest = jest.fn();
const mockUpdate = jest.fn().mockReturnThis(); // .update() returns 'this' for chaining
const mockCreateHmac = jest.fn().mockReturnValue({ update: mockUpdate, digest: mockDigest });

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'), // Retain other crypto parts if needed elsewhere
  createHmac: () => mockCreateHmac(),
  timingSafeEqual: (a: Buffer, b: Buffer) => mockTimingSafeEqual(a, b),
}));

// --- Mock Supabase client ---
// (Reusing Supabase mock structure from billing.service.test.ts)
let mockFrom: jest.Mock;
let mockSelect: jest.Mock;
let mockSingle: jest.Mock;
let mockInsert: jest.Mock;
let mockUpdateSupabase: jest.Mock; // Renamed to avoid conflict with crypto's mockUpdate
let mockEq: jest.Mock;

jest.mock('@supabase/auth-helpers-nextjs', () => ({
  createClientComponentClient: () => ({
    from: (tableName: string) => mockFrom(tableName),
  }),
}));

jest.mock('@/services/billing.service', () => ({
  BillingService: {
    addCreditsToOrganization: jest.fn(),
  },
}));


describe('/api/billing/webhook POST handler', () => {
  let mockRequest: Partial<Request>;
  const originalEnv = process.env;
  const mockWebhookSecret = 'test_webhook_secret_for_route';
  const realCrypto = jest.requireActual('crypto'); // For generating test signatures

  const createMockRequest = (body: any, signature?: string, headers?: HeadersInit): Partial<Request> => {
    const rawBody = JSON.stringify(body);
    return {
      text: jest.fn().mockResolvedValue(rawBody),
      json: jest.fn().mockResolvedValue(body),
      headers: new Headers(headers || (signature && { 'X-Signature': signature }) || {}),
    };
  };

  const generateTestSignature = (body: string, secret: string) => {
    return realCrypto.createHmac('sha256', secret).update(body).digest('hex');
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      LEMONSQUEEZY_WEBHOOK_SECRET: mockWebhookSecret,
    };

    // Reset Supabase mocks
    mockSelect = jest.fn().mockReturnThis();
    mockSingle = jest.fn();
    mockInsert = jest.fn().mockReturnThis(); // Important: insert itself returns 'this' for .select().single()
    mockUpdateSupabase = jest.fn().mockReturnThis();
    mockEq = jest.fn().mockReturnThis();
    mockFrom = jest.fn((tableName: string) => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdateSupabase,
      eq: mockEq,
    }));

    // Reset crypto mocks
    mockCreateHmac.mockReturnValue({ update: mockUpdate, digest: mockDigest });
    mockUpdate.mockReturnThis(); // Ensure chaining for update
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // --- Signature Verification Tests ---
  describe('Signature Verification', () => {
    const testPayload = { meta: { event_name: 'test_event' }, data: { attributes: {} }, custom_data: {} };
    const rawTestPayload = JSON.stringify(testPayload);

    it('should return 500 if LEMONSQUEEZY_WEBHOOK_SECRET is not configured', async () => {
      delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
      mockRequest = createMockRequest(testPayload, 'any-sig');
      const response = await POST(mockRequest as Request);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Webhook secret not configured');
    });

    it('should return 400 if X-Signature header is missing', async () => {
      mockRequest = createMockRequest(testPayload); // No signature
      const response = await POST(mockRequest as Request);
      expect(response.status).toBe(400);
    });

    it('should return 400 if signature verification fails (timingSafeEqual returns false)', async () => {
      mockDigest.mockReturnValue('calculated_hash_hex');
      mockTimingSafeEqual.mockReturnValue(false);
      mockRequest = createMockRequest(testPayload, 'invalid_received_signature');
      const response = await POST(mockRequest as Request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid signature');
    });

    it('should return 400 if timingSafeEqual throws (e.g. different buffer lengths)', async () => {
      mockDigest.mockReturnValue('calculated_hash_hex');
      mockTimingSafeEqual.mockImplementation(() => { throw new Error("Buffers not same length"); });
      mockRequest = createMockRequest(testPayload, 'short_sig');
      const response = await POST(mockRequest as Request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Invalid signature format or verification error');
    });

    it('should proceed if signature is valid', async () => {
      mockDigest.mockReturnValue('correct_hash_hex'); // This is what hmac.update(rawBody).digest('hex') would return
      mockTimingSafeEqual.mockReturnValue(true);

      // Mock for credit_purchases insert to prevent error further down for this specific test
      mockFrom.mockImplementation((tableName) => {
        if (tableName === 'credit_purchases') {
          mockInsert.mockImplementation(() => ({
            select: () => ({
              single: jest.fn().mockResolvedValue({ data: { id: 'cp_1' }, error: null })
            })
          }));
          return { insert: mockInsert };
        }
        return { update: mockUpdateSupabase, eq: mockEq, select: mockSelect };
      });

      const payload = {
        meta: { event_name: 'order_created', custom_data: { organization_id: 'org_1', credit_purchase_id: 'cp_1' } },
        data: { attributes: { order_number: 'order_123', total: 1000 } }
      };
      mockRequest = createMockRequest(payload, 'valid_signature_format'); // Signature format is what's passed to Buffer.from
      (BillingService.BillingService.addCreditsToOrganization as jest.Mock).mockResolvedValue(undefined); // Prevent error later

      const response = await POST(mockRequest as Request);
      expect(response.status).toBe(200); // Should not fail on signature
    });
  });

  // --- Payload and Data Integrity Tests ---
  it('should return 400 if JSON payload is invalid after signature check', async () => {
    const rawBody = 'invalid-json-after-sig-check';
    mockDigest.mockReturnValue(generateTestSignature(rawBody, mockWebhookSecret)); // Use actual crypto for digest
    mockTimingSafeEqual.mockReturnValue(true); // Assume signature was valid

    mockRequest = {
        text: jest.fn().mockResolvedValue(rawBody), // This rawBody is used for sig check
        json: jest.fn().mockRejectedValueOnce(new Error("Cannot parse JSON")), // This mock is for the JSON.parse call
        headers: new Headers({ 'X-Signature': generateTestSignature(rawBody, mockWebhookSecret) }),
    };
    // Re-mock the JSON.parse call to fail
    const originalJsonParse = JSON.parse;
    JSON.parse = jest.fn().mockImplementationOnce(() => { throw new Error("Simulated JSON Parse Error")});

    const response = await POST(mockRequest as Request);
    JSON.parse = originalJsonParse; // Restore
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid JSON payload');
  });

  it('should return 400 if essential data fields are missing from payload', async () => {
    const payload = { meta: { event_name: 'order_created' }, data: { attributes: {} } }; // Missing custom_data
    const rawBody = JSON.stringify(payload);
    mockDigest.mockReturnValue(generateTestSignature(rawBody, mockWebhookSecret));
    mockTimingSafeEqual.mockReturnValue(true);
    mockRequest = createMockRequest(payload, generateTestSignature(rawBody, mockWebhookSecret));
    (mockRequest.text as jest.Mock).mockResolvedValue(rawBody);


    const response = await POST(mockRequest as Request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Missing essential event data');
  });

  // --- Idempotency and DB Interaction Tests ---
  describe('Idempotency and DB Interactions for "order_created"', () => {
    const orgId = 'org_id_idem_test';
    const creditPurchaseId = 'cp_uuid_idem_test';
    const lemonsqueezyOrderId = 'ls_order_idem_test';
    const variantId = 'var_idem_test';
    const amountUsd = 10.00;
    const creditsGranted = 100;
    const webhookPayload = {
      meta: { event_name: 'order_created', custom_data: { organization_id: orgId, credit_purchase_id: creditPurchaseId } },
      data: { attributes: { order_number: lemonsqueezyOrderId, total: amountUsd * 100, first_order_item: {variant_id: variantId} } }
    };
    const rawWebhookPayload = JSON.stringify(webhookPayload);

    beforeEach(() => {
      // Valid signature for all tests in this block
      mockDigest.mockReturnValue(generateTestSignature(rawWebhookPayload, mockWebhookSecret));
      mockTimingSafeEqual.mockReturnValue(true);
      (BillingService.BillingService.addCreditsToOrganization as jest.Mock).mockResolvedValue(undefined);
    });

    it('Scenario 1: New Event - Successful Processing', async () => {
      mockFrom.mockImplementation((tableName: string) => {
        if (tableName === 'credit_purchases') {
          mockInsert.mockImplementation(() => ({ // insert()
            select: () => ({ // select()
              single: jest.fn().mockResolvedValueOnce({ data: { id: creditPurchaseId /* ...other fields */ }, error: null }) // single()
            })
          }));
          mockUpdateSupabase.mockImplementation(() => ({ // update()
            eq: jest.fn().mockResolvedValueOnce({ error: null }) // eq()
          }));
        }
        return { insert: mockInsert, update: mockUpdateSupabase, select: mockSelect, eq: mockEq };
      });

      mockRequest = createMockRequest(webhookPayload, generateTestSignature(rawWebhookPayload, mockWebhookSecret));
      await POST(mockRequest as Request);

      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        id: creditPurchaseId,
        lemonsqueezy_order_id: lemonsqueezyOrderId,
        organization_id: orgId,
        status: 'pending_processing',
        amount_usd: amountUsd,
        credits_granted: creditsGranted
      }));
      expect(BillingService.BillingService.addCreditsToOrganization).toHaveBeenCalledWith(orgId, creditsGranted);
      expect(mockUpdateSupabase).toHaveBeenCalledWith(expect.objectContaining({ status: 'processed', processed_at: expect.any(String) }));
      expect(mockEq).toHaveBeenCalledWith('id', creditPurchaseId);

      // Call again to get response for status check
      const response = await POST(mockRequest as Request);
      expect(response.status).toBe(200); // Should be 200 due to idempotency now
      const responseBody = await response.json();
      expect(responseBody.message).toContain('Duplicate event');
    });

    it('Scenario 2: Duplicate Event (Unique Constraint Violation on Insert)', async () => {
       mockFrom.mockImplementation((tableName: string) => {
        if (tableName === 'credit_purchases') {
          mockInsert.mockImplementation(() => ({
            select: () => ({
              single: jest.fn().mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'unique_violation' } })
            })
          }));
        }
        return { insert: mockInsert, update: mockUpdateSupabase, select: mockSelect, eq: mockEq };
      });

      mockRequest = createMockRequest(webhookPayload, generateTestSignature(rawWebhookPayload, mockWebhookSecret));
      const response = await POST(mockRequest as Request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.message).toContain('Duplicate event');
      expect(BillingService.BillingService.addCreditsToOrganization).not.toHaveBeenCalled();
    });

    it('Scenario 3: New Event, addCreditsToOrganization Fails', async () => {
      const serviceErrorMessage = "Service Error: Can't add credits";
      (BillingService.BillingService.addCreditsToOrganization as jest.Mock).mockRejectedValueOnce(new Error(serviceErrorMessage));

      mockFrom.mockImplementation((tableName: string) => {
         if (tableName === 'credit_purchases') {
            mockInsert.mockImplementation(() => ({ // insert() success
                select: () => ({
                single: jest.fn().mockResolvedValueOnce({ data: { id: creditPurchaseId }, error: null })
                })
            }));
            mockUpdateSupabase.mockImplementation(() => ({ // update() to 'failed' success
                eq: jest.fn().mockResolvedValueOnce({ error: null })
            }));
         }
         return { insert: mockInsert, update: mockUpdateSupabase, select: mockSelect, eq: mockEq };
      });


      mockRequest = createMockRequest(webhookPayload, generateTestSignature(rawWebhookPayload, mockWebhookSecret));
      const response = await POST(mockRequest as Request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Failed to process credits for organization.');
      expect(BillingService.BillingService.addCreditsToOrganization).toHaveBeenCalledWith(orgId, creditsGranted);
      // Check that credit_purchases was updated to 'failed'
      expect(mockUpdateSupabase).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', failure_reason: serviceErrorMessage }));
      expect(mockEq).toHaveBeenCalledWith('id', creditPurchaseId);
    });

    it('Scenario 4: DB Error on Initial credit_purchases Insert (Non-duplicate)', async () => {
      const dbErrorMessage = "Generic DB Error on Insert";
      mockFrom.mockImplementation((tableName: string) => {
        if (tableName === 'credit_purchases') {
          mockInsert.mockImplementation(() => ({
            select: () => ({
              single: jest.fn().mockResolvedValueOnce({ data: null, error: { code: 'SOME_DB_ERROR', message: dbErrorMessage } })
            })
          }));
        }
        return { insert: mockInsert, update: mockUpdateSupabase, select: mockSelect, eq: mockEq };
      });

      mockRequest = createMockRequest(webhookPayload, generateTestSignature(rawWebhookPayload, mockWebhookSecret));
      const response = await POST(mockRequest as Request);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Database error recording purchase.');
      expect(BillingService.BillingService.addCreditsToOrganization).not.toHaveBeenCalled();
    });

    it('Scenario 5: DB Error on credit_purchases Update (after successful crediting)', async () => {
      const dbUpdateErrorMessage = "DB Error on Update";
      (BillingService.BillingService.addCreditsToOrganization as jest.Mock).mockResolvedValue(undefined); // Service call succeeds

      mockFrom.mockImplementation((tableName: string) => {
         if (tableName === 'credit_purchases') {
            mockInsert.mockImplementation(() => ({ // insert() success
                select: () => ({
                single: jest.fn().mockResolvedValueOnce({ data: { id: creditPurchaseId }, error: null })
                })
            }));
            mockUpdateSupabase.mockImplementation(() => ({ // update() to 'processed' fails
                eq: jest.fn().mockResolvedValueOnce({ error: new Error(dbUpdateErrorMessage) })
            }));
         }
         return { insert: mockInsert, update: mockUpdateSupabase, select: mockSelect, eq: mockEq };
      });

      mockRequest = createMockRequest(webhookPayload, generateTestSignature(rawWebhookPayload, mockWebhookSecret));
      const response = await POST(mockRequest as Request);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Failed to finalize purchase status.');
      expect(BillingService.BillingService.addCreditsToOrganization).toHaveBeenCalled();
    });
  });

  // Test for missing specific custom_data fields
  it('should return 400 if organization_id is missing from custom_data', async () => {
    const payload = {
        meta: { event_name: 'order_created', custom_data: { /* organization_id missing */ credit_purchase_id: 'cp_1' } },
        data: { attributes: { order_number: 'order_123', total: 1000 } }
    };
    const rawBody = JSON.stringify(payload);
    mockDigest.mockReturnValue(generateTestSignature(rawBody, mockWebhookSecret));
    mockTimingSafeEqual.mockReturnValue(true);
    mockRequest = createMockRequest(payload, generateTestSignature(rawBody, mockWebhookSecret));
     (mockRequest.text as jest.Mock).mockResolvedValue(rawBody);


    const response = await POST(mockRequest as Request);
    expect(response.status).toBe(400);
    const responseBody = await response.json();
    expect(responseBody.error).toBe('Missing custom_data fields in webhook payload');
  });

  it('should return 200 for unhandled event types', async () => {
    const payload = {
        meta: { event_name: 'unhandled_event', custom_data: { org: 'any', cp: 'any'} },
        data: { attributes: { order_number: 'order_other'} }
    };
    const rawBody = JSON.stringify(payload);
    mockDigest.mockReturnValue(generateTestSignature(rawBody, mockWebhookSecret));
    mockTimingSafeEqual.mockReturnValue(true);
    mockRequest = createMockRequest(payload, generateTestSignature(rawBody, mockWebhookSecret));
    (mockRequest.text as jest.Mock).mockResolvedValue(rawBody);

    const response = await POST(mockRequest as Request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe('Unhandled event: unhandled_event');
  });
});
