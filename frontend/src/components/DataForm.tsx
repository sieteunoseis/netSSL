import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import validator from "validator";
import { apiCall } from '../lib/api';

interface Column {
  name: string;
  type: string;
  optional?: boolean;
  label?: string;
  placeholder?: string;
  default?: string;
  options?: { value: string; label: string }[];
  allowCustom?: boolean;
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
    obj[value.name] = value.default || "";
    return obj;
  }, {});
  const [formData, setFormData] = useState<Record<string, string>>(object);

  useEffect(() => {
    const fetchData = async () => {
      const response = await fetch("/dbSetup.json"); // Note the leading '/'
      const jsonData: Column[] = await response.json();
      setData(jsonData);
      
      // Initialize form data with default values
      const initialData = jsonData.reduce((obj: Record<string, string>, value) => {
        obj[value.name] = value.default || "";
        return obj;
      }, {});
      setFormData(initialData);
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

  const handleSelectChange = (name: string, value: string, options: Column['validator'], isOptional = false) => {
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
      
      // Reset form with default values
      const resetData = data.reduce((obj: Record<string, string>, value) => {
        obj[value.name] = value.default || "";
        return obj;
      }, {});
      setFormData(resetData);
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
    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
      {data.map((col, index) => {
        const formValue = formData[col.name];
        const isOptional = col.optional === true;
        const label = col.label || formatColumnName(col.name);
        const placeholder = col.placeholder || (isOptional 
          ? `${label} (Optional)`
          : label);
          
        return (
          <div key={col.name} className="space-y-2">
            <Label>{label}</Label>
            
            {col.type === "SELECT" ? (
              <Select 
                value={formValue || col.default || ""} 
                onValueChange={(value) => handleSelectChange(col.name, value, col.validator, isOptional)}
              >
                <SelectTrigger tabIndex={0}>
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {col.options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                required={!isOptional}
                type={col.name === "password" || col.name === "pw" ? "password" : "text"}
                name={col.name}
                placeholder={placeholder}
                value={formValue || ""}
                autoComplete="off"
                data-lpignore="true"
                data-form-type="other"
                data-1p-ignore="true"
                autoFocus={index === 0}
                tabIndex={0}
                onChange={(e) => {
                  handleChange(e, col.validator, isOptional);
                }}
              />
            )}
            
            {errors[col.name] && <span className="text-red-500 font-semibold">{errors[col.name]}</span>}
          </div>
        );
      })}
      <Button type="submit" tabIndex={0}>Add Connection</Button>
    </form>
  );
};

export default DataForm;