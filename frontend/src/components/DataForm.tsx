import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import validator from "validator";
import { apiCall } from '../lib/api';

interface Column {
  name: string;
  type: string;
  optional?: boolean;
  validator: {
    name: keyof typeof validator;
    options?: any;
  };
}

interface DataFormProps {
  onDataAdded: () => void;
}

const DataForm: React.FC<DataFormProps> = ({ onDataAdded }) => {
  const { toast } = useToast();
  const [data, setData] = useState<Column[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const object = data.reduce((obj: Record<string, string>, value) => {
    obj[value.name] = "";
    return obj;
  }, {});
  const [formData, setFormData] = useState<Record<string, string>>(object);

  useEffect(() => {
    const fetchData = async () => {
      const response = await fetch("/dbSetup.json"); // Note the leading '/'
      const jsonData: Column[] = await response.json();
      setData(jsonData);
    };

    fetchData();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, options: Column['validator'], isOptional = false) => {
    const { name, value } = e.target;
    const newErrors: Record<string, string> = {};

    // Validate - skip validation if field is optional and empty
    if (value.trim() !== '' || !isOptional) {
      const validatorFn = validator[options.name] as any;
      if (!validatorFn(value, options.options)) {
        newErrors[name] = "Invalid value";
      } else {
        newErrors[name] = "";
      }
    } else {
      newErrors[name] = "";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
    }

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiCall(`/data`, {
        method: "POST",
        body: JSON.stringify(formData),
      });
      
      toast({
        title: "Success!",
        description: "Connection added successfully.",
        duration: 3000,
      });
      
      onDataAdded(); // Notify the table to refresh
      setFormData(object);
    } catch (error) {
      console.error("Error inserting data:", error);
      
      toast({
        title: "Error",
        description: "Failed to add connection. Please try again.",
        variant: "destructive",
        duration: 5000,
      });
    }
  };

  const formatColumnName = (col: string): string => {
    return col
      .replace(/[^a-zA-Z]+/g, " ") // Replace non-letter characters with spaces
      .toUpperCase();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {data.map((col) => {
        const formValue = formData[col.name];
        let type = "text";
        if (col.name === "password" || col.name === "pw") {
          type = "password";
        }
        
        const isOptional = col.optional === true;
        const placeholder = isOptional 
          ? `${formatColumnName(col.name)} (Optional)`
          : formatColumnName(col.name);
          
        return (
          <div key={col.name}>
            <Input
              required={!isOptional}
              type={type}
              name={col.name}
              placeholder={placeholder}
              value={formValue || ""}
              onChange={(e) => {
                handleChange(e, col.validator, isOptional);
              }}
            />
            {errors[col.name] && <span className="text-red-500 font-semibold">{errors[col.name]}</span>}
          </div>
        );
      })}
      <Button type="submit">Add Connection</Button>
    </form>
  );
};

export default DataForm;