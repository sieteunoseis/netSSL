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

  // Determine variant based on time remaining
  let variant = 'success';
  if (diffMinutes < 0) {
    variant = 'destructive';
  } else if (diffMinutes <= 360) {
    variant = 'warning';
  } else if (diffMinutes <= 1440) {
    variant = 'info';
  }

  return (
    <Badge
      variant={variant}
      className="text-xs px-2 py-0.5 shadow-sm font-mono"
    >
      in {formatTimeUntil(nextRunTime)}
    </Badge>
  );
};
