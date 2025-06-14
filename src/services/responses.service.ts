import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { BillingService } from "../services/billing.service";
import { InterviewService } from "../services/interviews.service";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClientComponentClient();

const createResponse = async (payload: any) => {
  const { error, data } = await supabase
    .from("response")
    .insert({ ...payload })
    .select("id");

  if (error) {
    console.log(error);

    return [];
  }

  return data[0]?.id;
};

const saveResponse = async (payload: any, call_id: string) => {
  const { error: updateError, data: updatedResponseData } = await supabase
    .from("response")
    .update({ ...payload })
    .eq("call_id", call_id)
    .select(); // Assuming .select() returns the updated row(s)

  if (updateError) {
    console.error("Error updating response:", updateError);
    return null; // Return null or appropriate error response
  }

  if (!updatedResponseData || updatedResponseData.length === 0) {
    console.error("No response data returned after update for call_id:", call_id);
    return null;
  }

  const currentResponse = updatedResponseData[0];


  // Create a billable event if duration is positive
  if (payload.duration && payload.duration > 0 && currentResponse.interview_id && currentResponse.id) {
    try {
      const interviewDetails = await InterviewService.getInterviewById(currentResponse.interview_id);
      if (interviewDetails && interviewDetails.organization_id) {
        const cost = BillingService.calculateInterviewCost(payload.duration);
        await BillingService.createBillableEvent(
          interviewDetails.organization_id,
          currentResponse.interview_id,
          currentResponse.id,
          payload.duration,
          cost,
        );
      } else {
        console.error("Could not retrieve interview details or organization_id for interview_id:", currentResponse.interview_id);
      }
    } catch (billingError) {
      console.error("Error creating billable event:", billingError);
      // Decide if this error should affect the overall outcome of saveResponse
      // For now, just logging, the response update itself was successful.
    }
  }

  return updatedResponseData; // Return the updated response data
};

const getAllResponses = async (interviewId: string) => {
  try {
    const { data, error } = await supabase
      .from("response")
      .select(`*`)
      .eq("interview_id", interviewId)
      .or(`details.is.null, details->call_analysis.not.is.null`)
      .eq("is_ended", true)
      .order("created_at", { ascending: false });

    return data || [];
  } catch (error) {
    console.log(error);

    return [];
  }
};

const getResponseCountByOrganizationId = async (
  organizationId: string,
): Promise<number> => {
  try {
    const { count, error } = await supabase
      .from("interview")
      .select("response(id)", { count: "exact", head: true }) // join + count
      .eq("organization_id", organizationId);

    return count ?? 0;
  } catch (error) {
    console.log(error);

    return 0;
  }
};

const getAllEmailAddressesForInterview = async (interviewId: string) => {
  try {
    const { data, error } = await supabase
      .from("response")
      .select(`email`)
      .eq("interview_id", interviewId);

    return data || [];
  } catch (error) {
    console.log(error);

    return [];
  }
};

const getResponseByCallId = async (id: string) => {
  try {
    const { data, error } = await supabase
      .from("response")
      .select(`*`)
      .filter("call_id", "eq", id);

    return data ? data[0] : null;
  } catch (error) {
    console.log(error);

    return [];
  }
};

const deleteResponse = async (id: string) => {
  const { error, data } = await supabase
    .from("response")
    .delete()
    .eq("call_id", id);
  if (error) {
    console.log(error);

    return [];
  }

  return data;
};

const updateResponse = async (payload: any, call_id: string) => {
  const { error, data } = await supabase
    .from("response")
    .update({ ...payload })
    .eq("call_id", call_id);
  if (error) {
    console.log(error);

    return [];
  }

  return data;
};

export const ResponseService = {
  createResponse,
  saveResponse,
  updateResponse,
  getAllResponses,
  getResponseByCallId,
  deleteResponse,
  getResponseCountByOrganizationId,
  getAllEmails: getAllEmailAddressesForInterview,
};
