"use client";

import React, { useEffect, useState } from 'react';
import { BillingService } from '@/services/billing.service'; // Assuming path

interface BillableEvent {
  id: string;
  interview_id: string;
  billed_at: string; // ISO string date
  duration_seconds: number;
  cost_usd: number;
  status: string;
}

interface BillingHistoryProps {
  organizationId: string;
}

const BillingHistory: React.FC<BillingHistoryProps> = ({ organizationId }) => {
  const [events, setEvents] = useState<BillableEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;

    const fetchEvents = async () => {
      setLoading(true);
      setError(null);
      try {
        // Type assertion for mock data, replace with actual type when service method is implemented
        const data = await BillingService.getBillableEventsByOrganization(organizationId) as BillableEvent[];
        setEvents(data);
      } catch (err) {
        console.error("Error fetching billing events:", err);
        setError('Failed to load billing history. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [organizationId]);

  if (loading) {
    return <div className="text-center p-4">Loading billing history...</div>;
  }

  if (error) {
    return <div className="text-center p-4 text-red-500">{error}</div>;
  }

  if (events.length === 0) {
    return <div className="text-center p-4">No billing events found.</div>;
  }

  return (
    <div className="mt-6">
      <div className="overflow-x-auto relative shadow-md sm:rounded-lg">
        <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
            <tr>
              <th scope="col" className="py-3 px-6">Interview ID</th>
              <th scope="col" className="py-3 px-6">Date</th>
              <th scope="col" className="py-3 px-6">Duration (s)</th>
              <th scope="col" className="py-3 px-6">Cost (USD)</th>
              <th scope="col" className="py-3 px-6">Status</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600">
                <td className="py-4 px-6 font-medium text-gray-900 whitespace-nowrap dark:text-white">
                  {event.interview_id}
                </td>
                <td className="py-4 px-6">
                  {new Date(event.billed_at).toLocaleDateString()}
                </td>
                <td className="py-4 px-6">
                  {event.duration_seconds}
                </td>
                <td className="py-4 px-6">
                  ${event.cost_usd.toFixed(4)}
                </td>
                <td className="py-4 px-6">
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full
                    ${event.status === 'paid' ? 'bg-green-100 text-green-800' : ''}
                    ${event.status === 'pending_payment' ? 'bg-yellow-100 text-yellow-800' : ''}
                    ${event.status === 'payment_failed' ? 'bg-red-100 text-red-800' : ''}
                    ${!['paid', 'pending_payment', 'payment_failed'].includes(event.status) ? 'bg-gray-100 text-gray-800' : ''}
                  `}>
                    {event.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BillingHistory;
