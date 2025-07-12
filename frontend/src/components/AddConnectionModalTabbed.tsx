import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import DataForm from "./DataForm";

interface AddConnectionModalTabbedProps {
  onConnectionAdded: () => void;
  trigger?: React.ReactNode;
}

// Define the field groups
const FIELD_GROUPS = {
  basic: ["name", "hostname", "application_type"],
  authentication: ["username", "password"],
  certificate: ["domain", "ssl_provider", "dns_provider", "alt_names", "custom_csr"],
  advanced: ["enable_ssh", "auto_restart_service", "auto_renew"]
};

const AddConnectionModalTabbed: React.FC<AddConnectionModalTabbedProps> = ({ 
  onConnectionAdded, 
  trigger 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("basic");
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [data, setData] = useState<any[]>([]);

  // Fetch configuration data
  useEffect(() => {
    const fetchData = async () => {
      const response = await fetch("/dbSetup.json");
      const jsonData = await response.json();
      setData(jsonData);
      
      // Initialize form data with default values
      const initialData = jsonData.reduce((obj: Record<string, any>, value: any) => {
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
      if (!field.conditional) return true;
      return formData[field.conditional.field] === field.conditional.value;
    });
  };

  // Get fields for a specific tab that should be shown
  const getTabFields = (tabName: string) => {
    const fieldNames = FIELD_GROUPS[tabName as keyof typeof FIELD_GROUPS];
    return data.filter(field => {
      if (!fieldNames.includes(field.name)) return false;
      if (!field.conditional) return true;
      return formData[field.conditional.field] === field.conditional.value;
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent tabIndex={-1} className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add New Connection</DialogTitle>
          <DialogDescription>
            Add a new Cisco UC server connection for certificate management.
          </DialogDescription>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            {shouldShowTab("authentication") && (
              <TabsTrigger value="authentication">Authentication</TabsTrigger>
            )}
            <TabsTrigger value="certificate">Certificate</TabsTrigger>
            {shouldShowTab("advanced") && (
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            )}
          </TabsList>
          
          <div className="flex-1 overflow-y-auto pl-1 pr-2 mt-4 pb-4">
            <TabsContent value="basic" className="mt-0">
              <DataForm 
                onDataAdded={handleConnectionAdded}
                fields={getTabFields("basic")}
                onFormDataChange={setFormData}
                sharedFormData={formData}
                isPartOfTabbedForm={true}
              />
            </TabsContent>
            
            {shouldShowTab("authentication") && (
              <TabsContent value="authentication" className="mt-0">
                <DataForm 
                  onDataAdded={handleConnectionAdded}
                  fields={getTabFields("authentication")}
                  onFormDataChange={setFormData}
                  sharedFormData={formData}
                  isPartOfTabbedForm={true}
                />
              </TabsContent>
            )}
            
            <TabsContent value="certificate" className="mt-0">
              <DataForm 
                onDataAdded={handleConnectionAdded}
                fields={getTabFields("certificate")}
                onFormDataChange={setFormData}
                sharedFormData={formData}
                isPartOfTabbedForm={true}
              />
            </TabsContent>
            
            {shouldShowTab("advanced") && (
              <TabsContent value="advanced" className="mt-0">
                <DataForm 
                  onDataAdded={handleConnectionAdded}
                  fields={getTabFields("advanced")}
                  onFormDataChange={setFormData}
                  sharedFormData={formData}
                  isPartOfTabbedForm={true}
                />
              </TabsContent>
            )}
          </div>
          
          <div className="flex justify-end pt-4 border-t">
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