"use client";

import React, { useState, useEffect } from "react";
import { useOrganization } from "@clerk/nextjs";
import InterviewCard from "@/components/dashboard/interview/interviewCard";
import CreateInterviewCard from "@/components/dashboard/interview/createInterviewCard";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { InterviewService } from "@/services/interviews.service";
import { ClientService } from "@/services/clients.service";
import { ResponseService } from "@/services/responses.service";
import { useInterviews } from "@/contexts/interviews.context";
import Modal from "@/components/dashboard/Modal";
import { Gem, Plus } from "lucide-react";
import Image from "next/image";
import { RechargeModal } from '@/components/dashboard/rechargeModal';
import Link from 'next/link';
import { toast } from 'sonner'; // Added import for toast

function Interviews() {
  const { interviews, interviewsLoading } = useInterviews();
  const { organization } = useOrganization();
  const [loading, setLoading] = useState<boolean>(false);
  const [currentPlan, setCurrentPlan] = useState<string>("");
  const [allowedResponsesCount, setAllowedResponsesCount] =
    useState<number>(10);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // New state for credits
  const [userCredits, setUserCredits] = useState<number | null>(null);
  const [isLoadingCredits, setIsLoadingCredits] = useState(true);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [isRechargeModalOpen, setIsRechargeModalOpen] = useState(false);


  function InterviewsLoader() {
    return (
      <>
        <div className="flex flex-row">
          <div className="h-60 w-56 ml-1 mr-3 mt-3 flex-none animate-pulse rounded-xl bg-gray-300" />
          <div className="h-60 w-56 ml-1 mr-3  mt-3 flex-none animate-pulse rounded-xl bg-gray-300" />
          <div className="h-60 w-56 ml-1 mr-3 mt-3 flex-none animate-pulse rounded-xl bg-gray-300" />
        </div>
      </>
    );
  }

  useEffect(() => {
    const fetchOrganizationData = async () => {
      try {
        if (organization?.id) {
          const data = await ClientService.getOrganizationById(organization.id);
          if (data?.plan) {
            setCurrentPlan(data.plan);
            if (data.plan === "free_trial_over") {
              setIsModalOpen(true);
            }
          }
          if (data?.allowed_responses_count) {
            setAllowedResponsesCount(data.allowed_responses_count);
          }
        }
      } catch (error) {
        console.error("Error fetching organization data:", error);
      }
    };

    fetchOrganizationData();
  }, [organization]);

  useEffect(() => {
    const fetchCredits = async () => {
      setIsLoadingCredits(true);
      setCreditError(null);
      try {
        const response = await fetch('/api/credits/balance');
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Failed to fetch credits: ${response.statusText}`);
        }
        const data = await response.json();
        setUserCredits(data.balance);
      } catch (error: any) {
        console.error("Failed to fetch user credits:", error);
        setCreditError(error.message);
      } finally {
        setIsLoadingCredits(false);
      }
    };
    fetchCredits();

    // Check for recharge status from URL query parameters
    const checkRechargeStatus = () => {
      // Ensure this code runs only on the client side
      if (typeof window !== 'undefined') {
        const searchParams = new URLSearchParams(window.location.search);
        const rechargeStatus = searchParams.get('recharge_status');
        // Try to get a unique ID from Lemon Squeezy redirect if available
        const uniqueCheckoutId = searchParams.get('checkout_id') || searchParams.get('ls_checkout_id') || searchParams.get('payment_intent_id');

        let toastShownKey = '';
        let toastMessage = '';
        let toastType: 'success' | 'warn' | 'info' | 'error' = 'info'; // Default toast type

        if (rechargeStatus) {
          if (rechargeStatus === 'pending') {
            toastShownKey = uniqueCheckoutId ? `recharge_toast_pending_${uniqueCheckoutId}` : 'recharge_toast_shown_pending_generic';
            toastMessage = "Your payment is processing. Credits will be updated once confirmed by the payment gateway.";
            toastType = 'info';
          } else if (rechargeStatus === 'success') {
            toastShownKey = uniqueCheckoutId ? `recharge_toast_success_${uniqueCheckoutId}` : 'recharge_toast_shown_success_generic';
            toastMessage = "Payment successful! Credits will be updated shortly once fully processed.";
            toastType = 'success';
          } else if (rechargeStatus === 'cancelled') {
            toastShownKey = uniqueCheckoutId ? `recharge_toast_cancelled_${uniqueCheckoutId}` : 'recharge_toast_shown_cancelled_generic';
            toastMessage = "Your payment process was cancelled or failed. Please try again if you wish to recharge.";
            toastType = 'warn';
          } else if (rechargeStatus === 'error') { // Hypothetical error status from payment gateway
            toastShownKey = uniqueCheckoutId ? `recharge_toast_error_${uniqueCheckoutId}` : 'recharge_toast_shown_error_generic';
            toastMessage = "There was an error with your payment. Please contact support if this persists.";
            toastType = 'error';
          }

          if (toastMessage && (uniqueCheckoutId || !toastShownKey.endsWith('_generic') || !sessionStorage.getItem(toastShownKey))) {
            // For generic keys, only show if not already shown in session.
            // For uniqueCheckoutId keys, sessionStorage will handle uniqueness.
            if (!sessionStorage.getItem(toastShownKey)) {
              if (toastType === 'success') toast.success(toastMessage);
              else if (toastType === 'warn') toast.warn(toastMessage);
              else if (toastType === 'info') toast.info(toastMessage);
              else toast.error(toastMessage); // For 'error' type

              sessionStorage.setItem(toastShownKey, 'true');
            }
          }

          // Clean URL if any recharge_status was present and processed
          const newUrl = window.location.pathname;
          window.history.replaceState({}, '', newUrl);
        }
      }
    };
    checkRechargeStatus();

  }, []); // Empty dependency array: runs once on mount

  useEffect(() => {
    const fetchResponsesCount = async () => {
      if (!organization || currentPlan !== "free") {
        return;
      }

      setLoading(true);
      try {
        const totalResponses =
          await ResponseService.getResponseCountByOrganizationId(
            organization.id,
          );
        const hasExceededLimit = totalResponses >= allowedResponsesCount;
        if (hasExceededLimit) {
          setCurrentPlan("free_trial_over");
          await InterviewService.deactivateInterviewsByOrgId(organization.id);
          await ClientService.updateOrganization(
            { plan: "free_trial_over" },
            organization.id,
          );
        }
      } catch (error) {
        console.error("Error fetching responses:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchResponsesCount();
  }, [organization, currentPlan, allowedResponsesCount]);

  return (
    <main className="p-8 pt-0 ml-12 mr-auto rounded-md">
      <div className="flex flex-col items-left">
        <h2 className="mr-2 text-2xl font-semibold tracking-tight mt-8">
          My Interviews
        </h2>
        <h3 className=" text-sm tracking-tight text-gray-600 font-medium ">
          Start getting responses now!
        </h3>

        {/* Credits Display Section */}
        <div className="my-4 p-4 border rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold mb-2">Your Credits</h3>
          {isLoadingCredits && <p>Loading credits...</p>}
          {creditError && <p style={{ color: 'red' }}>Error: {creditError}</p>}
          {userCredits !== null && !creditError && (
            <p className="text-xl">Current Balance: <span className="font-bold text-green-600">${userCredits.toFixed(2)}</span></p>
          )}
          <div className="flex space-x-2 mt-2">
            <button
              onClick={() => setIsRechargeModalOpen(true)}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Recharge Credits
            </button>
            <Link href="/dashboard/transactions">
              <button
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
              >
                View Transaction History
              </button>
            </Link>
          </div>
          <RechargeModal
            isOpen={isRechargeModalOpen}
            onClose={() => setIsRechargeModalOpen(false)}
          />
        </div>
        {/* End Credits Display Section */}

        <div className="relative flex items-center mt-1 flex-wrap">
          {currentPlan == "free_trial_over" ? (
            <Card className=" flex bg-gray-200 items-center border-dashed border-gray-700 border-2 hover:scale-105 ease-in-out duration-300 h-60 w-56 ml-1 mr-3 mt-4 rounded-xl shrink-0 overflow-hidden shadow-md">
              <CardContent className="flex items-center flex-col mx-auto">
                <div className="flex flex-col justify-center items-center w-full overflow-hidden">
                  <Plus size={90} strokeWidth={0.5} className="text-gray-700" />
                </div>
                <CardTitle className="p-0 text-md text-center">
                  You cannot create any more interviews unless you upgrade
                </CardTitle>
              </CardContent>
            </Card>
          ) : (
            <CreateInterviewCard />
          )}
          {interviewsLoading || loading ? (
            <InterviewsLoader />
          ) : (
            <>
              {isModalOpen && (
                <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)}>
                  <div className="flex flex-col space-y-4">
                    <div className="flex justify-center text-indigo-600">
                      <Gem />
                    </div>
                    <h3 className="text-xl font-semibold text-center">
                      Upgrade to Pro
                    </h3>
                    <p className="text-l text-center">
                      You have reached your limit for the free trial. Please
                      upgrade to pro to continue using our features.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex justify-center items-center">
                        <Image
                          src={"/premium-plan-icon.png"}
                          alt="Graphic"
                          width={299}
                          height={300}
                        />
                      </div>

                      <div className="grid grid-rows-2 gap-2">
                        <div className="p-4 border rounded-lg">
                          <h4 className="text-lg font-medium">Free Plan</h4>
                          <ul className="list-disc pl-5 mt-2">
                            <li>10 Responses</li>
                            <li>Basic Support</li>
                            <li>Limited Features</li>
                          </ul>
                        </div>
                        <div className="p-4 border rounded-lg">
                          <h4 className="text-lg font-medium">Pro Plan</h4>
                          <ul className="list-disc pl-5 mt-2">
                            <li>Flexible Pay-Per-Response</li>
                            <li>Priority Support</li>
                            <li>All Features</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    <p className="text-l text-center">
                      Contact{" "}
                      <span className="font-semibold">founders@folo-up.co</span>{" "}
                      to upgrade your plan.
                    </p>
                  </div>
                </Modal>
              )}
              {interviews.map((item) => (
                <InterviewCard
                  id={item.id}
                  interviewerId={item.interviewer_id}
                  key={item.id}
                  name={item.name}
                  url={item.url ?? ""}
                  readableSlug={item.readable_slug}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default Interviews;
