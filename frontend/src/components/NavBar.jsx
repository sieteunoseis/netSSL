import { Link } from "react-router-dom";
import { NavigationMenu, NavigationMenuList, NavigationMenuLink } from "@/components/ui/navigation-menu";
import { useConfig } from '@/config/ConfigContext';
import templateConfig from "../../template.config.json";
import { useState } from 'react';
import { Menu, X } from 'lucide-react';

export default function Component() {
  const config = useConfig();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  return (
    <nav className="sticky inset-x-0 top-0 z-50 bg-white shadow-sm px-4 md:px-6 dark:bg-black">
      <div className="flex justify-between h-14 items-center">
        <Link to={ config.brandingUrl ? config.brandingUrl : 'http://automate.builders' } className="font-semibold" target="_blank" rel="noopener noreferrer">
        <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-2xl">{ config.brandingName ? config.brandingName : 'netSSL' }</h1>
        </Link>
        
        {/* Desktop Navigation */}
        <NavigationMenu className="hidden lg:flex">
          <NavigationMenuList className="flex items-center space-x-6">
            <NavigationMenuLink asChild>
              <Link to="/" className="hover:text-blue-600 transition-colors">
                Home
              </Link>
            </NavigationMenuLink>
            {templateConfig.useBackend && (
              <>
                <NavigationMenuLink asChild>
                  <Link to="/connections" className="hover:text-blue-600 transition-colors">
                    Connections
                  </Link>
                </NavigationMenuLink>
                <NavigationMenuLink asChild>
                  <Link to="/logs" className="hover:text-blue-600 transition-colors">
                    Logs
                  </Link>
                </NavigationMenuLink>
              </>
            )}
          </NavigationMenuList>
        </NavigationMenu>

        {/* Mobile Hamburger Menu */}
        <button
          onClick={toggleMenu}
          className="lg:hidden p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="Toggle menu"
        >
          {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="lg:hidden absolute top-14 left-0 right-0 bg-white dark:bg-black border-b shadow-lg">
          <div className="px-4 py-2 space-y-2">
            <Link 
              to="/" 
              className="block px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => setIsMenuOpen(false)}
            >
              Home
            </Link>
            {templateConfig.useBackend && (
              <>
                <Link 
                  to="/connections" 
                  className="block px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Connections
                </Link>
                <Link 
                  to="/logs" 
                  className="block px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Logs
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
