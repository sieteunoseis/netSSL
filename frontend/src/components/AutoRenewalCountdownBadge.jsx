import React, { useEffect, useState } from 'react';
import { Badge } from "@/components/ui/badge";
import { apiCall } from "@/lib/api";

const formatTimeUntil = (isoString) => {
  const now = new Date();
  const target = new Date(isoString);
  const diffMs = target.getTime() - now.getTime();
  
  if (diffMs < 0) return 'Past due';
  
  const diffMinutes = Math.ceil(diffMs / (1000 * 60));
  
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }
  
  const diffHours = Math.floor(diffMinutes / 60);
  const remainingMinutes = diffMinutes % 60;
  
  if (diffHours < 24) {
    return remainingMinutes > 0 ? `${diffHours}h ${remainingMinutes}m` : `${diffHours}h`;
  } else {
    const diffDays = Math.floor(diffHours / 24);
    const remainingHours = diffHours % 24;
    return remainingHours > 0 ? `${diffDays}d ${remainingHours}h` : `${diffDays}d`;
  }
};

export const AutoRenewalCountdownBadge = () => {
  const [nextRunTime, setNextRunTime] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const response = await apiCall('/auto-renewal/status');
      const data = await response.json();
      setNextRunTime(data.next_run_time);
    } catch (error) {
      console.error('Failed to fetch auto-renewal status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Refresh every minute to update the countdown
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !nextRunTime) {
    return null;
  }

  // Calculate time remaining in minutes for color determination
  const now = new Date();
  const target = new Date(nextRunTime);
  const diffMinutes = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60));
  
  // Determine color based on time remaining
  let colorClasses = '';
  if (diffMinutes < 0) {
    // Past due - red
    colorClasses = 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
  } else if (diffMinutes <= 60) {
    // Less than 1 hour - orange/amber
    colorClasses = 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';
  } else if (diffMinutes <= 360) {
    // Less than 6 hours - yellow
    colorClasses = 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
  } else if (diffMinutes <= 1440) {
    // Less than 24 hours - blue
    colorClasses = 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
  } else {
    // More than 24 hours - green
    colorClasses = 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800';
  }

  return (
    <Badge 
      variant="secondary" 
      className={`text-xs px-2 py-0.5 shadow-sm ${colorClasses}`}
    >
      in {formatTimeUntil(nextRunTime)}
    </Badge>
  );
};