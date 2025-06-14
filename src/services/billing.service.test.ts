// src/services/billing.service.test.ts

// Mock Supabase client
const mockSupabaseFrom = jest.fn().mockReturnThis();
const mockSupabaseInsert = jest.fn();
const mockSupabaseUpdate = jest.fn();
const mockSupabaseSelect = jest.fn();
const mockSupabaseEq = jest.fn().mockReturnThis();

jest.mock('@supabase/auth-helpers-nextjs', () => ({
  createClientComponentClient: () => ({
    from: mockSupabaseFrom,
    insert: mockSupabaseInsert,
    update: mockSupabaseUpdate,
    select: mockSupabaseSelect,
    eq: mockSupabaseEq,
  }),
}));

// Import the service and types
import { BillingService, BillableEventData } from './billing.service';
// mockCreditBalances is no longer imported

// Mocks for Supabase client methods
// These will be recreated for each test in beforeEach
let mockFrom: jest.Mock;
let mockSelect: jest.Mock;
let mockSingle: jest.Mock;
let mockInsert: jest.Mock;
let mockUpdate: jest.Mock;
let mockEq: jest.Mock;

jest.mock('@supabase/auth-helpers-nextjs', () => ({
  createClientComponentClient: () => ({
    from: (tableName: string) => mockFrom(tableName), // mockFrom will be a jest.fn()
  }),
}));

beforeEach(() => {
  // Recreate mocks for each test to ensure isolation
  mockSelect = jest.fn().mockReturnThis(); // .select() returns 'this' for chaining
  mockSingle = jest.fn();                   // .single() is the terminal call for selects
  mockInsert = jest.fn().mockReturnThis(); // .insert() returns 'this' for chaining (if .select().single() follows)
  mockUpdate = jest.fn().mockReturnThis(); // .update() returns 'this' for chaining
  mockEq = jest.fn().mockReturnThis();       // .eq() returns 'this' for chaining

  // mockFrom will inspect the table name and return an object with specific method mocks
  mockFrom = jest.fn((tableName: string) => {
    // Default behavior: return all method mocks
    // Specific tests can override mockSingle, mockInsert.select().single(), mockUpdate.eq() as needed
    return {
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      eq: mockEq, // .eq is often chained from select, update, delete
      // .single() is typically chained from select or insert
      // We will mock it directly where it's called, e.g., mockSelect.mockReturnThis() and then mockSingle separately
    };
  });

  // Reset all mocks (including those within createClientComponentClient)
  jest.clearAllMocks();
});

describe('BillingService', () => {

  describe('calculateInterviewCost', () => {
    it('should return 0 for 0 seconds', () => {
      expect(BillingService.calculateInterviewCost(0)).toBe(0);
    });

    it('should calculate cost correctly for 5 minutes (300 seconds)', () => {
      // (300 / 600) * 2 = 0.5 * 2 = 1
      expect(BillingService.calculateInterviewCost(300)).toBe(1.0);
    });

    it('should calculate cost correctly for 10 minutes (600 seconds)', () => {
      // (600 / 600) * 2 = 1 * 2 = 2
      expect(BillingService.calculateInterviewCost(600)).toBe(2.0);
    });

    it('should calculate cost correctly for 15 minutes (900 seconds)', () => {
      // (900 / 600) * 2 = 1.5 * 2 = 3
      expect(BillingService.calculateInterviewCost(900)).toBe(3.0);
    });

    it('should calculate cost correctly for 1 second (and handle rounding)', () => {
      expect(BillingService.calculateInterviewCost(1)).toBe(0.0033);
    });

    it('should calculate cost correctly for 121 seconds (just over 2 minutes)', () => {
      expect(BillingService.calculateInterviewCost(121)).toBe(0.4033);
    });
  });

  describe('addCreditsToOrganization', () => {
    const orgId = 'test-org-add-credits';

    it('should throw an error for invalid amount_usd (0 or negative)', async () => {
      await expect(BillingService.addCreditsToOrganization(orgId, 0)).rejects.toThrow('Credit amount must be a positive number.');
      await expect(BillingService.addCreditsToOrganization(orgId, -10)).rejects.toThrow('Credit amount must be a positive number.');
    });

    it('should add credits to an existing balance', async () => {
      const initialBalance = 50;
      const creditsToAdd = 20;
      const expectedNewBalance = 70;

      // Mock getRawCreditBalanceForUpdate
      // It selects 'current_balance_usd' from 'organization_credits'
      mockFrom.mockImplementation((tableName) => {
        if (tableName === 'organization_credits') {
          mockSelect.mockImplementation(() => {
            mockEq.mockImplementation((columnName, value) => {
              if (columnName === 'organization_id' && value === orgId) {
                mockSingle.mockResolvedValueOnce({ data: { current_balance_usd: initialBalance }, error: null });
                return { single: mockSingle };
              }
              return { single: jest.fn().mockResolvedValueOnce({ data: null, error: new Error('Unexpected eq call in select for getRaw')}) };
            });
            return { eq: mockEq };
          });
           // Mock update for updateOrganizationCreditBalanceInDB
          mockUpdate.mockImplementation((updateData) => {
            expect(updateData.current_balance_usd).toBe(expectedNewBalance);
            mockEq.mockImplementation((col, val) => {
               if (col === 'organization_id' && val === orgId) return { /* eq: */ jest.fn().mockResolvedValueOnce({ error: null }) }; // update().eq() successful
               return { /* eq: */ jest.fn().mockResolvedValueOnce({ error: new Error('Unexpected eq call in update')}) };
            });
            return { eq: mockEq };
          });
          return { select: mockSelect, update: mockUpdate };
        }
        return { select: mockSelect, update: mockUpdate, insert: mockInsert, eq: mockEq }; // Default for other tables
      });

      await BillingService.addCreditsToOrganization(orgId, creditsToAdd);

      expect(mockFrom).toHaveBeenCalledWith('organization_credits'); // For getRaw
      expect(mockSelect).toHaveBeenCalledWith('current_balance_usd');
      expect(mockEq).toHaveBeenCalledWith('organization_id', orgId); // For getRaw

      expect(mockFrom).toHaveBeenCalledWith('organization_credits'); // For update
      expect(mockUpdate).toHaveBeenCalledWith({ current_balance_usd: expectedNewBalance });
      expect(mockEq).toHaveBeenCalledWith('organization_id', orgId); // For update
    });

    it('should set credits if organization had no prior balance (getRaw returns 0)', async () => {
      const creditsToAdd = 20;
      const expectedNewBalance = 20;

      mockFrom.mockImplementation((tableName) => {
        if (tableName === 'organization_credits') {
          mockSelect.mockImplementation(() => {
            mockEq.mockResolvedValueOnce({ single: jest.fn().mockResolvedValueOnce({ data: { current_balance_usd: 0 }, error: null }) });
            return { eq: mockEq };
          });
           mockUpdate.mockImplementation((updateData) => {
            expect(updateData.current_balance_usd).toBe(expectedNewBalance);
            mockEq.mockResolvedValueOnce({ /* eq: */ error: null });
            return { eq: mockEq };
          });
          return { select: mockSelect, update: mockUpdate };
        }
        return { select: mockSelect, update: mockUpdate, insert: mockInsert, eq: mockEq };
      });

      await BillingService.addCreditsToOrganization(orgId, creditsToAdd);
      expect(mockUpdate).toHaveBeenCalledWith({ current_balance_usd: expectedNewBalance });
    });


    it('should propagate error if getRawCreditBalanceForUpdate fails', async () => {
      const dbError = new Error('DB error during getRawCreditBalanceForUpdate');
       mockFrom.mockImplementation((tableName) => {
        if (tableName === 'organization_credits') {
          mockSelect.mockImplementation(() => ({
            eq: jest.fn().mockReturnValueOnce({
              single: jest.fn().mockRejectedValueOnce(dbError)
            })
          }));
          return { select: mockSelect };
        }
         return { select: mockSelect, update: mockUpdate, insert: mockInsert, eq: mockEq };
      });

      await expect(BillingService.addCreditsToOrganization(orgId, 20)).rejects.toThrow(dbError);
    });

    it('should propagate error if updateOrganizationCreditBalanceInDB fails', async () => {
      const dbError = new Error('DB error during updateOrganizationCreditBalanceInDB');
      mockFrom.mockImplementation((tableName) => {
        if (tableName === 'organization_credits') {
           mockSelect.mockResolvedValueOnce({ // For getRaw
            eq: jest.fn().mockReturnValueOnce({
              single: jest.fn().mockResolvedValueOnce({ data: { current_balance_usd: 10 }, error: null })
            })
          });
          mockUpdate.mockImplementation(() => ({ // For update
            eq: jest.fn().mockReturnValueOnce({
              /* eq: */mockRejectedValueOnce(dbError) //This is tricky, update().eq() should return a promise
            })
          }));
           // A more accurate mock for update().eq()... that throws:
           mockUpdate.mockImplementation(() => {
             mockEq.mockImplementation(() => Promise.reject(dbError)); // Make the chained call reject
             return { eq: mockEq };
           });

          return { select: mockSelect, update: mockUpdate };
        }
        return { select: mockSelect, update: mockUpdate, insert: mockInsert, eq: mockEq };
      });

      // Need to ensure getRaw part succeeds
       mockFrom.mockImplementation((tableName) => {
        if (tableName === 'organization_credits') {
          if (mockSelect.mock.calls.length < 1) { // First call (getRaw)
             return { select: () => ({ eq: () => ({ single: jest.fn().mockResolvedValueOnce({ data: { current_balance_usd: 10 }, error: null }) }) }) };
          } else { // Second call (update)
             return { update: () => ({ eq: jest.fn().mockRejectedValueOnce(dbError) }) };
          }
        }
        return { select: mockSelect, update: mockUpdate, insert: mockInsert, eq: mockEq };
      });


      await expect(BillingService.addCreditsToOrganization(orgId, 20)).rejects.toThrow(dbError);
    });
  });

  describe('createBillableEvent & processEventWithCredits Integration', () => {
    const INITIAL_CREDIT_USD_FOR_TEST = 2; // Align with INITIAL_CREDIT_USD in service

    const INITIAL_CREDIT_AMOUNT_USD_FOR_TEST = 2.00; // From billing.service.ts

    // Helper to set up mocks for billable event creation
    const mockBillableEventInsert = (eventData: Partial<BillableEventData>) => {
        // When supabase.from('billable_events').insert(...) is called
        mockFrom.mockImplementation((tableName) => {
            if (tableName === 'billable_events') {
                mockInsert.mockImplementation(() => { // The actual insert
                    // .select().single() is often called after insert
                    mockSelect.mockImplementation(() => {
                        mockSingle.mockResolvedValueOnce({ data: eventData, error: null });
                        return { single: mockSingle };
                    });
                    return { select: mockSelect };
                });
                return { insert: mockInsert };
            }
            // Fallback for other tables if needed during a test
            return { select: mockSelect, insert: mockInsert, update: mockUpdate, eq: mockEq };
        });
    };

    // Helper to mock responses from 'organization_credits' table
    const mockOrgCreditsSelect = (data: any, error?: any) => {
        mockFrom.mockImplementation((tableName) => {
            if (tableName === 'organization_credits') {
                mockSelect.mockImplementation(() => {
                    mockEq.mockImplementation(() => { // .eq() call
                        mockSingle.mockResolvedValueOnce({ data, error });
                        return { single: mockSingle };
                    });
                    return { eq: mockEq };
                });
                return { select: mockSelect, insert: mockInsert, update: mockUpdate };
            }
            // Important: allow 'billable_events' table calls for event status updates
            if (tableName === 'billable_events') {
                return { update: mockUpdate, eq: mockEq, select: mockSelect }; // Allow .update().eq().select()
            }
            return { select: mockSelect, insert: mockInsert, update: mockUpdate, eq: mockEq };
        });
    };

    const mockOrgCreditsInsertSuccess = () => {
         mockFrom.mockImplementation((tableName) => {
            if (tableName === 'organization_credits') {
                mockInsert.mockResolvedValueOnce({ error: null }); // Simplified: insert doesn't chain to select().single() in the code for this path
                return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate };
            }
            if (tableName === 'billable_events') { // for status updates
                 return { update: mockUpdate, eq: mockEq, select: mockSelect };
            }
            return { select: mockSelect, insert: mockInsert, update: mockUpdate, eq: mockEq };
        });
    };

    const mockOrgCreditsUpdateSuccess = () => {
        mockFrom.mockImplementation((tableName) => {
            if (tableName === 'organization_credits') {
                mockUpdate.mockImplementation(() => {
                    mockEq.mockResolvedValueOnce({ error: null }); // .update().eq()
                    return { eq: mockEq };
                });
                return { update: mockUpdate, select: mockSelect, insert: mockInsert };
            }
             if (tableName === 'billable_events') { // for status updates
                 return { update: mockUpdate, eq: mockEq, select: mockSelect };
            }
            return { select: mockSelect, insert: mockInsert, update: mockUpdate, eq: mockEq };
        });
    };


    it('Scenario 1: New Org - Event cost $1 - status paid_by_credits, $1 credit remains', async () => {
      const orgId = 'org-new-pays-1';
      const duration = 300; // Costs $1
      const cost = 1.0;
      const eventId = `evt-${orgId}-${duration}`;

      // 1. Billable event insertion
      mockBillableEventInsert({ id: eventId, organization_id: orgId, duration_seconds: duration, cost_usd: cost, status: 'pending_credit_check' });

      // 2. getOrganizationCreditBalanceFromDB: No record found
      mockOrgCreditsSelect(null, { code: 'PGRST116' }); // This will trigger insert
      // 3. getOrganizationCreditBalanceFromDB: Insert initial credit (will be chained by test setup)
      //    Need to ensure 'from' is re-mockable for multiple calls if not chained.
      //    The mockOrgCreditsSelect and mockOrgCreditsInsertSuccess will need to be called sequentially by the test logic
      //    or the mockFrom needs to be more sophisticated.
      //    For now, assume subsequent calls to from() get fresh mocks.

      // Mock sequence for getOrganizationCreditBalanceFromDB (first call for org)
      mockFrom.mockImplementationOnce((tableName) => { // For initial select (not found)
          if (tableName === 'organization_credits') return { select: () => ({ eq: () => ({ single: jest.fn().mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' }}) }) }) };
          return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate }; // default for other tables
      }).mockImplementationOnce((tableName) => { // For insert of new credit record
          if (tableName === 'organization_credits') return { insert: jest.fn().mockResolvedValueOnce({ error: null }) };
           return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate };
      }).mockImplementationOnce((tableName) => { // For update of billable_event status
          if (tableName === 'billable_events') return { update: () => ({ eq: () => ({ select: jest.fn().mockResolvedValueOnce({data: [{id: eventId, status: 'paid_by_credits'}], error: null}) }) }) };
           return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate };
      }).mockImplementationOnce((tableName) => { // For update of organization_credits (deduct cost)
          if (tableName === 'organization_credits') return { update: () => ({ eq: jest.fn().mockResolvedValueOnce({ error: null }) }) };
           return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate };
      });


      await BillingService.createBillableEvent(orgId, 'int1', 'res1', duration, cost);

      // Assertions
      // Billable event initially inserted
      expect(mockFrom).toHaveBeenCalledWith('billable_events');
      expect(mockInsert).toHaveBeenCalledWith([expect.objectContaining({ organization_id: orgId, cost_usd: cost, status: 'pending_credit_check' })]);

      // Credit balance checks
      expect(mockFrom).toHaveBeenCalledWith('organization_credits'); // For select
      expect(mockFrom).toHaveBeenCalledWith('organization_credits'); // For insert (initial credit)
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ organization_id: orgId, current_balance_usd: INITIAL_CREDIT_AMOUNT_USD_FOR_TEST, initial_credit_applied: true }));

      // Credit balance update (deduct cost)
      expect(mockFrom).toHaveBeenCalledWith('organization_credits'); // For update
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ current_balance_usd: INITIAL_CREDIT_AMOUNT_USD_FOR_TEST - cost }));

      // Final event status update
      expect(mockFrom).toHaveBeenCalledWith('billable_events'); // For status update
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid_by_credits' }));
    });

    // Simplified additional tests due to mock complexity. Focus on the logic flow.
    it('Scenario 3: Existing Org, initial credit applied, sufficient balance ($5) - Event costs $1 - status paid_by_credits', async () => {
        const orgId = 'org-existing-sufficient';
        const duration = 300; // $1 cost
        const cost = 1.0;
        const eventId = `evt-${orgId}-${duration}`;

        mockBillableEventInsert({ id: eventId, organization_id: orgId, duration_seconds: duration, cost_usd: cost, status: 'pending_credit_check' });

        mockFrom.mockImplementationOnce((tableName) => { // For initial select (found with $5)
            if (tableName === 'organization_credits') return { select: () => ({ eq: () => ({ single: jest.fn().mockResolvedValueOnce({ data: { organization_id: orgId, current_balance_usd: 5.00, initial_credit_applied: true }, error: null }) }) }) };
             return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate };
        }).mockImplementationOnce((tableName) => { // For update of billable_event status
            if (tableName === 'billable_events') return { update: () => ({ eq: () => ({ select: jest.fn().mockResolvedValueOnce({data: [{id: eventId, status: 'paid_by_credits'}], error: null}) }) }) };
             return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate };
        }).mockImplementationOnce((tableName) => { // For update of organization_credits (deduct cost)
            if (tableName === 'organization_credits') return { update: () => ({ eq: jest.fn().mockResolvedValueOnce({ error: null }) }) };
             return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate };
        });

        await BillingService.createBillableEvent(orgId, 'int2', 'res2', duration, cost);

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ current_balance_usd: 4.00 })); // 5 - 1
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid_by_credits' }));
    });

    it('Scenario 4: Existing Org, insufficient balance ($0.50) - Event costs $1 - status payment_failed_insufficient_credits', async () => {
        const orgId = 'org-existing-insufficient';
        const duration = 300; // $1 cost
        const cost = 1.0;
        const eventId = `evt-${orgId}-${duration}`;

        mockBillableEventInsert({ id: eventId, organization_id: orgId, duration_seconds: duration, cost_usd: cost, status: 'pending_credit_check' });

        mockFrom.mockImplementationOnce((tableName) => { // For initial select (found with $0.50)
            if (tableName === 'organization_credits') return { select: () => ({ eq: () => ({ single: jest.fn().mockResolvedValueOnce({ data: { organization_id: orgId, current_balance_usd: 0.50, initial_credit_applied: true }, error: null }) }) }) };
             return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate };
        }).mockImplementationOnce((tableName) => { // For update of billable_event status
            if (tableName === 'billable_events') return { update: () => ({ eq: () => ({ select: jest.fn().mockResolvedValueOnce({data: [{id: eventId, status: 'payment_failed_insufficient_credits'}], error: null}) }) }) };
             return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate };
        });
        // No update to organization_credits table for deduction

        await BillingService.createBillableEvent(orgId, 'int3', 'res3', duration, cost);

        // Check that update for credit deduction was NOT called on organization_credits
        const orgCreditsUpdateCall = mockUpdate.mock.calls.find(call => mockFrom.mock.calls.some(fromCall => fromCall[0] === 'organization_credits' && call));
        expect(orgCreditsUpdateCall).toBeUndefined();

        expect(mockFrom).toHaveBeenCalledWith('billable_events');
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'payment_failed_insufficient_credits' }));
    });


    it('Scenario 5: $0 cost event - status no_charge', async () => {
        const orgId = 'org-zero-cost-event';
        const duration = 0; // $0 cost
        const cost = 0.0;
        const eventId = `evt-${orgId}-${duration}`;

        mockBillableEventInsert({ id: eventId, organization_id: orgId, duration_seconds: duration, cost_usd: cost, status: 'pending_credit_check' });

        // getOrganizationCreditBalanceFromDB will not be called if cost is 0 by processEventWithCredits
        // So, no need to mock 'organization_credits' table for this one, only billable_events update.
         mockFrom.mockImplementationOnce((tableName) => {
            if (tableName === 'billable_events') return { update: () => ({ eq: () => ({ select: jest.fn().mockResolvedValueOnce({data: [{id: eventId, status: 'no_charge'}], error: null}) }) }) };
             return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate };
        });

        await BillingService.createBillableEvent(orgId, 'int4', 'res4', duration, cost);

        expect(mockFrom).toHaveBeenCalledWith('billable_events');
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'no_charge' }));
    });


    it('should not update status if creating billable_event fails in DB', async () => {
      mockFrom.mockImplementationOnce((tableName) => {
          if (tableName === 'billable_events') {
              return {
                  insert: jest.fn().mockImplementation(() => ({ // The actual insert
                    select: jest.fn().mockImplementation(() => ({
                        single: jest.fn().mockResolvedValueOnce({ data: null, error: new Error('DB Insert failed') })
                    }))
                  }))
              };
          }
          return { insert: mockInsert, select: mockSelect, eq: mockEq, update: mockUpdate };
      });


      await BillingService.createBillableEvent('org_db_fail', 'int_db_fail', 'res_db_fail', 300, 1);

      expect(mockFrom).toHaveBeenCalledWith('billable_events');
      expect(mockInsert).toHaveBeenCalled();

      // update on billable_events for status change should NOT have been called
      const billableEventsUpdateCall = mockUpdate.mock.calls.find(call => mockFrom.mock.calls.some(fromCall => fromCall[0] === 'billable_events' && call));
      expect(billableEventsUpdateCall).toBeUndefined();
    });
  });
});

// Minimal definition for BillableEventData if not exported/accessible (should match service)
// Ideally, this is imported directly from the service file if exported.
// For the test to run, place this definition here or ensure it's correctly imported.
// The BillableEventData interface is now imported from './billing.service'
