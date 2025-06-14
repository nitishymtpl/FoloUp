'use client';

import React, { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"; // Adjust path if your structure differs
import { ScrollArea } from "@/components/ui/scroll-area"; // Adjust path
import { Badge } from "@/components/ui/badge"; // Adjust path
import { logger } from '@/lib/logger'; // Assuming logger is available for client-side logging if needed

interface Transaction {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  created_at: string;
}

// Helper to format transaction type for display
const formatTransactionType = (type: string): string => {
  if (!type) return 'Unknown';
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

export function TransactionHistory() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTransactions = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/credits/transactions');
        if (!response.ok) {
          const errorData = await response.json();
          logger.error("TransactionHistory: Failed to fetch transactions", { status: response.status, error: errorData.error });
          throw new Error(errorData.error || 'Failed to fetch transactions.');
        }
        const data = await response.json();
        setTransactions(data);
      } catch (err: any) {
        logger.error("TransactionHistory: Exception while fetching transactions", err);
        setError(err.message || "An unexpected error occurred.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchTransactions();
  }, []);

  if (isLoading) return <p className="text-center py-10">Loading transaction history...</p>;
  if (error) return <p className="text-center py-10 text-red-600">Error loading transactions: {error}</p>;


  return (
    <div className="space-y-4 mt-6">
      <h2 className="text-2xl font-semibold tracking-tight">Transaction History</h2>
      {transactions.length === 0 ? (
         <p className="text-center py-10 text-gray-500">No transactions found.</p>
      ) : (
        <ScrollArea className="h-[400px] rounded-md border shadow-sm"> {/* Example height */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px]">Date</TableHead> {/* Added width for consistency */}
                <TableHead className="w-[150px]">Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right w-[150px]">Amount (USD)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="font-medium">
                    {new Date(tx.created_at).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'short', day: 'numeric'
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                        tx.type === 'recharge' || tx.type === 'initial' || tx.type === 'manual_adjustment' && tx.amount > 0 ? 'default' :
                        tx.type === 'interview_usage' || tx.type === 'manual_adjustment' && tx.amount < 0 ? 'destructive' : 'secondary'
                    }
                    className="capitalize" // More robust than manual replace
                    >
                        {formatTransactionType(tx.type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-gray-700">{tx.description || '-'}</TableCell>
                  <TableCell
                    className={`text-right font-semibold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {tx.amount >= 0 ? '+' : '-'}${Math.abs(tx.amount).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </div>
  );
}
