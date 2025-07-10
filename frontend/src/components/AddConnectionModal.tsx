import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import DataForm from "./DataForm";

interface AddConnectionModalProps {
  onConnectionAdded: () => void;
  trigger?: React.ReactNode;
}

const AddConnectionModal: React.FC<AddConnectionModalProps> = ({ 
  onConnectionAdded, 
  trigger 
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleConnectionAdded = () => {
    onConnectionAdded();
    setIsOpen(false);
  };

  const defaultTrigger = (
    <Button className="flex items-center space-x-2">
      <Plus className="w-4 h-4" />
      <span>Add Connection</span>
    </Button>
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent tabIndex={-1}>
        <DialogHeader>
          <DialogTitle>Add New Connection</DialogTitle>
          <DialogDescription>
            Add a new Cisco UC server connection for certificate management.
          </DialogDescription>
        </DialogHeader>
        <DataForm onDataAdded={handleConnectionAdded} />
      </DialogContent>
    </Dialog>
  );
};

export default AddConnectionModal;