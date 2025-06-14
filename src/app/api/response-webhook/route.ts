import axios from "axios"; // Keep if call_analyzed or other cases use it.
import { NextRequest, NextResponse } from "next/server";
import { Retell } from "retell-sdk";
import { ResponseService } from "../../../services/responses.service"; // Adjust path as needed
import { InterviewService } from "../../../services/interviews.service"; // Adjust path as needed
import { CreditService } from "../../../services/credits.service"; // Adjust path as needed

const retellApiKey = process.env.RETELL_API_KEY;

export async function POST(req: NextRequest) { // Removed unused 'res' parameter
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!retellApiKey) {
    console.error("RETELL_API_KEY is not configured.");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const rawBody = await req.text(); // Read the raw body once
  const signature = req.headers.get("x-retell-signature");

  if (!signature) {
    console.warn("Retell Webhook: Missing x-retell-signature header.");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  if (!Retell.verify(rawBody, retellApiKey, signature)) {
    console.error("Retell Webhook: Invalid signature.");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { event, call } = JSON.parse(rawBody) as { event: string; call: any; transcript?: any }; // Added transcript for potential future use

  switch (event) {
    case "call_started":
      console.log("Retell Webhook: Call started event received for call_id:", call.call_id);
      // Potential future logic for call_started
      break;
    case "call_ended":
      console.log("Retell Webhook: Call ended event received for call_id:", call.call_id);
      const callId = call.call_id as string;

      // --- ASSUMPTION: Duration field from Retell ---
      // Try to get duration from common possible fields. This needs verification against actual Retell payload.
      // Example: call.public_metadata?.duration_seconds or call.duration_seconds or call.duration
      const durationInSeconds = call.public_metadata?.duration_seconds ??
                               call.duration_seconds ??
                               call.duration ??
                               0;
      // --- End Assumption ---

      if (!callId) {
        console.error("Retell Webhook: Call ID missing in call_ended event.");
        // Retell expects a 2xx response to stop retries. 400 might be okay if it's a malformed payload from their side.
        return NextResponse.json({ error: "Call ID missing in webhook payload" }, { status: 400 });
      }

      // 1. Update our database response record
      const updatePayload = {
        duration: durationInSeconds,
        is_ended: true,
        // transcript: transcriptObject, // If transcript is also part of this event and needs saving
      };

      // Assuming ResponseService.updateResponse takes (payload, call_id) and returns success indicator or updated data count
      // The original prompt suggests it returns the updated response or null. Let's assume it returns a row count or similar for now.
      const updatedResponseResult = await ResponseService.updateResponse(updatePayload, callId);

      // Check if the update was successful. The check depends on what updateResponse returns.
      // If it returns the updated record or array of records:
      // if (!updatedResponseResult || (Array.isArray(updatedResponseResult) && updatedResponseResult.length === 0)) {
      // If it returns a count of updated rows:
      // if (typeof updatedResponseResult === 'number' && updatedResponseResult === 0) {
      // For now, let's be optimistic or assume a simple check.
      // The example used `!updatedResponseRowCount || (Array.isArray(updatedResponseRowCount) && updatedResponseRowCount.length === 0)`
      // This implies it might return an array. If it's just one record, it might be `!updatedResponseResult`.
      // Let's assume it returns the updated record or null if not found/failed.
      if (!updatedResponseResult) {
        console.warn(`Retell Webhook: Failed to update response in DB for call_id: ${callId}. Response may not exist or update failed. Credit deduction might fail.`);
      } else {
        console.log(`Retell Webhook: Response for call_id: ${callId} updated with duration: ${durationInSeconds}s and marked as ended.`);
      }

      // 2. Perform Credit Deduction
      const dbResponse = await ResponseService.getResponseByCallId(callId);
      if (!dbResponse || !dbResponse.interview_id) {
        console.error(`Retell Webhook: Could not retrieve full response or interview_id for call_id: ${callId} after update. Cannot deduct credits.`);
        return NextResponse.json({ status: 200, message: "Call ended, but internal data missing for credit deduction." });
      }

      const interview = await InterviewService.getInterviewById(dbResponse.interview_id);
      if (!interview) {
        console.error(`Retell Webhook: Could not retrieve interview details for interview_id: ${dbResponse.interview_id}. Cannot deduct credits.`);
        return NextResponse.json({ status: 200, message: "Call ended, but interview data missing for credit deduction." });
      }

      let entityId: string | null = null;
      let entityType: 'user' | 'organization' | null = null;

      if (interview.organization_id) {
        entityId = interview.organization_id;
        entityType = 'organization';
      } else if (interview.user_id) {
        entityId = interview.user_id;
        entityType = 'user';
      }

      if (!entityId || !entityType) {
        console.error(`Retell Webhook: No user_id or organization_id for interview: ${interview.id}. Cannot deduct credits.`);
        return NextResponse.json({ status: 200, message: "Call ended, but no entity found for credit deduction." });
      }

      if (durationInSeconds <= 0) {
        console.log(`Retell Webhook: Call ${callId} has zero duration. No credits deducted.`);
        return NextResponse.json({ status: 200, message: "Call ended, zero duration, no credits deducted." });
      }

      const durationInMinutes = durationInSeconds / 60;
      const costPerMinute = 0.20; // USD
      let totalCost = durationInMinutes * costPerMinute;

      if (totalCost > 0 && totalCost < 0.01) {
          // Example: charge a minimum of $0.01 if any cost is incurred but less than 1 cent.
          // Or, if your credit system can handle fractions of a cent, this may not be needed.
          // totalCost = 0.01;
          // console.log(`Retell Webhook: Call ${callId} cost ${totalCost.toFixed(4)} adjusted to $0.01.`);
          // Sticking to direct calculation as per prompt, but logging with more precision.
          console.log(`Retell Webhook: Calculated cost for call ${callId} is ${totalCost.toFixed(5)} USD.`);
      } else if (totalCost <= 0) {
          console.log(`Retell Webhook: Calculated cost for call ${callId} is zero or less (${totalCost.toFixed(5)} USD). No credits deducted.`);
          return NextResponse.json({ status: 200, message: "Call ended, calculated cost zero or less, no credits deducted." });
      }

      // Round to 2 decimal places for currency consistency, or more if your system supports it
      totalCost = Math.round(totalCost * 100) / 100;
      if (totalCost <= 0 && durationInSeconds > 0) { // If rounding made it zero, but there was duration
         console.log(`Retell Webhook: Call ${callId} cost rounded to zero, but duration was ${durationInSeconds}s. No credits deducted.`);
         return NextResponse.json({ status: 200, message: "Call ended, cost rounded to zero, no credits deducted." });
      }


      const deductionSuccess = await CreditService.deductCredits(
        entityType,
        entityId,
        totalCost,
        'interview_usage',
        `Usage for interview call_id: ${callId} (Duration: ${durationInSeconds}s)`
      );

      if (deductionSuccess) {
        console.log(`Retell Webhook: Successfully deducted ${totalCost.toFixed(2)} USD from ${entityType} ${entityId} for call ${callId}.`);
      } else {
        console.error(`Retell Webhook: Failed to deduct ${totalCost.toFixed(2)} USD from ${entityType} ${entityId} for call ${callId}. This needs monitoring.`);
      }
      break;
    case "call_analyzed":
      // const result = await axios.post("/api/get-call", { // This seems to call another local API endpoint.
      //   id: call.call_id,
      // });
      console.log("Retell Webhook: Call analyzed event received for call_id:", call.call_id);
      // Add logic for call_analyzed if needed, e.g., saving transcript_object if available
      // if (call.transcript_object) { ... }
      break;
    default:
      console.log("Retell Webhook: Received an unknown event:", event);
  }

  // Acknowledge the receipt of the event to Retell
  return NextResponse.json({ received: true, message: "Webhook processed" });
}
