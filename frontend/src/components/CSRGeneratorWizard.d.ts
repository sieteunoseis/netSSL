declare const CSRGeneratorWizard: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (generatedData: any) => void;
  hostname: string;
  domain: string;
  commonName?: string;
  keySize?: string;
  sans?: string[];
  mode?: "generate" | "configure";
}>;
export default CSRGeneratorWizard;
