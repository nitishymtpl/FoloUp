// src/lib/lemonsqueezy.test.ts
import { createCheckout } from './lemonsqueezy';

// Mock global fetch
global.fetch = jest.fn();

// Mock environment variables
const mockApiKey = 'test_api_key';
const mockStoreId = '12345';
const mockAppUrl = 'https://testapp.com';

const originalEnv = process.env;

describe('Lemonsqueezy Wrapper - createCheckout', () => {
  beforeEach(() => {
    jest.resetAllMocks(); // Clears mock usage counts and implementations
    process.env = {
      ...originalEnv,
      LEMONSQUEEZY_API_KEY: mockApiKey,
      LEMONSQUEEZY_STORE_ID: mockStoreId,
      NEXT_PUBLIC_APP_URL: mockAppUrl,
    };
  });

  afterAll(() => {
    process.env = originalEnv; // Restore original environment
  });

  it('should return an error if API key is missing', async () => {
    delete process.env.LEMONSQUEEZY_API_KEY;
    const result = await createCheckout({
      variantId: 'var_1',
      organizationId: 'org_1',
      creditPurchaseId: 'cp_1',
    });
    expect(result.error).toBe('Lemonsqueezy API key or Store ID not configured.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should return an error if Store ID is missing', async () => {
    delete process.env.LEMONSQUEEZY_STORE_ID;
    const result = await createCheckout({
      variantId: 'var_1',
      organizationId: 'org_1',
      creditPurchaseId: 'cp_1',
    });
    expect(result.error).toBe('Lemonsqueezy API key or Store ID not configured.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should call Lemonsqueezy API and return checkout_url on success', async () => {
    const mockVariantId = '123';
    const mockOrganizationId = 'org_test_123';
    const mockCreditPurchaseId = 'cp_test_123';
    const mockUserEmail = 'test@example.com';
    const mockUserName = 'Test User';
    const mockCheckoutUrlFromApi = 'https://store.lemonsqueezy.com/checkout/buy/some-checkout-id';

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        data: {
          attributes: {
            url: mockCheckoutUrlFromApi,
          },
        },
      }),
    });

    const result = await createCheckout({
      variantId: mockVariantId,
      organizationId: mockOrganizationId,
      creditPurchaseId: mockCreditPurchaseId,
      userEmail: mockUserEmail,
      userName: mockUserName,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.lemonsqueezy.com/v1/checkouts',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          'Authorization': `Bearer ${mockApiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              store_id: parseInt(mockStoreId, 10),
              variant_id: parseInt(mockVariantId, 10),
              checkout_options: {
                redirect_url: `${mockAppUrl}/payment-status?purchase_id=${mockCreditPurchaseId}&org_id=${mockOrganizationId}`,
              },
              checkout_data: {
                email: mockUserEmail,
                name: mockUserName,
                custom: {
                  organization_id: mockOrganizationId,
                  credit_purchase_id: mockCreditPurchaseId,
                  client_reference_id: mockOrganizationId,
                },
              },
            },
            relationships: {
              store: { data: { type: 'stores', id: mockStoreId } },
              variant: { data: { type: 'variants', id: mockVariantId } },
            },
          },
        }),
      })
    );
    expect(result.checkout_url).toBe(mockCheckoutUrlFromApi);
    expect(result.error).toBeUndefined();
  });

  it('should return an error if Lemonsqueezy API returns an error', async () => {
    const mockApiErrorDetail = 'Invalid variant ID.';
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        errors: [{ detail: mockApiErrorDetail }],
      }),
    });

    const result = await createCheckout({
      variantId: 'invalid_var',
      organizationId: 'org_1',
      creditPurchaseId: 'cp_1',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.error).toBe(mockApiErrorDetail);
    expect(result.checkout_url).toBeUndefined();
  });

  it('should return a generic error if Lemonsqueezy API error format is unexpected', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        // No 'errors' array or 'detail' field
        message: "Internal Server Error"
      }),
    });

    const result = await createCheckout({
      variantId: 'var_1',
      organization_id: 'org_1',
      creditPurchaseId: 'cp_1',
    });
    expect(result.error).toBe('Failed to create Lemonsqueezy checkout.');
  });


  it('should return an error if fetch throws a network error', async () => {
    const networkErrorMessage = 'Network request failed';
    (fetch as jest.Mock).mockRejectedValueOnce(new Error(networkErrorMessage));

    const result = await createCheckout({
      variantId: 'var_1',
      organizationId: 'org_1',
      creditPurchaseId: 'cp_1',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.error).toBe(`Failed to create Lemonsqueezy checkout: ${networkErrorMessage}`);
    expect(result.checkout_url).toBeUndefined();
  });
});
