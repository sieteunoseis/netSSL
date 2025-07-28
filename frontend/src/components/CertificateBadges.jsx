import { Badge } from "@/components/ui/badge";
import { Shield, Clock, AlertCircle, RotateCcw } from "lucide-react";

const CertificateBadges = ({ overallStatus }) => {
  if (!overallStatus) return null;

  const badges = [
    {
      label: overallStatus.total,
      text: "Total",
      icon: Shield,
      color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
    },
    {
      label: overallStatus.valid,
      text: "Valid",
      icon: Shield,
      color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
    }
  ];

  // Only show expiring if there are any
  if (overallStatus.expiring > 0) {
    badges.push({
      label: overallStatus.expiring,
      text: "Expiring",
      icon: Clock,
      color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
    });
  }

  // Only show expired if there are any
  if (overallStatus.expired > 0) {
    badges.push({
      label: overallStatus.expired,
      text: "Expired",
      icon: AlertCircle,
      color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
    });
  }

  // Only show auto-renew if there are any
  if (overallStatus.autoRenew > 0) {
    badges.push({
      label: overallStatus.autoRenew,
      text: "Auto-Renew",
      icon: RotateCcw,
      color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300"
    });
  }

  return (
    <div className="flex items-center space-x-1 md:space-x-2">
      {badges.map((badge, index) => {
        const Icon = badge.icon;
        return (
          <Badge 
            key={index}
            className={`flex items-center space-x-1 px-1 py-1 md:px-2 rounded-[4px] ${badge.color}`}
          >
            <Icon size={10} className="md:hidden" />
            <Icon size={12} className="hidden md:block" />
            <span className="font-semibold text-xs md:text-sm">{badge.label}</span>
            <span className="text-xs hidden sm:inline">{badge.text}</span>
          </Badge>
        );
      })}
    </div>
  );
};

export default CertificateBadges;