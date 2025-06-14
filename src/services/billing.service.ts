// src/services/billing.service.ts
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

const supabase = createClientComponentClient();

// --- Conceptual Credit System Interfaces ---
// These type aliases define the conceptual functions for a credit-based billing system.
// In a real-world scenario, these would be backed by actual database interactions
// (e.g., a table storing organization credit balances and transaction logs).

/**
 * Retrieves the current credit balance for a given organization.
 * In a real system, this would query a database table.
 * For new organizations, this might also handle initializing their starting credits (e.g., $2 bonus).
 */
export type GetOrganizationCreditBalance = (organizationId: string) => Promise<number>;

/**
 * Updates the credit balance for a given organization.
 * This would typically be called after a billable event is processed using credits,
 * or when credits are manually added or adjusted.
 * `lastTransactionCost` is optional and can be used for logging or audit trails.
 */
export type UpdateOrganizationCreditBalance = (organizationId: string, newBalance: number, lastTransactionCost?: number) => Promise<void>;

/**
 * Conceptually, this function would grant initial credits to a new organization (e.g., $2 bonus).
 * In practice, its logic might be folded into the initial call to `getOrganizationCreditBalance`
 * for a new organization, or handled during organization creation. For mocked scenarios,
 * the mock for `getOrganizationCreditBalance` will simulate this initial grant.
 */
export type InitializeOrganizationCredits = (organizationId: string) => Promise<void>;

// --- End Conceptual Credit System Interfaces ---

// const FREE_TRIAL_DURATION_SECONDS = 120; // Removed: Free trial is now handled by initial credits.

// Define a constant for the initial credit amount for clarity.
const INITIAL_CREDIT_AMOUNT_USD = 2.00;

export interface BillableEventData { // Added export
  id: string; // Assuming UUID
  organization_id: string;
  interview_id: string;
  response_id: string | number;
  duration_seconds: number;
  cost_usd: number;
  status: string; // Possible statuses: 'pending_payment', 'paid', 'payment_failed', 'payment_error', 'payment_config_error', 'payment_failed_no_method', 'paid_by_credits', 'payment_failed_insufficient_credits', 'pending_credit_check', 'no_charge'
  billed_at: string; // Or Date, Supabase returns string for timestamptz
  created_at?: string; // Optional, as it has a DB default
  updated_at?: string; // Optional, as it has a DB default & trigger
}

const calculateInterviewCost = (actual_call_duration_seconds: number): number => {
  if (actual_call_duration_seconds <= 0) {
    return 0;
  }
  // Cost is $2 for every 10 minutes (600 seconds)
  const cost = (actual_call_duration_seconds / 600) * 2;
  // Rounding to 4 decimal places for precision, can be adjusted as needed
  return parseFloat(cost.toFixed(4));
};

const updateBillableEventStatus = async (eventId: string, status: string) => {
  console.log(`Updating billable event ${eventId} to status ${status}`);
  const { data, error } = await supabase
    .from('billable_events')
    .update({ status: status, updated_at: new Date().toISOString() }) // Trigger also updates updated_at
    .eq('id', eventId)
    .select(); // To get the updated row back

  if (error) {
    console.error(`Error updating billable event ${eventId} status:`, error);
    // Potentially throw error or return error object
    return null;
  }
  // Supabase returns an array, so pick the first element.
  return data && data.length > 0 ? data[0] : null;
};

// --- Supabase-backed Credit System Functions ---

/**
 * Retrieves the organization's credit balance from the 'organization_credits' table.
 * Handles initial credit grant of $2.00 if the organization record doesn't exist or if initial credit hasn't been applied.
 * Assumes 'organization_credits' table has: organization_id (PK), current_balance_usd, initial_credit_applied (boolean).
 */
async function getOrganizationCreditBalanceFromDB(organizationId: string): Promise<number> {
  console.log(`Fetching credit balance from DB for organization ${organizationId}.`);
  const { data: creditRecord, error: fetchError } = await supabase
    .from('organization_credits')
    .select('*')
    .eq('organization_id', organizationId)
    .single();

  if (fetchError) {
    // PGRST116: PostgREST code for "Not Found"
    if (fetchError.code === 'PGRST116') {
      console.log(`No credit record found for organization ${organizationId}. Creating record and applying initial $${INITIAL_CREDIT_AMOUNT_USD} credit.`);
      const { error: insertError } = await supabase
        .from('organization_credits')
        .insert({
          organization_id: organizationId,
          current_balance_usd: INITIAL_CREDIT_AMOUNT_USD,
          initial_credit_applied: true
        });

      if (insertError) {
        console.error(`Error inserting initial credit record for organization ${organizationId}:`, insertError);
        throw insertError; // Rethrow or handle more gracefully
      }
      return INITIAL_CREDIT_AMOUNT_USD;
    } else {
      // Other unexpected database error
      console.error(`Error fetching credit balance for organization ${organizationId}:`, fetchError);
      throw fetchError; // Rethrow or handle
    }
  }

  if (creditRecord) {
    if (creditRecord.initial_credit_applied === false) {
      console.log(`Initial credit not yet applied for organization ${organizationId}. Current balance: ${creditRecord.current_balance_usd}. Applying $${INITIAL_CREDIT_AMOUNT_USD}.`);
      const newBalance = creditRecord.current_balance_usd + INITIAL_CREDIT_AMOUNT_USD;
      const { error: updateError } = await supabase
        .from('organization_credits')
        .update({ current_balance_usd: newBalance, initial_credit_applied: true })
        .eq('organization_id', organizationId);

      if (updateError) {
        console.error(`Error applying initial credit update for organization ${organizationId}:`, updateError);
        throw updateError; // Rethrow or handle
      }
      console.log(`Organization ${organizationId} new balance after initial credit: $${newBalance}.`);
      return newBalance;
    } else {
      console.log(`Organization ${organizationId} current balance from DB: $${creditRecord.current_balance_usd}. Initial credit already applied.`);
      return creditRecord.current_balance_usd;
    }
  }

  // Fallback, though theoretically unreachable if PGRST116 is handled for null creditRecord
  console.warn(`Credit record for organization ${organizationId} was unexpectedly null without a PGRST116 error. Treating as new organization.`);
  // This path should ideally not be hit if Supabase client behaves as expected with .single()
  // Re-attempting insert as a safety, though this indicates an unusual state.
  const { error: fallbackInsertError } = await supabase
    .from('organization_credits')
    .insert({
      organization_id: organizationId,
      current_balance_usd: INITIAL_CREDIT_AMOUNT_USD,
      initial_credit_applied: true
    });

  if (fallbackInsertError) {
    console.error(`Fallback Error inserting initial credit record for organization ${organizationId}:`, fallbackInsertError);
    throw fallbackInsertError;
  }
  return INITIAL_CREDIT_AMOUNT_USD;
}

/**
 * Updates the organization's credit balance in the 'organization_credits' table.
 */
async function updateOrganizationCreditBalanceInDB(organizationId: string, newBalance: number): Promise<void> {
  console.log(`Updating credit balance in DB for organization ${organizationId} to $${newBalance}.`);
  const { error } = await supabase
    .from('organization_credits')
    .update({ current_balance_usd: newBalance })
    .eq('organization_id', organizationId);

  if (error) {
    console.error(`Error updating credit balance for organization ${organizationId} in DB:`, error);
    throw error; // Rethrow or handle
  }
}


/**
 * Fetches only the current balance without applying any initial credit logic.
 * Used when a direct, non-side-effecting read of the balance is needed, typically before an update.
 */
async function getRawCreditBalanceForUpdate(organizationId: string): Promise<number> {
  console.log(`Fetching raw credit balance for update for organization ${organizationId}.`);
  const { data: creditRecord, error: fetchError } = await supabase
    .from('organization_credits')
    .select('current_balance_usd')
    .eq('organization_id', organizationId)
    .single();

  if (fetchError) {
    // PGRST116: PostgREST code for "Not Found"
    if (fetchError.code === 'PGRST116') {
      console.error(`No credit record found for organization ${organizationId} during raw balance fetch. This is unexpected if credits are being added to an existing org or one that should have been initialized.`);
      // Returning 0 as a "safe" default, but this situation might warrant specific error handling
      // if an organization is expected to exist before credits can be added.
      return 0;
    } else {
      console.error(`Error fetching raw credit balance for organization ${organizationId}:`, fetchError);
      throw fetchError;
    }
  }

  if (!creditRecord) {
     console.error(`No credit record (null data) for organization ${organizationId} during raw balance fetch without PGRST116 error. Returning 0.`);
     return 0;
  }

  return creditRecord.current_balance_usd;
}


/**
 * Adds a specified amount of USD credits to an organization's balance.
 */
async function addCreditsToOrganization(organizationId: string, amount_usd: number): Promise<void> {
  console.log(`Attempting to add $${amount_usd} credits to organization ${organizationId}.`);

  if (typeof amount_usd !== 'number' || amount_usd <= 0) {
    console.error(`Invalid amount for adding credits: ${amount_usd}. Must be a positive number.`);
    throw new Error('Credit amount must be a positive number.');
  }

  // It's crucial to get the balance without triggering the "initial credit grant" logic again here.
  // If the org doesn't exist, getRawCreditBalanceForUpdate will return 0.
  // If this is the first time credits are added (e.g. via webhook after purchase),
  // and the organization_credits record does not exist yet, this implies an issue or
  // that getOrganizationCreditBalanceFromDB (with its auto-creation logic) should have been called first
  // at some point (e.g. first usage of a feature).
  // For robustness, if getRaw returns 0 because the record doesn't exist, this addition will effectively
  // set their balance to amount_usd and then updateOrganizationCreditBalanceInDB would need to handle upsert or ensure record exists.
  // However, updateOrganizationCreditBalanceInDB currently only updates.
  // A truly robust addCredits would first ensure the org record exists, perhaps by calling getOrganizationCreditBalanceFromDB
  // if getRaw returns 0 and no record was found, or by having update do an upsert.
  // For this iteration, we assume if we are adding credits, the record should exist or getRawCreditBalanceForUpdate handles it.
  // A simpler approach for addCredits is that it expects the record to exist.

  // To ensure the record exists, especially if this is the first interaction that adds credits,
  // let's use getOrganizationCreditBalanceFromDB which creates/initializes if needed.
  // Then, we subtract the initial credit if it was just applied by that function to get the "true" starting point before this addition.

  let currentBalanceWithoutInitialGrantEffect = await getOrganizationCreditBalanceFromDB(organizationId);

  // If getOrganizationCreditBalanceFromDB just created the record and applied initial $2,
  // and we are adding purchased credits, we need to adjust.
  // This logic is getting complex. Simpler: getRaw and if it's 0 and record was not found,
  // then the updateOrganizationCreditBalanceInDB should probably be an upsert.

  // Revisiting: getRawCreditBalanceForUpdate is simpler. If it returns 0 because no record,
  // updateOrganizationCreditBalanceInDB will fail if it only updates.
  // Let's assume for addCreditsToOrganization, the organization_credits record *must* exist.
  // If it might not (e.g. first purchase webhook), the webhook handler should call getOrganizationCreditBalanceFromDB first
  // to ensure the record is created with initial credits, THEN call addCreditsToOrganization.
  // So, getRawCreditBalanceForUpdate is fine if the above precondition holds.

  const currentBalance = await getRawCreditBalanceForUpdate(organizationId);
  // If currentBalance is 0 because the record didn't exist, and we try to add $10, newBalance is $10.
  // updateOrganizationCreditBalanceInDB would then try to update a non-existent record if not an upsert.
  // Given the current updateOrganizationCreditBalanceInDB, it will fail if the record doesn't exist.
  // This implies that an organization *must* have an existing credit record before addCreditsToOrganization is called.
  // This is a reasonable assumption if getOrganizationCreditBalanceFromDB is triggered by any app usage.

  const newBalance = currentBalance + amount_usd;

  await updateOrganizationCreditBalanceInDB(organizationId, newBalance);
  console.log(`Successfully added $${amount_usd} credits to organization ${organizationId}. New balance: $${newBalance}.`);
}

// --- End Supabase-backed Credit System Functions ---

const processEventWithCredits = async (billableEvent: BillableEventData) => {
  console.log(`Processing event ID: ${billableEvent.id} for organization: ${billableEvent.organization_id} with cost: $${billableEvent.cost_usd} using DB credit system.`);

  if (billableEvent.cost_usd === 0) {
    console.log(`Event ${billableEvent.id} has zero cost. Setting status to 'no_charge'.`);
    await updateBillableEventStatus(billableEvent.id, 'no_charge');
    return;
  }

  // Get current credit balance from DB
  const currentBalance = await getOrganizationCreditBalanceFromDB(billableEvent.organization_id);
  console.log(`Organization ${billableEvent.organization_id} has current credit balance from DB: $${currentBalance}. Event cost: $${billableEvent.cost_usd}`);

  if (currentBalance >= billableEvent.cost_usd) {
    // Sufficient credits available
    const newBalance = currentBalance - billableEvent.cost_usd;
    await updateOrganizationCreditBalanceInDB(billableEvent.organization_id, newBalance);
    console.log(`Event ${billableEvent.id} paid by credits. New DB balance for org ${billableEvent.organization_id}: $${newBalance}.`);
    await updateBillableEventStatus(billableEvent.id, 'paid_by_credits');
  } else {
    // Insufficient credits
    console.log(`Insufficient credits for event ${billableEvent.id}. Org ${billableEvent.organization_id} DB balance: $${currentBalance}, Cost: $${billableEvent.cost_usd}.`);
    await updateBillableEventStatus(billableEvent.id, 'payment_failed_insufficient_credits');
    // Note: In a full system, this might then trigger an attempt to charge a real payment method.
  }
};


const createBillableEvent = async (
  organization_id: string,
  interview_id: string,
  response_id: string | number,
  duration_seconds: number,
  cost_usd: number, // This parameter is for API consistency but will be ignored. Cost is always calculated.
) => {
  // Cost is always calculated based on duration.
  const calculated_cost_usd = calculateInterviewCost(duration_seconds);
  // Initial status for all new billable events is 'pending_credit_check'.
  const initial_status = 'pending_credit_check';

  console.log(`Creating billable event for interview ${interview_id} (duration: ${duration_seconds}s). Calculated cost: $${calculated_cost_usd}. Initial status: ${initial_status}.`);

  const { data: insertedData, error } = await supabase
    .from('billable_events')
    .insert([{
      organization_id,
      interview_id,
      response_id,
      duration_seconds,
      cost_usd: calculated_cost_usd,
      status: initial_status,
    }])
    .select();

  if (error) {
    console.error('Error creating billable event:', error);
    return null;
  }

  // Option 1: Trigger credit processing immediately (asynchronously)
  if (insertedData && insertedData.length > 0) {
    const newEvent = insertedData[0] as BillableEventData;
    // All successfully created events will go through credit processing.
    // processEventWithCredits will handle $0 cost events by setting status to 'no_charge'.
    console.log(`Event ID: ${newEvent.id} created successfully with status '${newEvent.status}'. Proceeding to process with credits.`);
    processEventWithCredits(newEvent);
  }
  // Option 2: Batch processing via a scheduled job.
  // Option 3: Manual invoicing.
  // We are choosing Option 1 for now.

  return insertedData;
};

const getBillableEventsByOrganization = async (organizationId: string): Promise<BillableEventData[]> => {
  console.log(`Fetching billable events for organization ${organizationId}`);
  const { data, error } = await supabase
    .from('billable_events')
    .select('*')
    .eq('organization_id', organizationId)
    .order('billed_at', { ascending: false }); // Or 'created_at'

  if (error) {
    console.error('Error fetching billable events:', error);
    throw error; // Or return an empty array / handle error as preferred
  }
  return (data as BillableEventData[]) || [];
};

export const BillingService = {
  calculateInterviewCost,
  createBillableEvent,
  processEventWithCredits,
  getBillableEventsByOrganization,
  addCreditsToOrganization, // Exporting the new function
};
