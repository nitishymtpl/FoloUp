import axios from 'axios';

const LEMONSQUEEZY_API_KEY = process.env.LEMONSQUEEZY_API_KEY;
const LEMONSQUEEZY_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID;
// This should be the ID of a "Pay what you want" or "Variable Price" product's variant in your Lemon Squeezy store
const VARIABLE_PRICE_VARIANT_ID = process.env.NEXT_PUBLIC_LEMONSQUEEZY_PRODUCT_ID_VARIABLE_PRICE; // Renamed for clarity

if (!LEMONSQUEEZY_API_KEY) {
  throw new Error('LEMONSQUEEZY_API_KEY is not set in environment variables.');
}
if (!LEMONSQUEEZY_STORE_ID) {
  throw new Error('LEMONSQUEEZY_STORE_ID is not set in environment variables.');
}
if (!VARIABLE_PRICE_VARIANT_ID) {
  throw new Error('NEXT_PUBLIC_LEMONSQUEEZY_PRODUCT_ID_VARIABLE_PRICE is not set in environment variables. This should be a Variant ID.');
}

const lemonSqueezyApi = axios.create({
  baseURL: 'https://api.lemonsqueezy.com/v1',
  headers: {
    'Accept': 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
    'Authorization': `Bearer ${LEMONSQUEEZY_API_KEY}`,
  },
});

interface CreateCheckoutOptions {
  amount: number; // Amount in cents
  entityType: 'user' | 'organization';
  entityId: string;
  userEmail: string; // Required by Lemon Squeezy
  userName?: string; // Optional, but good for prefill
  redirectUrl: string; // Where to redirect after payment
}

export const createLsCheckoutUrl = async ({
  amount,
  entityType,
  entityId,
  userEmail,
  userName,
  redirectUrl,
}: CreateCheckoutOptions): Promise<string | null> => {
  try {
    const response = await lemonSqueezyApi.post('/checkouts', {
      data: {
        type: 'checkouts',
        attributes: {
          // store_id: parseInt(LEMONSQUEEZY_STORE_ID, 10), // store_id is part of relationships now
          custom_price: amount, // Amount in cents
          product_options: {
            redirect_url: redirectUrl,
            // Embed entityType and entityId in checkout_data to retrieve in webhook
            // Note: Lemon Squeezy has specific fields for custom data, `checkout_data` at the top level is for prefill.
            // `meta` can be used on subscriptions, or `custom_data` on order items.
            // For checkouts, passing it via `checkout_data.custom` is a common way.
          },
          checkout_options: {
            embed: false,
          },
          checkout_data: {
             email: userEmail,
             name: userName,
             custom: {
                entity_id: entityId,
                entity_type: entityType,
                // clerk_user_id: clerkUserId, // Potentially pass clerk_user_id if needed in webhook directly
             }
          }
        },
        relationships: {
          store: {
            data: {
              type: 'stores',
              id: LEMONSQUEEZY_STORE_ID.toString(),
            },
          },
          variant: {
            data: {
              type: 'variants',
              id: VARIABLE_PRICE_VARIANT_ID.toString(), // This must be a variant ID
            },
          },
        },
      },
    });

    return response.data.data.attributes.url;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('Error creating Lemon Squeezy checkout:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error creating Lemon Squeezy checkout:', error.message);
    }
    return null;
  }
};
