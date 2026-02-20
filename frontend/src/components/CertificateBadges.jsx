import { Badge } from "@/components/ui/badge";
import { Shield, Clock, AlertCircle, RotateCcw } from "lucide-react";

const CertificateBadges = ({ overallStatus }) => {
  if (!overallStatus) return null;

  const badges = [
    {
      label: overallStatus.total,
      text: "Total",
      icon: Shield,
      variant: "info"
    },
    {
      label: overallStatus.valid,
      text: "Valid",
      icon: Shield,
      variant: "success"
    }
  ];

  // Only show expiring if there are any
  if (overallStatus.expiring > 0) {
    badges.push({
      label: overallStatus.expiring,
      text: "Expiring",
      icon: Clock,
      variant: "warning"
    });
  }

  // Only show expired if there are any
  if (overallStatus.expired > 0) {
    badges.push({
      label: overallStatus.expired,
      text: "Expired",
      icon: AlertCircle,
      variant: "destructive"
    });
  }

  // Only show auto-renew if there are any
  if (overallStatus.autoRenew > 0) {
    badges.push({
      label: overallStatus.autoRenew,
      text: "Auto-Renew",
      icon: RotateCcw,
      variant: "default"
    });
  }

  return (
    <div className="flex items-center gap-1 md:gap-1.5">
      {badges.map((badge, index) => {
        const Icon = badge.icon;
        return (
          <Badge
            key={index}
            variant={badge.variant}
            className="flex items-center gap-1 px-1.5 py-0.5 md:px-2 md:py-1"
            title={`${badge.label} ${badge.text}`}
          >
            <Icon className="w-3 h-3" />
            <span className="font-semibold font-mono text-xs">{badge.label}</span>
            <span className="text-xs hidden lg:inline">{badge.text}</span>
          </Badge>
        );
      })}
    </div>
  );
};

export default CertificateBadges;
