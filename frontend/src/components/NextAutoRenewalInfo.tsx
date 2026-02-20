import React, { useEffect, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Clock, ChevronDown, ChevronRight } from "lucide-react";
import LoadingState from "@/components/LoadingState";
import { apiCall } from "@/lib/api";
import { formatShortDateTime } from "@/lib/date-utils";

interface AutoRenewalStatus {
  total_auto_renew_connections: number;
  cron_schedule: string;
  next_run_time: string;
  renewal_threshold_days: number;
  connections_due_for_renewal: number;
  connections: Array<{
    id: number;
    name: string;
    hostname: string;
    domain: string;
    auto_renew_status: string;
    auto_renew_last_attempt: string;
  }>;
}

export const NextAutoRenewalInfo: React.FC = () => {
  const [status, setStatus] = useState<AutoRenewalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const response = await apiCall('/auto-renewal/status');
      const data = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError('Failed to fetch auto-renewal status');
      console.error('Auto-renewal status fetch error:', err);
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

  if (loading) {
    return <LoadingState variant="inline" text="Loading next renewal..." />;
  }

  if (error || !status) {
    return (
      <div className="text-xs text-red-600">
        {error || 'No data available'}
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="pt-2 border-t border-muted mt-2">
      <CollapsibleTrigger className="flex items-center justify-between w-full text-left p-0 hover:bg-transparent">
        <div className="flex items-center text-sm text-muted-foreground">
          <Clock className="w-4 h-4 mr-2" />
          <span className="font-medium">Next Renewal</span>
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </CollapsibleTrigger>
      
      <CollapsibleContent className="space-y-3 pt-3">
        <div className="space-y-2">
          <div className="text-sm font-medium">
            {formatShortDateTime(status.next_run_time)}
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="text-center">
            <div className="font-bold text-blue-600">{status.total_auto_renew_connections}</div>
            <div className="text-xs text-muted-foreground">enabled</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-green-600">{status.connections_due_for_renewal || 0}</div>
            <div className="text-xs text-muted-foreground">due now</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-orange-600">{status.renewal_threshold_days}</div>
            <div className="text-xs text-muted-foreground">day threshold</div>
          </div>
        </div>
        
        <div className="text-center">
          <div className="text-xs text-muted-foreground mb-1">Schedule</div>
          <code className="bg-muted px-2 py-1 rounded text-sm">{status.cron_schedule}</code>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};