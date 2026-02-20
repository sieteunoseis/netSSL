import { Link } from "react-router-dom";
import { useConfig } from '@/config/ConfigContext';
import CertificateBadges from './CertificateBadges';

export default function Component({ overallStatus }) {
  const config = useConfig();

  return (
    <nav className="sticky inset-x-0 top-0 z-30 h-14 border-t-2 border-t-primary bg-background/95 backdrop-blur-md border-b border-border px-4 md:px-6">
      <div className="flex justify-between h-full items-center">
        {/* Left side - Branding */}
        <div className="flex items-center min-w-0 flex-1">
          <Link to={ config.brandingUrl ? config.brandingUrl : 'http://automate.builders' } className="font-semibold flex items-center space-x-2 md:space-x-3 min-w-0" target="_blank" rel="noopener noreferrer">
            <img src="/logo.png" alt="netSSL" className="h-6 w-6 md:h-8 md:w-8 rounded-full object-cover flex-shrink-0" />
            <h1 className="scroll-m-20 text-lg md:text-2xl lg:text-2xl font-extrabold tracking-tight truncate">{ config.brandingName ? config.brandingName : 'netSSL' }</h1>
          </Link>
        </div>

        {/* Right side - Certificate Badges */}
        <div className="flex-shrink-0">
          <CertificateBadges overallStatus={overallStatus} />
        </div>
      </div>
    </nav>
  );
}
