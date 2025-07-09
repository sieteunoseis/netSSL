import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useConfig } from '../config/ConfigContext';
import { apiCall } from '../lib/api';

const DataTable = ({ data, onDataChange }) => {
  const config = useConfig();
  const [jsonData, setData] = useState([]);

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

  const selectRecord = async (id) => {
    try {
      await apiCall(`/data/select/${id}`, { method: "PUT" });
      onDataChange();
    } catch (error) {
      console.error("Error updating data:", error);
    }
  };

  const formatColumnName = (col) => {
    return col
      .replace(/[^a-zA-Z]+/g, ' ')
      .toUpperCase()
  };

  return (
    <div className="mt-4 w-full overflow-hidden rounded-lg border border-gray-300">
      <table className="w-full bg-white dark:bg-black">
        <thead>
          <tr>
            {["ID", ...jsonData.map((col) => (col.name)), "Actions"].map((col, index, array) => (
              <th 
                className={`border-b border-r p-2 ${
                  index === 0 ? 'rounded-tl-lg' : ''
                } ${
                  index === array.length - 1 ? 'rounded-tr-lg border-r-0' : ''
                }`}
                key={col}
              >
                {formatColumnName(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length > 0 ? (
            data.map((record, rowIndex) => (
              <tr key={record.id}>
                <td className="border-r border-b p-2">{record.id}</td>
                {jsonData.map((col) => {
                  const columnName = col.name.trim();
                  const cellValue = record[columnName] || "";

                  const renderCellValue = () => {
                    if (columnName === "password" || columnName === "pw") {
                      return <span>********</span>;
                    }
                    
                    if (columnName === "version") {
                      if (!cellValue || cellValue.trim() === "") {
                        return <span className="text-gray-400 italic">N/A</span>;
                      }
                      return cellValue;
                    }
                    
                    return cellValue;
                  };

                  return (
                    <td className="border-r border-b p-2" key={columnName}>
                      {renderCellValue()}
                    </td>
                  );
                })}
                <td className={`border-b p-2`}>
                  {record.selected === "YES" ? (
                    <Button className="mr-2 bg-green-600 hover:bg-green-500">Selected</Button>
                  ) : (
                    <Button onClick={() => selectRecord(record.id)} className="mr-2">
                      Select
                    </Button>
                  )}
                  <Button onClick={() => handleDelete(record.id)}>Delete</Button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td 
                colSpan={config.tableColumns.split(",").length + 2} 
                className="border-b text-center p-2"
              >
                No records found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DataTable;