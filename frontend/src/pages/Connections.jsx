import React, { useEffect, useState } from "react";
import DataTable from "@/components/DataTable";
import BackgroundLogo from "@/components/BackgroundLogo";
import AddConnectionModal from "@/components/AddConnectionModalTabbed";
import SettingsModal from "@/components/SettingsModal";
import { apiCall } from '../lib/api';
import { filterEnabledConnections } from '../lib/connection-utils';

function App() {
  const [data, setData] = useState([]);

  const fetchData = async () => {
    try {
      const response = await apiCall(`/data`);
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDataAdded = () => {
    fetchData(); // Refresh data when new data is added
  };

  return (
    <div className="min-h-full w-full py-20 relative bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      <BackgroundLogo />
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <img src="/logo.png" alt="netSSL" className="h-36 w-36 mb-4 rounded-full object-cover shadow-lg mix-blend-multiply dark:mix-blend-normal" />
            <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl mb-2">Saved Connections</h1>
            <p className="text-lg text-gray-600 dark:text-gray-300">
              Manage your network application connections ({data.length} total, {filterEnabledConnections(data).length} enabled)
            </p>
          </div>
          <div className="flex space-x-2">
            <AddConnectionModal onConnectionAdded={handleDataAdded} />
            <SettingsModal />
          </div>
        </div>
        
        {data.length > 0 ? (
          <DataTable data={data} onDataChange={fetchData} />
        ) : (
          <div className="text-center py-12">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No connections found</h3>
            <p className="text-gray-500 mb-4">
              Add your first server connection to get started.
            </p>
            <AddConnectionModal onConnectionAdded={handleDataAdded} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
