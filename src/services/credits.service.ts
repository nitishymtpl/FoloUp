import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { Database } from '@/types/database.types'; // Adjust path if necessary

const supabase = createClientComponentClient<Database>();

const getCreditBalance = async (
  entityType: 'user' | 'organization',
  entityId: string
): Promise<number> => {
  const tableName = entityType === 'user' ? 'user' : 'organization';
  const { data, error } = await supabase
    .from(tableName)
    .select('credits')
    .eq('id', entityId)
    .single();

  if (error) {
    console.error(`Error fetching ${entityType} credits:`, error);
    // Consider how to handle this - throw error or return 0?
    // For now, returning 0 if not found or error, assuming balance check might happen before entity creation in some flows.
    return 0;
  }
  // Supabase returns NUMERIC as string or number depending on context, ensure it's a number.
  // The type from database.types.ts is `number | null`.
  return Number(data?.credits ?? 0);
};

const addCredits = async (
  entityType: 'user' | 'organization',
  entityId: string,
  amountToAdd: number,
  transactionType: string,
  transactionDescription?: string,
  paymentGatewayTxId?: string
): Promise<boolean> => {
  const tableName = entityType === 'user' ? 'user' : 'organization';
  // Fetching current balance first to correctly calculate new balance.
  // This could lead to a race condition if multiple calls happen simultaneously.
  // For higher concurrency, a Supabase function (RPC) that does read-update-insert in a transaction would be better.
  const currentBalance = await getCreditBalance(entityType, entityId);
  const newBalance = currentBalance + amountToAdd;

  const { error: updateError } = await supabase
    .from(tableName)
    .update({ credits: newBalance })
    .eq('id', entityId);

  if (updateError) {
    console.error(`Error updating ${entityType} credits:`, updateError);
    return false;
  }

  const transactionData: Database['public']['Tables']['credit_transactions']['Insert'] = {
    [entityType === 'user' ? 'user_id' : 'organization_id']: entityId,
    amount: amountToAdd,
    type: transactionType,
    description: transactionDescription,
    payment_gateway_transaction_id: paymentGatewayTxId,
  };

  const { error: transactionError } = await supabase
    .from('credit_transactions')
    .insert(transactionData);

  if (transactionError) {
    console.error('Error creating credit transaction:', transactionError);
    // Potentially roll back or flag the balance update if critical.
    // For now, if transaction fails, the balance update is not rolled back.
    return false;
  }

  return true;
};

// This function will be used to deduct credits later
const deductCredits = async (
  entityType: 'user' | 'organization',
  entityId: string,
  amountToDeduct: number, // Should be a positive value
  transactionType: string,
  transactionDescription?: string
): Promise<boolean> => {
  if (amountToDeduct <= 0) {
    console.error("Deduction amount must be positive.");
    return false;
  }
  // Reuse addCredits with a negative amount for deduction
  return addCredits(entityType, entityId, -amountToDeduct, transactionType, transactionDescription);
};


export const CreditService = {
  addCredits,
  deductCredits,
  getCreditBalance,
};
