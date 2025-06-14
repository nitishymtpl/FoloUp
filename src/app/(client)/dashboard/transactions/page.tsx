import { TransactionHistory } from '@/components/dashboard/transactionHistory'; // Adjust path if necessary
import React from 'react';

export default function TransactionsPage() {
  return (
    // Using a structure similar to the main dashboard page for consistency
    <main className="p-8 pt-0 ml-12 mr-auto rounded-md">
      <div className="flex flex-col items-left">
        {/*
          Optionally, add a page title here if TransactionHistory doesn't include one,
          but TransactionHistory already has <h2 className="text-2xl ...">Transaction History</h2>
        */}
        <TransactionHistory />
      </div>
    </main>
  );
}
