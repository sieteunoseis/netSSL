import React, { useEffect, useState } from "react";
import DataForm from "@/components/DataForm";
import DataTable from "@/components/DataTable";
import BackgroundLogo from "@/components/BackgroundLogo";
import { apiCall } from '../lib/api';

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
      <div className="max-w-4xl mx-auto px-4">
      <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl mb-2">Manage Connections</h1>
          <DataForm onDataAdded={handleDataAdded} />
          {data.length === 0 ? (
            <p className="text-gray-600 text-center">No connections available.</p>
          ) : (
            <div>
              <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl mt-6 mb-2">Saved Connections</h1>
              <DataTable data={data} onDataChange={fetchData} />
            </div>
          )}
      </div>
    </div>
  );
}

export default App;
