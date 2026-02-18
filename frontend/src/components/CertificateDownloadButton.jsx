import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Download, ChevronDown, FileText, Key, Link, Shield } from "lucide-react";
import { apiCall } from "@/lib/api";
import { useCertificateRenewal } from "@/contexts/WebSocketContext";

const CertificateDownloadButton = ({ connection, refreshTrigger, isRenewing }) => {
  const { toast } = useToast();
  const [availableFiles, setAvailableFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const { status: renewalStatus } = useCertificateRenewal(connection.id);
  const prevRenewalStatus = useRef(renewalStatus);

  useEffect(() => {
    fetchAvailableFiles();
  }, [connection.id, refreshTrigger]);

  // Re-fetch file list when a renewal completes
  useEffect(() => {
    if (prevRenewalStatus.current !== 'completed' && renewalStatus === 'completed') {
      // Delay to allow files to be written to disk
      setTimeout(() => fetchAvailableFiles(), 3000);
    }
    prevRenewalStatus.current = renewalStatus;
  }, [renewalStatus]);

  const fetchAvailableFiles = async () => {
    try {
      setIsLoading(true);
      const response = await apiCall(`/data/${connection.id}/certificates`);
      if (response.ok) {
        const data = await response.json();
        setAvailableFiles(data.availableFiles || []);
      } else {
        setAvailableFiles([]);
      }
    } catch (error) {
      console.error('Error fetching available certificate files:', error);
      setAvailableFiles([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (fileType, displayName) => {
    try {
      const downloadUrl = `/api/data/${connection.id}/certificates/${fileType}`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = ''; // Let the server set the filename
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: "Download Started",
        description: `Downloading ${displayName} for ${connection.name}`,
        duration: 3000,
      });
    } catch (error) {
      console.error('Error downloading certificate:', error);
      toast({
        title: "Download Failed",
        description: `Failed to download ${displayName}`,
        variant: "destructive",
        duration: 3000,
      });
    }
  };

  const getFileIcon = (type) => {
    switch (type) {
      case 'certificate':
      case 'fullchain':
        return <Shield className="w-3 h-3 mr-2" />;
      case 'private_key':
        return <Key className="w-3 h-3 mr-2" />;
      case 'chain':
        return <Link className="w-3 h-3 mr-2" />;
      case 'csr':
        return <FileText className="w-3 h-3 mr-2" />;
      default:
        return <FileText className="w-3 h-3 mr-2" />;
    }
  };

  const getDisplayName = (type) => {
    const names = {
      'certificate': 'Certificate',
      'private_key': 'Private Key',
      'chain': 'Certificate Chain',
      'fullchain': 'Full Chain',
      'csr': 'CSR'
    };
    return names[type] || type;
  };

  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Unknown';
    }
  };

  if (availableFiles.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={true}
        className="text-gray-400 border-gray-300"
      >
        <Download className="mr-2 h-4 w-4" />
        No Certificates
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading || isRenewing}
          className={isRenewing 
            ? "text-gray-400 border-gray-300" 
            : "text-green-600 hover:text-green-700 border-green-300 hover:border-green-400"
          }
          title={isRenewing ? "Certificate renewal in progress - downloads disabled" : "Download certificate files"}
        >
          <Download className="mr-2 h-4 w-4" />
          {isRenewing ? "Renewal in Progress" : "Download Certificates"}
          <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Certificate Files</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableFiles.map((file) => (
          <DropdownMenuItem
            key={file.type}
            onClick={() => handleDownload(file.type, getDisplayName(file.type))}
            className="cursor-pointer"
          >
            <div className="flex items-center w-full">
              {getFileIcon(file.type)}
              <div className="flex-1">
                <div className="font-medium">{getDisplayName(file.type)}</div>
                <div className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(file.lastModified)}
                </div>
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default CertificateDownloadButton;