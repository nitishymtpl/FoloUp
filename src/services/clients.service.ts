import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { CreditService } from './credits.service';
// Fallback for build time
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClientComponentClient();

const updateOrganization = async (payload: any, id: string) => {
  const { error, data } = await supabase
    .from("organization")
    .update({ ...payload })
    .eq("id", id);
  if (error) {
    console.log(error);

    return [];
  }

  return data;
};

const getClientById = async (
  id: string,
  email?: string | null,
  organization_id?: string | null,
) => {
  try {
    const { data, error } = await supabase
      .from("user")
      .select(`*`)
      .filter("id", "eq", id);

    if (!data || (data.length === 0 && email)) {
      const { error, data } = await supabase
        .from("user")
        .insert({ id: id, email: email, organization_id: organization_id });

      if (error) {
        console.log(error);

        return [];
      }

      // Add initial credits for new user
      if (data && data.length > 0) {
        // The 'id' parameter of getClientById is the new user's ID
        await CreditService.addCredits('user', id, 2.00, 'initial', 'Initial free trial credit');
      }

      return data ? data[0] : null;
    }

    if (data[0].organization_id !== organization_id) {
      const { error, data } = await supabase
        .from("user")
        .update({ organization_id: organization_id })
        .eq("id", id);

      if (error) {
        console.log(error);

        return [];
      }

      // Add initial credits for new organization
      if (data && data.length > 0 && organization_id) {
        // The 'organization_id' parameter is the new organization's ID
        await CreditService.addCredits('organization', organization_id, 2.00, 'initial', 'Initial free trial credit');
      }

      return data ? data[0] : null;
    }

    return data ? data[0] : null;
  } catch (error) {
    console.log(error);

    return [];
  }
};

const getOrganizationById = async (
  organization_id?: string,
  organization_name?: string,
) => {
  try {
    const { data, error } = await supabase
      .from("organization")
      .select(`*`)
      .filter("id", "eq", organization_id);

    if (!data || data.length === 0) {
      const { error, data } = await supabase
        .from("organization")
        .insert({ id: organization_id, name: organization_name });

      if (error) {
        console.log(error);

        return [];
      }

      return data ? data[0] : null;
    }

    if (organization_name && data[0].name !== organization_name) {
      const { error, data } = await supabase
        .from("organization")
        .update({ name: organization_name })
        .eq("id", organization_id);

      if (error) {
        console.log(error);

        return [];
      }

      return data ? data[0] : null;
    }

    return data ? data[0] : null;
  } catch (error) {
    console.log(error);

    return [];
  }
};

export const ClientService = {
  updateOrganization,
  getClientById,
  getOrganizationById,
};
