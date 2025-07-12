import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useConfig } from '../config/ConfigContext';
import { apiCall } from '../lib/api';
import { ChevronDown, ChevronUp, Trash2, Eye, EyeOff, Edit, Terminal } from 'lucide-react';
import EditConnectionModal from './EditConnectionModal';
import { useToast } from "@/hooks/use-toast";

const DataTable = ({ data, onDataChange }) => {
  const config = useConfig();
  const { toast } = useToast();
  const [jsonData, setData] = useState([]);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [visiblePasswords, setVisiblePasswords] = useState(new Set());
  const [editingRecord, setEditingRecord] = useState(null);
  const [testingSSH, setTestingSSH] = useState(new Set());

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
    
    return value || "—";
  };


  const getMainDisplayColumns = () => {
    return ["name", "hostname", "domain"];
  };

  const getDetailColumns = () => {
    return jsonData.filter(col => !getMainDisplayColumns().includes(col.name) && col.name !== 'custom_csr');
  };

  return (
    <div className="mt-4 w-full space-y-2">
      {data.length > 0 ? (
        data.map((record) => (
          <div key={record.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm overflow-hidden">
            {/* Main Row */}
            <div className="p-4 flex items-center justify-between">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                {getMainDisplayColumns().map((colName) => {
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
                {record.application_type === 'vos' && record.enable_ssh && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSSHTest(record)}
                    disabled={testingSSH.has(record.id)}
                    className="flex items-center space-x-1"
                    title="Test SSH Connection"
                  >
                    <Terminal className="w-4 h-4" />
                    {testingSSH.has(record.id) ? 'Testing...' : 'SSH Test'}
                  </Button>
                )}
                
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
              <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {getDetailColumns().map((col) => {
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
                          ) : (
                            formatColumnValue(columnName, cellValue)
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Connection ID
                    </div>
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      #{record.id}
                    </div>
                  </div>
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