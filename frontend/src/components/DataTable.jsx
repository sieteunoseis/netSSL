import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfig } from '../config/ConfigContext';
import { apiCall } from '../lib/api';
import { ChevronDown, ChevronUp, Trash2, Eye, EyeOff, Edit, Terminal, RotateCcw, Server } from 'lucide-react';
import EditConnectionModal from './EditConnectionModalTabbed';
import { useToast } from "@/hooks/use-toast";

const DataTable = ({ data, onDataChange }) => {
  const config = useConfig();
  const { toast } = useToast();
  const [jsonData, setData] = useState([]);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [visiblePasswords, setVisiblePasswords] = useState(new Set());
  const [editingRecord, setEditingRecord] = useState(null);
  const [testingSSH, setTestingSSH] = useState(new Set());
  const [restartingService, setRestartingService] = useState(new Set());
  const [confirmRestart, setConfirmRestart] = useState(null); // {id, name} for confirmation dialog

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
      // Construct FQDN by combining hostname and domain
      const fqdn = record.domain ? `${record.hostname}.${record.domain}` : record.hostname;
      
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

  const handleServiceRestart = async (record, confirmed = false) => {
    // If not confirmed, show confirmation dialog
    if (!confirmed) {
      setConfirmRestart({ id: record.id, name: record.name });
      return;
    }

    // Close confirmation dialog
    setConfirmRestart(null);

    const newRestarting = new Set(restartingService);
    newRestarting.add(record.id);
    setRestartingService(newRestarting);

    try {
      const response = await apiCall(`/data/${record.id}/restart-service`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Service Restart Successful",
          description: "Cisco Tomcat service has been restarted successfully",
        });
      } else {
        toast({
          title: "Service Restart Failed",
          description: result.error || "Unable to restart service",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error restarting service:', error);
      toast({
        title: "Restart Error",
        description: "Failed to restart service. Please check your connection.",
        variant: "destructive",
      });
    } finally {
      const newRestarting = new Set(restartingService);
      newRestarting.delete(record.id);
      setRestartingService(newRestarting);
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
        // Keep SSL, DNS, and SSH in uppercase
        if (word.toLowerCase() === 'ssl' || word.toLowerCase() === 'dns' || word.toLowerCase() === 'ssh') {
          return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  };

  const formatColumnValue = (columnName, value, recordId = null) => {
    if (columnName === "password") {
      return value; // Return actual value, we'll handle masking in the render
    }
    
    // Handle boolean fields
    if (columnName === "enable_ssh" || columnName === "auto_restart_service" || columnName === "auto_renew") {
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
        "google": "Google Cloud DNS"
      };
      return providers[value] || value;
    }
    
    if (columnName === "application_type") {
      const types = {
        "vos": "Cisco VOS",
        "ise": "Cisco ISE Guest Portal",
        "general": "General Application"
      };
      return types[value] || value;
    }
    
    return value || "—";
  };


  const getMainDisplayColumns = (record) => {
    const baseColumns = ["application_type", "name"];
    
    if (record && record.application_type === "ise") {
      return [...baseColumns, "portal_url", "ise_nodes"];
    } else {
      return [...baseColumns, "hostname", "domain"];
    }
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
          <div key={record.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm overflow-hidden">
            {/* Main Row */}
            <div className="p-4 flex items-center justify-between">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4">
                {getMainDisplayColumns(record).map((colName) => {
                  const col = jsonData.find(c => c.name === colName);
                  if (!col) return null;
                  
                  return (
                    <div key={colName} className="min-w-0">
                      <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                        {formatColumnName(colName)}
                      </div>
                      <div className="text-sm text-gray-900 dark:text-gray-100 truncate">
                        {formatColumnValue(colName, record[colName])}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div className="flex items-center space-x-2 ml-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingRecord(record)}
                  className="flex items-center space-x-1"
                >
                  <Edit className="w-4 h-4" />
                </Button>
                
                {/* VOS Service Restart Button - only show for VOS apps with SSH enabled */}
                {record.application_type === 'vos' && record.enable_ssh && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleServiceRestart(record)}
                    disabled={restartingService.has(record.id)}
                    className="flex items-center space-x-1 text-orange-600 hover:text-orange-700 disabled:opacity-50"
                    title="Restart Cisco Tomcat Service"
                  >
                    <Server className="w-4 h-4" />
                    {restartingService.has(record.id) && <RotateCcw className="w-3 h-3 animate-spin" />}
                  </Button>
                )}
                
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
              <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
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
                          ) : columnName === "enable_ssh" ? (
                            <div className="flex items-center">
                              {record.enable_ssh ? (
                                <div className="flex items-center">
                                  {(record.application_type === 'vos' || record.application_type === 'ise') ? (
                                    // Split button design when SSH testing is available
                                    <div className="flex items-center space-x-2">
                                      <div className="flex items-center rounded-md overflow-hidden border border-gray-300 dark:border-gray-600">
                                        <div className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-1 text-xs font-medium">
                                          SSH Enabled
                                        </div>
                                        <button
                                          onClick={() => handleSSHTest(record)}
                                          disabled={testingSSH.has(record.id)}
                                          className="bg-blue-50 dark:bg-blue-900 hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-200 px-2 py-1 text-xs font-medium border-l border-gray-300 dark:border-gray-600 flex items-center space-x-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                          title="Test SSH Connection"
                                        >
                                          <Terminal className="w-3 h-3" />
                                          <span>{testingSSH.has(record.id) ? 'Testing...' : 'Test'}</span>
                                        </button>
                                      </div>
                                      {record.application_type === 'vos' && (
                                        <button
                                          onClick={() => handleServiceRestart(record)}
                                          disabled={restartingService.has(record.id)}
                                          className="bg-orange-50 dark:bg-orange-900 hover:bg-orange-100 dark:hover:bg-orange-800 text-orange-700 dark:text-orange-200 px-2 py-1 text-xs font-medium rounded-md border border-orange-300 dark:border-orange-600 flex items-center space-x-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                          title="Restart Cisco Tomcat Service"
                                        >
                                          <RotateCcw className="w-3 h-3" />
                                          <span>{restartingService.has(record.id) ? 'Restarting...' : 'Restart'}</span>
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    // Simple badge when no SSH testing available
                                    <Badge variant="default" className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                                      SSH Enabled
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <Badge variant="secondary" className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                                  SSH Disabled
                                </Badge>
                              )}
                            </div>
                          ) : columnName === "custom_csr" || columnName === "general_private_key" || columnName === "ise_certificate" || columnName === "ise_private_key" ? (
                            // Show status for certificate and key fields instead of content
                            <div className="flex items-center">
                              {cellValue && cellValue.trim() !== "" ? (
                                <Badge variant="default" className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                                  Present
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                                  Not Set
                                </Badge>
                              )}
                            </div>
                          ) : (
                            formatColumnValue(columnName, cellValue)
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
          <div className="text-gray-500 dark:text-gray-400">
            No connections found. Add your first Cisco UC server connection above.
          </div>
        </div>
      )}
      
      {/* Service Restart Confirmation Dialog */}
      {confirmRestart && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <Server className="w-6 h-6 text-orange-600 mr-3" />
              <h3 className="text-lg font-semibold">Confirm Service Restart</h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Are you sure you want to restart the Cisco Tomcat service on <strong>{confirmRestart.name}</strong>?
              <br /><br />
              This will temporarily interrupt access to the VOS application while the service restarts.
            </p>
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={() => setConfirmRestart(null)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={() => {
                  const record = data.find(r => r.id === confirmRestart.id);
                  if (record) handleServiceRestart(record, true);
                }}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                <Server className="w-4 h-4 mr-2" />
                Restart Service
              </Button>
            </div>
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