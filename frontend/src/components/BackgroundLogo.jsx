import React from "react";
import * as LucideIcons from "lucide-react";

const BackgroundLogo = () => {
  const logoText = import.meta.env.VITE_BACKGROUND_LOGO_TEXT || "netSSL";
  
  // Check if logoText starts with "lucide-" to indicate it's an icon
  if (logoText.startsWith("lucide-")) {
    const iconName = logoText.replace("lucide-", "");
    const IconComponent = LucideIcons[iconName.charAt(0).toUpperCase() + iconName.slice(1)];
    
    
    if (IconComponent) {
      return (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-0 opacity-10">
          <IconComponent className="text-black dark:text-white w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 lg:w-[500px] lg:h-[500px]" />
        </div>
      );
    }
  }
  
  // Calculate font size based on text length to prevent overflow
  const getFontSize = (text) => {
    if (text.length <= 2) return "72px";
    if (text.length <= 4) return "48px";
    if (text.length <= 6) return "36px";
    return "24px";
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-0 opacity-10">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" className="text-gray-900 dark:text-gray-500">
        <defs>
          <style>@import url('https://fonts.googleapis.com/css2?family=Permanent+Marker&amp;display=swap');</style>
        </defs>
        <text x="50%" y="65%" textAnchor="middle" fontFamily='"Permanent Marker", serif' fontSize={getFontSize(logoText)} fill="currentColor" className="text-gray-900 dark:text-gray-500">
          {logoText}
        </text>
      </svg>
    </div>
  );
};

export default BackgroundLogo;
