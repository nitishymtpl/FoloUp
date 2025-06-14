'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button'; // Adjust path if your structure differs
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'; // Adjust path
import { Input } from '@/components/ui/input'; // Adjust path
import { Label } from '@/components/ui/label'; // Adjust path
import { useAuth } from '@clerk/nextjs';
import { logger } from '@/lib/logger'; // Assuming logger is available

interface RechargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Optional: callback for when a recharge process is initiated, e.g., to refresh credits display later
  // onRechargeInitiated?: () => void;
}

export function RechargeModal({ isOpen, onClose }: RechargeModalProps) {
  const [amount, setAmount] = useState<string>('10.00'); // Default amount
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { userId } = useAuth(); // Clerk user ID

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      // Reset form on close if it's not loading
      if (!isLoading) {
        setAmount('10.00');
        setError(null);
      }
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    if (!userId) {
        setError('User not authenticated. Please try again.');
        setIsLoading(false);
        logger.warn("RechargeModal: User not authenticated at time of submit.");
        return;
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('Please enter a valid positive amount (e.g., 5.00 for $5).');
      setIsLoading(false);
      return;
    }
    // Optional: Add a maximum amount check if necessary
    // if (numericAmount > 1000) { // Example max
    //   setError('Maximum recharge amount is $1000.');
    //   setIsLoading(false);
    //   return;
    // }


    try {
      logger.info(`RechargeModal: User ${userId} initiating recharge for $${numericAmount}`);
      const response = await fetch('/api/recharge/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: numericAmount,
          entityType: 'user',
          entityId: userId
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        logger.error(`RechargeModal: API error for user ${userId}, amount $${numericAmount}. Error: ${data.error}`);
        throw new Error(data.error || 'Failed to create checkout session.');
      }

      if (data.checkoutUrl) {
        logger.info(`RechargeModal: Checkout URL received for user ${userId}. Redirecting.`);
        // if (onRechargeInitiated) onRechargeInitiated(); // Call if provided
        window.location.href = data.checkoutUrl;
        // Don't call onClose here as the page will redirect.
      } else {
        logger.error(`RechargeModal: Checkout URL not found in response for user ${userId}, amount $${numericAmount}.`);
        throw new Error('Checkout URL not found in response.');
      }
    } catch (err: any) {
      logger.error(`RechargeModal: Exception for user ${userId}, amount $${numericAmount}. Error: ${err.message}`, err);
      setError(err.message || "An unexpected error occurred.");
      setIsLoading(false); // Only set isLoading to false on error here; success means redirect
    }
    // No finally setIsLoading(false) here because on success, we redirect.
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Recharge Credits</DialogTitle>
          <DialogDescription>
            Enter the amount (USD) you want to add to your balance. You'll be redirected to our payment provider to complete the purchase.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="amount" className="text-right">
                Amount
              </Label>
              <Input
                id="amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="col-span-3"
                min="1.00" // Example: minimum $1 recharge, can be adjusted
                step="0.01"    // For cents
                placeholder="e.g., 10.00"
                required
                disabled={isLoading}
              />
            </div>
            {error && (
              <p className="col-span-4 text-sm text-red-500 text-center p-2 bg-red-50 rounded-md">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Processing...' : 'Proceed to Payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
