import { useState, useEffect } from "react";
import { flushSync } from "react-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import DataForm from "./DataForm";

interface FieldCondition {
  field: string;
  value: string | boolean;
}

interface FieldConditionMultiple {
  field: string;
  values: (string | boolean)[];
}

interface FormField {
  name: string;
  type: string;
  default?: string | boolean;
  conditional?: FieldCondition;
  conditionalMultiple?: FieldConditionMultiple[];
  conditionalNot?: FieldCondition;
}

interface AddConnectionModalTabbedProps {
  onConnectionAdded: () => void;
  trigger?: React.ReactNode;
}

// Define the field groups
const FIELD_GROUPS = {
  basic: ["name", "application_type", "ise_application_subtype", "application_type_info", "application_type_info_ise", "application_type_info_general"],
  authentication: ["username", "password"],
  certificate: ["hostname", "domain", "ssl_provider", "dns_provider", "alt_names", "custom_csr", "general_private_key", "ise_nodes", "ise_certificate", "ise_private_key", "ise_cert_import_config"],
  advanced: ["enable_ssh", "auto_restart_service", "auto_renew", "is_enabled"]
};

const AddConnectionModalTabbed: React.FC<AddConnectionModalTabbedProps> = ({ 
  onConnectionAdded, 
  trigger 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("basic");
  const [formData, setFormData] = useState<Record<string, string | boolean>>({});
  const [data, setData] = useState<FormField[]>([]);

  // Fetch configuration data
  useEffect(() => {
    const fetchData = async () => {
      const response = await fetch("/dbSetup.json");
      const jsonData = await response.json();
      setData(jsonData);
      
      // Initialize form data with default values
      const initialData = jsonData.reduce((obj: Record<string, string | boolean>, value: FormField) => {
        obj[value.name] = value.default !== undefined ? value.default : (value.type === "SWITCH" ? false : "");
        return obj;
      }, {});
      setFormData(initialData);
    };
    fetchData();
  }, []);

  // Reset to first tab when opening modal
  useEffect(() => {
    if (isOpen) {
      setActiveTab("basic");
    }
  }, [isOpen]);

  const handleConnectionAdded = () => {
    onConnectionAdded();
    setIsOpen(false);
    setFormData({});
  };

  // Handle form data changes without focus issues
  const handleFormDataChange = (newFormData: Record<string, string | boolean>) => {
    // Use flushSync to ensure atomic updates and prevent focus issues
    flushSync(() => {
      setFormData(prevData => ({
        ...prevData,
        ...newFormData
      }));
    });
  };

  const defaultTrigger = (
    <Button className="flex items-center space-x-2">
      <Plus className="w-4 h-4" />
      <span>Add Connection</span>
    </Button>
  );

  // Check if a tab should be shown based on conditional fields
  const shouldShowTab = (tabName: string) => {
    const fields = FIELD_GROUPS[tabName as keyof typeof FIELD_GROUPS];
    return fields.some(fieldName => {
      const field = data.find(f => f.name === fieldName);
      if (!field) return false;
      if (!field.conditional && !field.conditionalMultiple && !field.conditionalNot) return true;
      
      if (field.conditional) {
        return formData[field.conditional.field] === field.conditional.value;
      }
      
      if (field.conditionalMultiple) {
        return field.conditionalMultiple.some((condition: FieldConditionMultiple) => 
          condition.values.includes(formData[condition.field])
        );
      }
      
      if (field.conditionalNot) {
        return formData[field.conditionalNot.field] !== field.conditionalNot.value;
      }
      
      return true;
    });
  };

  // Get fields for a specific tab that should be shown
  const getTabFields = (tabName: string) => {
    const fieldNames = FIELD_GROUPS[tabName as keyof typeof FIELD_GROUPS];
    return data.filter(field => {
      if (!fieldNames.includes(field.name)) return false;
      
      if (!field.conditional && !field.conditionalMultiple && !field.conditionalNot) return true;
      
      if (field.conditional) {
        return formData[field.conditional.field] === field.conditional.value;
      }
      
      if (field.conditionalMultiple) {
        return field.conditionalMultiple.some((condition: FieldConditionMultiple) => 
          condition.values.includes(formData[condition.field])
        );
      }
      
      if (field.conditionalNot) {
        return formData[field.conditionalNot.field] !== field.conditionalNot.value;
      }
      
      return true;
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent
        className="max-w-4xl w-[95vw] sm:w-[90vw] max-h-[90vh] h-[90vh] flex flex-col overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>Add New Connection</DialogTitle>
          <DialogDescription>
            Add a new Cisco application connection for certificate management.
          </DialogDescription>
        </DialogHeader>
        
        <Tabs key="modal-tabs" value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 flex-shrink-0">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            {shouldShowTab("authentication") && (
              <TabsTrigger value="authentication">Authentication</TabsTrigger>
            )}
            <TabsTrigger value="certificate">Certificate</TabsTrigger>
            {shouldShowTab("advanced") && (
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            )}
          </TabsList>
          
          <div className="flex-1 overflow-y-auto pl-1 pr-2 mt-4 pb-4 min-h-0 scroll-smooth scrollbar-styled">
            <TabsContent value="basic" className="mt-0">
              <DataForm 
                onDataAdded={handleConnectionAdded}
                fields={getTabFields("basic")}
                onFormDataChange={handleFormDataChange}
                sharedFormData={formData}
                isPartOfTabbedForm={true}
              />
            </TabsContent>
            
            {shouldShowTab("authentication") && (
              <TabsContent value="authentication" className="mt-0">
                <DataForm 
                  onDataAdded={handleConnectionAdded}
                  fields={getTabFields("authentication")}
                  onFormDataChange={handleFormDataChange}
                  sharedFormData={formData}
                  isPartOfTabbedForm={true}
                />
              </TabsContent>
            )}
            
            <TabsContent value="certificate" className="mt-0">
              <DataForm 
                onDataAdded={handleConnectionAdded}
                fields={getTabFields("certificate")}
                onFormDataChange={handleFormDataChange}
                sharedFormData={formData}
                isPartOfTabbedForm={true}
              />
            </TabsContent>
            
            {shouldShowTab("advanced") && (
              <TabsContent value="advanced" className="mt-0">
                <DataForm 
                  onDataAdded={handleConnectionAdded}
                  fields={getTabFields("advanced")}
                  onFormDataChange={handleFormDataChange}
                  sharedFormData={formData}
                  isPartOfTabbedForm={true}
                />
              </TabsContent>
            )}
          </div>
          
          <div className="flex justify-end pt-4 border-t flex-shrink-0 bg-background">
            <Button 
              onClick={() => {
                // Trigger form submission
                const form = document.querySelector('form') as HTMLFormElement;
                if (form) {
                  form.requestSubmit();
                }
              }}
            >
              Add Connection
            </Button>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default AddConnectionModalTabbed;