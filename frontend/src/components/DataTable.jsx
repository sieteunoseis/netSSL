import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfig } from '../config/ConfigContext';
import { apiCall } from '../lib/api';
import { ChevronDown, ChevronUp, Trash2, Eye, EyeOff, Edit, Terminal, Server, Wrench, Power } from 'lucide-react';
import EditConnectionModal from './EditConnectionModalTabbed';
import { useToast } from "@/hooks/use-toast";
import { isConnectionEnabled, getConnectionDisplayHostname } from '../lib/connection-utils';

const DataTable = ({ data, onDataChange }) => {
  const config = useConfig();
  const { toast } = useToast();
  const [jsonData, setData] = useState([]);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [visiblePasswords, setVisiblePasswords] = useState(new Set());
  const [editingRecord, setEditingRecord] = useState(null);
  const [testingSSH, setTestingSSH] = useState(new Set());
  const [toggling, setToggling] = useState(new Set());

  useEffect(() => {
    const fetchData = async () => {
      const response = await fetch("/dbSetup.json");
      const jsonData = await response.json();
      setData(jsonData);
    };

    fetchData();
  }, []);

  const handleDelete = async (id) => {
    try {
      await apiCall(`/data/${id}`, { method: "DELETE" });
      onDataChange();
    } catch (error) {
      console.error("Error deleting data:", error);
    }
  };

  const handleSSHTest = async (record) => {
    const newTesting = new Set(testingSSH);
    newTesting.add(record.id);
    setTestingSSH(newTesting);

    try {
      // Use the connection utility to get the proper hostname for SSH testing
      const fqdn = getConnectionDisplayHostname(record);
      
      const response = await apiCall('/ssh/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname: fqdn,
          username: record.username,
          password: record.password,
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "SSH Test Successful",
          description: "Successfully connected to Cisco VOS CLI",
        });
      } else {
        toast({
          title: "SSH Test Failed",
          description: result.error || "Unable to connect to server",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error testing SSH:', error);
      toast({
        title: "Connection Error",
        description: "Failed to test SSH connection. Please check your network.",
        variant: "destructive",
      });
    } finally {
      const newTesting = new Set(testingSSH);
      newTesting.delete(record.id);
      setTestingSSH(newTesting);
    }
  };

  const handleToggleEnabled = async (record) => {
    const newToggling = new Set(toggling);
    newToggling.add(record.id);
    setToggling(newToggling);

    try {
      // Use utility function to check current state
      const currentEnabledState = isConnectionEnabled(record);
      const newEnabledState = !currentEnabledState;
      
      console.log('Toggle Debug:', {
        recordId: record.id,
        recordName: record.name,
        currentIsEnabled: record.is_enabled,
        currentEnabledState,
        newEnabledState
      });
      
      const updateData = {
        ...record,
        is_enabled: newEnabledState
      };
      
      console.log('Sending update data:', updateData);
      
      await apiCall(`/data/${record.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      toast({
        title: `Connection ${newEnabledState ? 'Enabled' : 'Disabled'}`,
        description: `${record.name} has been ${newEnabledState ? 'enabled' : 'disabled'}. ${newEnabledState ? 'It will appear on the dashboard.' : 'It will be hidden from the dashboard.'}`,
        duration: 3000,
      });

      onDataChange();
    } catch (error) {
      console.error('Error toggling connection status:', error);
      toast({
        title: "Error",
        description: "Failed to update connection status. Please try again.",
        variant: "destructive",
        duration: 3000,
      });
    } finally {
      const newToggling = new Set(toggling);
      newToggling.delete(record.id);
      setToggling(newToggling);
    }
  };

  const toggleRow = (id) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const togglePasswordVisibility = (recordId) => {
    const newVisible = new Set(visiblePasswords);
    if (newVisible.has(recordId)) {
      newVisible.delete(recordId);
    } else {
      newVisible.add(recordId);
    }
    setVisiblePasswords(newVisible);
  };

  const formatColumnName = (col) => {
    return col
      .replace(/[^a-zA-Z]+/g, ' ')
      .split(' ')
      .map(word => {
        // Keep SSL, DNS, SSH, ISE, and URL in uppercase
        if (word.toLowerCase() === 'ssl' || word.toLowerCase() === 'dns' || word.toLowerCase() === 'ssh' || word.toLowerCase() === 'ise' || word.toLowerCase() === 'url') {
          return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  };

  const formatColumnValue = (columnName, value, recordId = null, record = null) => {
    if (columnName === "password") {
      return value; // Return actual value, we'll handle masking in the render
    }
    
    // Handle ISE hostname display
    if (columnName === "hostname" && record && record.application_type === "ise") {
      // For ISE, hostname can be empty, wildcard, or a name
      return record.hostname || "—";
    }
    
    // Handle boolean fields
    if (columnName === "enable_ssh" || columnName === "auto_restart_service" || columnName === "auto_renew" || columnName === "is_enabled") {
      return value === true || value === 1 || value === "1" ? "Yes" : "No";
    }
    
    // Handle auto-renewal status
    if (columnName === "auto_renew_status") {
      const statusMap = {
        'success': '✅ Success',
        'failed': '❌ Failed', 
        'in_progress': '🔄 In Progress',
        'timeout': '⏰ Timeout'
      };
      return statusMap[value] || value || "—";
    }
    
    // Handle auto-renewal last attempt timestamp
    if (columnName === "auto_renew_last_attempt") {
      if (!value) return "—";
      try {
        const date = new Date(value);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      } catch {
        return value;
      }
    }
    
    if (columnName === "ssl_provider") {
      return value === "letsencrypt" ? "Let's Encrypt" : "ZeroSSL";
    }
    
    if (columnName === "dns_provider") {
      const providers = {
        "cloudflare": "Cloudflare",
        "digitalocean": "DigitalOcean", 
        "route53": "AWS Route53",
        "azure": "Azure DNS",
        "google": "Google Cloud DNS",
        "custom": "Custom DNS (Manual)"
      };
      return providers[value] || value;
    }
    
    if (columnName === "application_type") {
      const types = {
        "vos": "Cisco VOS",
        "ise": "Cisco ISE",
        "general": "General Application"
      };
      return types[value] || value;
    }
    
    if (columnName === "ise_application_subtype") {
      const subtypes = {
        "guest": "Guest",
        "portal": "Portal", 
        "admin": "Admin"
      };
      // For ISE connections without a subtype, default to Guest
      if (!value && record?.application_type === "ise") {
        return "Guest (default)";
      }
      return subtypes[value] || value || "—";
    }
    
    if (columnName === "ise_cert_import_config") {
      if (!value) return "—";
      try {
        // Parse and pretty-print JSON
        const jsonObject = typeof value === 'string' ? JSON.parse(value) : value;
        return (
          <pre className="bg-gray-100 dark:bg-gray-800 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap font-mono">
            {JSON.stringify(jsonObject, null, 2)}
          </pre>
        );
      } catch (error) {
        // If not valid JSON, display as-is
        return value;
      }
    }
    
    return value || "—";
  };


  const getMainDisplayColumns = (record) => {
    const baseColumns = ["application_type", "name"];
    
    // All application types now use hostname and domain
    return [...baseColumns, "hostname", "domain"];
  };

  const getDetailColumns = (record) => {
    // Get all columns except main display columns and application type info fields
    const excludedFields = [...getMainDisplayColumns(record), 'application_type_info', 'application_type_info_ise', 'application_type_info_general'];
    
    const allColumns = jsonData.filter(col => !excludedFields.includes(col.name));
    
    // Filter columns based on conditional logic
    const filteredColumns = allColumns.filter(col => {
      // If no conditional logic, always show
      if (!col.conditional && !col.conditionalMultiple) return true;
      
      // Check single conditional
      if (col.conditional) {
        return record[col.conditional.field] === col.conditional.value;
      }
      
      // Check multiple conditionals (any match)
      if (col.conditionalMultiple) {
        return col.conditionalMultiple.some(condition => 
          condition.values.includes(record[condition.field])
        );
      }
      
      return true;
    });
    
    // Define the top fields (3 key fields now that application_type is in main bar)
    const topFields = ["ssl_provider", "dns_provider", "version"];
    
    // Get remaining fields, with enable_ssh always last
    const remainingFields = filteredColumns.filter(col => !topFields.includes(col.name) && col.name !== "enable_ssh");
    const enableSSHField = filteredColumns.find(col => col.name === "enable_ssh");
    
    // Combine: top fields first, then remaining fields, then enable_ssh last
    const orderedColumns = [
      ...topFields.map(name => filteredColumns.find(col => col.name === name)).filter(Boolean),
      ...remainingFields,
      ...(enableSSHField ? [enableSSHField] : [])
    ];
    
    return orderedColumns;
  };

  return (
    <div className="mt-4 w-full space-y-2">
      {data.length > 0 ? (
        data.map((record) => (
          <div key={record.id} className={`bg-white/85 dark:bg-gray-800/85 backdrop-blur-sm border rounded-lg shadow-sm overflow-hidden ${
            !isConnectionEnabled(record)
              ? 'border-gray-300 dark:border-gray-600 opacity-60' 
              : 'border-gray-200 dark:border-gray-700'
          }`}>
            {/* Main Row */}
            <div className="p-4 flex items-center justify-between">
              <div className="flex-1">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {getMainDisplayColumns(record).map((colName) => {
                  const col = jsonData.find(c => c.name === colName);
                  if (!col) return null;
                  
                  return (
                    <div key={colName} className="min-w-0">
                      <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                        {formatColumnName(colName)}
                      </div>
                      <div className="text-sm text-gray-900 dark:text-gray-100 truncate">
                        {formatColumnValue(colName, record[colName], record.id, record)}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
              
              <div className="flex items-center space-x-2 ml-4">
                {/* Enable/Disable Switch */}
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {toggling.has(record.id) ? 'Updating...' : (isConnectionEnabled(record) ? 'Enabled' : 'Disabled')}
                  </span>
                  <button
                    onClick={() => handleToggleEnabled(record)}
                    disabled={toggling.has(record.id)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
                      isConnectionEnabled(record)
                        ? 'bg-green-500 hover:bg-green-600'
                        : 'bg-red-500 hover:bg-red-600'
                    }`}
                    title={!isConnectionEnabled(record) ? 'Enable connection' : 'Disable connection'}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        isConnectionEnabled(record) ? 'translate-x-6' : 'translate-x-1'
                      } ${toggling.has(record.id) ? 'animate-pulse' : ''}`}
                    />
                  </button>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingRecord(record)}
                  className="flex items-center space-x-1"
                >
                  <Edit className="w-4 h-4" />
                </Button>
                
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(record.id)}
                  className="flex items-center space-x-1 text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleRow(record.id)}
                  className="flex items-center space-x-1"
                >
                  {expandedRows.has(record.id) ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                  <span>{expandedRows.has(record.id) ? 'Less' : 'More'}</span>
                </Button>
              </div>
            </div>
            
            {/* Expanded Details */}
            {expandedRows.has(record.id) && (
              <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50/85 dark:bg-gray-900/85 backdrop-blur-sm p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {getDetailColumns(record).map((col) => {
                    const columnName = col.name.trim();
                    const cellValue = record[columnName];
                    
                    return (
                      <div key={columnName} className="min-w-0">
                        <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          {formatColumnName(columnName)}
                        </div>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          {columnName === "password" ? (
                            <div className="flex items-center space-x-2">
                              <span className="font-mono">
                                {visiblePasswords.has(record.id) ? cellValue : "••••••••"}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => togglePasswordVisibility(record.id)}
                                className="h-6 w-6 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
                              >
                                {visiblePasswords.has(record.id) ? (
                                  <EyeOff className="w-3 h-3" />
                                ) : (
                                  <Eye className="w-3 h-3" />
                                )}
                              </Button>
                            </div>
                          ) : columnName === "enable_ssh" || columnName === "is_enabled" ? (
                            <div className="flex items-center">
                              {(columnName === "enable_ssh" ? record.enable_ssh : isConnectionEnabled(record)) ? (
                                <Badge variant="default" className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-[4px]">
                                  Yes
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-[4px]">
                                  No
                                </Badge>
                              )}
                            </div>
                          ) : columnName === "custom_csr" || columnName === "general_private_key" || columnName === "ise_certificate" || columnName === "ise_private_key" ? (
                            // Show status for certificate and key fields instead of content
                            <div className="flex items-center">
                              {cellValue && cellValue.trim() !== "" ? (
                                <Badge variant="default" className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-[4px]">
                                  Present
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-[4px]">
                                  Not Set
                                </Badge>
                              )}
                            </div>
                          ) : (
                            formatColumnValue(columnName, cellValue, record.id, record)
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* Tools Section */}
                <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <Wrench className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Tools</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* SSH Test Button - show only for VOS applications with SSH enabled */}
                    {record.enable_ssh && record.application_type === 'vos' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSSHTest(record)}
                        disabled={testingSSH.has(record.id)}
                        className="text-blue-600 hover:text-blue-700 border-blue-300 hover:border-blue-400"
                      >
                        <Terminal className="mr-2 h-4 w-4" />
                        {testingSSH.has(record.id) ? 'Testing SSH...' : 'Test SSH'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))
      ) : (
        <div className="bg-white/85 dark:bg-gray-800/85 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
          <div className="text-gray-500 dark:text-gray-400">
            No connections found. Add your first Cisco UC server connection above.
          </div>
        </div>
      )}
      

      {/* Edit Modal */}
      <EditConnectionModal
        record={editingRecord}
        isOpen={editingRecord !== null}
        onClose={() => setEditingRecord(null)}
        onConnectionUpdated={onDataChange}
      />
    </div>
  );
};

export default DataTable;