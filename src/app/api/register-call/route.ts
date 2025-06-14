import { logger } from "@/lib/logger";
import { InterviewerService } from "@/services/interviewers.service";
import { InterviewService } from "@/services/interviews.service"; // Added
import { CreditService } from "@/services/credits.service";   // Added
import { NextResponse } from "next/server";
import Retell from "retell-sdk";

const retellClient = new Retell({
  apiKey: process.env.RETELL_API_KEY || "",
});

export async function POST(req: Request, res: Response) { // res is not used, but Next.js might expect it. Consider NextRequest.
  logger.info("register-call request received");

  try {
    const body = await req.json();
    const interviewerId = body.interviewer_id;
    const interviewId = body.interview_id; // New: Assume client sends this
    const dynamicData = body.dynamic_data;

    if (!interviewerId || !interviewId) {
      logger.error("register-call: Missing interviewer_id or interview_id in request body.");
      return NextResponse.json({ error: "Missing interviewer_id or interview_id" }, { status: 400 });
    }

    // --- Credit Check Start ---
    const interview = await InterviewService.getInterviewById(interviewId);
    if (!interview) {
      logger.error(`register-call: Interview not found for ID: ${interviewId}`);
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    let entityId: string | null = null;
    let entityType: 'user' | 'organization' | null = null;
    let entityNameForLog: string = "Unknown entity";

    if (interview.organization_id) {
      entityId = interview.organization_id;
      entityType = 'organization';
      entityNameForLog = `Organization ID ${entityId}`;
    } else if (interview.user_id) {
      entityId = interview.user_id;
      entityType = 'user';
      entityNameForLog = `User ID ${entityId}`;
    }

    if (!entityId || !entityType) {
      logger.error(`register-call: No user_id or organization_id found for interview: ${interview.id}. Cannot check credits.`);
      return NextResponse.json({ error: "Interview data incomplete, cannot determine payer." }, { status: 500 });
    }

    const currentBalance = await CreditService.getCreditBalance(entityType, entityId);
    // Define a minimum threshold, e.g., $0.01, or enough for 1 minute ($0.20)
    const minimumBalanceThreshold = 0.01;

    logger.info(`register-call: Attempting to register call for ${entityNameForLog} (Interview ID: ${interviewId}). Current balance: $${currentBalance.toFixed(2)} USD. Minimum required: $${minimumBalanceThreshold.toFixed(2)} USD.`);

    if (currentBalance < minimumBalanceThreshold) {
      logger.warn(`register-call: Insufficient credits for ${entityNameForLog} to start call for interview ${interviewId}. Balance: $${currentBalance.toFixed(2)} USD.`);
      return NextResponse.json({ error: "Insufficient credits to start the interview. Please recharge your account." }, { status: 402 }); // 402 Payment Required
    }
    logger.info(`register-call: Credit check passed for ${entityNameForLog}. Proceeding to register call.`);
    // --- Credit Check End ---

    const interviewer = await InterviewerService.getInterviewer(interviewerId);
    if (!interviewer || !interviewer.agent_id) {
        logger.error(`register-call: Interviewer not found or agent_id missing for interviewer ID: ${interviewerId}`);
        return NextResponse.json({ error: "Interviewer configuration error." }, { status: 500 });
    }

    const registerCallResponse = await retellClient.call.createWebCall({
      agent_id: interviewer.agent_id,
      retell_llm_dynamic_variables: dynamicData,
    });

    // Ensure registerCallResponse and its call_id are valid before logging
    if (!registerCallResponse || !registerCallResponse.call_id) {
        logger.error(`register-call: Failed to register call with Retell or call_id missing for Interview ID: ${interviewId}. Retell response: ${JSON.stringify(registerCallResponse)}`);
        return NextResponse.json({ error: "Failed to register call with Retell." }, { status: 500 });
    }

    logger.info(`register-call: Call registered successfully with Retell for Interview ID: ${interviewId}. Retell Call ID: ${registerCallResponse.call_id}`);

    return NextResponse.json(
      {
        // Return the entire response object from Retell, which includes call_id, access_token, etc.
        callDetail: registerCallResponse
      },
      { status: 200 },
    );

  } catch (error) {
    // Log the actual error object for better debugging
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(`register-call: Error during request processing for interviewId ${body?.interview_id}: ${errorMessage}`, error);
    return NextResponse.json({ error: "Internal server error during call registration." }, { status: 500 });
  }
}
