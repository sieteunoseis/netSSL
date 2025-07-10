import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useConfig } from '../config/ConfigContext';
import { apiCall } from '../lib/api';
import { ChevronDown, ChevronUp, FileText, Trash2, Clock, Eye, EyeOff, Edit } from 'lucide-react';
import EditConnectionModal from './EditConnectionModal';

const DataTable = ({ data, onDataChange }) => {
  const config = useConfig();
  const [jsonData, setData] = useState([]);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [visiblePasswords, setVisiblePasswords] = useState(new Set());
  const [editingRecord, setEditingRecord] = useState(null);

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

  const issueCertificate = async (id) => {
    try {
      await apiCall(`/data/${id}/issue-cert`, { method: "POST" });
      onDataChange();
    } catch (error) {
      console.error("Error issuing certificate:", error);
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
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  const formatColumnValue = (columnName, value, recordId = null) => {
    if (columnName === "password") {
      return value; // Return actual value, we'll handle masking in the render
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
    
    if (columnName === "last_cert_issued") {
      return value ? new Date(value).toLocaleDateString() : "Never";
    }
    
    return value || "—";
  };

  const getCertificateStatus = (record) => {
    if (!record.last_cert_issued) return "No certificate issued";
    
    const lastIssued = new Date(record.last_cert_issued);
    const now = new Date();
    const daysSince = Math.floor((now - lastIssued) / (1000 * 60 * 60 * 24));
    
    if (daysSince < 7) return `Issued ${daysSince} days ago`;
    if (daysSince < 30) return `Issued ${Math.floor(daysSince / 7)} weeks ago`;
    return `Issued ${Math.floor(daysSince / 30)} months ago`;
  };

  const getMainDisplayColumns = () => {
    return ["name", "hostname", "domain"];
  };

  const getDetailColumns = () => {
    return jsonData.filter(col => !getMainDisplayColumns().includes(col.name));
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
                <div className="text-xs text-gray-500 dark:text-gray-400 text-right">
                  <div className="flex items-center space-x-1">
                    <Clock className="w-3 h-3" />
                    <span>{getCertificateStatus(record)}</span>
                  </div>
                  {record.cert_count_this_week > 0 && (
                    <div className="mt-1">
                      {record.cert_count_this_week} certs this week
                    </div>
                  )}
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => issueCertificate(record.id)}
                  className="flex items-center space-x-1"
                >
                  <FileText className="w-4 h-4" />
                  <span>Issue Cert</span>
                </Button>
                
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
                  
                  {/* Certificate Status Details */}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Certificate Status
                    </div>
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      {getCertificateStatus(record)}
                    </div>
                  </div>
                  
                  {record.cert_count_this_week > 0 && (
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                        Weekly Usage
                      </div>
                      <div className="text-sm text-gray-900 dark:text-gray-100">
                        {record.cert_count_this_week} certificates this week
                      </div>
                    </div>
                  )}
                  
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