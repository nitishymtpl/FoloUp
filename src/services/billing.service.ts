// src/services/billing.service.ts
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

const supabase = createClientComponentClient();

interface BillableEventData {
  id: string; // Assuming UUID
  organization_id: string;
  interview_id: string;
  response_id: string | number;
  duration_seconds: number;
  cost_usd: number;
  status: string;
  billed_at: string; // Or Date, Supabase returns string for timestamptz
  created_at?: string; // Optional, as it has a DB default
  updated_at?: string; // Optional, as it has a DB default & trigger
}

const calculateInterviewCost = (actual_call_duration_seconds: number): number => {
  if (actual_call_duration_seconds <= 0) {
    return 0;
  }
  // Cost is $0.20 for every 10 minutes (600 seconds)
  const cost = (actual_call_duration_seconds / 600) * 0.2;
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

const processPaymentForBillableEvent = async (billableEvent: BillableEventData) => {
  // TODO: Implement actual payment gateway integration (e.g., Lemon Squeezy) here.
  console.log(`Attempting to process payment for billable event ID: ${billableEvent.id} for organization: ${billableEvent.organization_id} with amount ${billableEvent.cost_usd}`);

  // 1. Identify/Retrieve organization's payment method (e.g., from a 'payment_methods' table or Lemon Squeezy Customer ID).
  //    const paymentMethod = await getPaymentMethodForOrganization(billableEvent.organization_id); // This might involve fetching a Lemon Squeezy subscription or customer details

  // 2. If no payment method or active subscription, mark event as 'payment_failed_no_method' or notify admin/org.
  //    if (!paymentMethod) { // Or !lemonSqueezyCustomerId or !activeSubscription
  //      await updateBillableEventStatus(billableEvent.id, 'payment_failed_no_method');
  //      console.log(`Payment failed for ${billableEvent.id}: No payment method or active subscription found for organization ${billableEvent.organization_id}`);
  //      return;
  //    }

  // 3. Attempt to charge the payment method using the payment gateway's API.
  //    try {
  //      // Example with Lemon Squeezy (actual API and SDK usage might differ)
  //      // const lemonSqueezy = new LemonSqueezy(process.env.LEMONSQUEEZY_API_KEY);
  //      // const charge = await lemonSqueezy.createCharge({ // Or createUsageRecord, createSubscriptionInvoice, etc.
  //      //   amount: Math.round(billableEvent.cost_usd * 100), // Amount in cents
  //      //   currency: 'USD',
  //      //   store_id: process.env.LEMONSQUEEZY_STORE_ID,
  //      //   customer_id: lemonSqueezyCustomerId, // Stored Lemon Squeezy customer ID for the organization
  //      //   // For usage-based billing, you might add to a subscription's usage or create a one-off charge.
  //      //   // This depends heavily on how Lemon Squeezy is configured (e.g., metered billing on a subscription).
  //      //   variant_id: process.env.LEMONSQUEEZY_USAGE_VARIANT_ID, // Example if charging for a specific product/variant
  //      //   quantity: billableEvent.duration_seconds, // Example: if your product is priced per second or per minute
  //      //   custom_data: { // Or metadata
  //      //     billable_event_id: billableEvent.id,
  //      //     organization_id: billableEvent.organization_id,
  //      //     interview_id: billableEvent.interview_id,
  //      //   }
  //      // });

  //      // if (charge && charge.data && charge.data.attributes.status === 'paid') { // Adjust based on Lemon Squeezy's actual response structure
  //      //   await updateBillableEventStatus(billableEvent.id, 'paid');
  //      //   console.log(`Payment successful for billable event ID: ${billableEvent.id}`);
  //      // } else {
  //      //   await updateBillableEventStatus(billableEvent.id, 'payment_failed');
  //      //   console.error(`Payment failed for billable event ID: ${billableEvent.id}. Status: ${charge?.data?.attributes?.status}`);
  //      // }
  //    } catch (error) {
  //      console.error('Error processing payment for billable event ID:', billableEvent.id, error);
  //      await updateBillableEventStatus(billableEvent.id, 'payment_error'); // Technical error during payment attempt
  //    }
  await updateBillableEventStatus(billableEvent.id, 'payment_processing_placeholder'); // Placeholder until actual implementation
};


const createBillableEvent = async (
  organization_id: string,
  interview_id: string,
  response_id: string | number,
  duration_seconds: number,
  cost_usd: number,
) => {
  const { data: insertedData, error } = await supabase
    .from('billable_events')
    .insert([{
      organization_id,
      interview_id,
      response_id,
      duration_seconds,
      cost_usd,
      status: 'pending_payment', // Default status
    }])
    .select();

  if (error) {
    console.error('Error creating billable event:', error);
    return null;
  }

  // TODO: Decide on payment processing strategy:
  // Option 1: Trigger payment immediately (asynchronously)
  //   if (insertedData && insertedData.length > 0) {
  //      // Ensure the insertedData[0] conforms to BillableEventData if directly passed
  //     processPaymentForBillableEvent(insertedData[0] as BillableEventData);
  //   }
  // Option 2: Batch processing via a scheduled job that picks up 'pending_payment' events.
  // Option 3: Manual invoicing based on accumulated 'pending_payment' events.

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
  processPaymentForBillableEvent,
  getBillableEventsByOrganization,
};
