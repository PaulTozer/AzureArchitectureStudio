import {
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Button,
} from '@fluentui/react-components';
import {
  DismissRegular,
  CopyRegular,
  ArrowDownloadRegular,
} from '@fluentui/react-icons';
import './CodeDrawer.css';

interface CodeDrawerProps {
  type: 'arm' | 'bicep' | 'terraform';
  content: string;
  open: boolean;
  onClose: () => void;
}

export default function CodeDrawer({
  type,
  content,
  open,
  onClose,
}: CodeDrawerProps) {
  const formats = {
    arm: { title: 'ARM Template', extension: 'json', mime: 'application/json' },
    bicep: { title: 'Bicep (Azure Verified Modules)', extension: 'bicep', mime: 'text/plain' },
    terraform: { title: 'Terraform (AzureRM)', extension: 'tf.json', mime: 'application/json' },
  };
  const format = formats[type];

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: format.mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `azure-architecture.${format.extension}`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <OverlayDrawer
      position="end"
      size="large"
      open={open}
      onOpenChange={(_, d) => {
        if (!d.open) onClose();
      }}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <div style={{ display: 'flex', gap: 4 }}>
              <Button
                appearance="subtle"
                icon={<CopyRegular />}
                onClick={handleCopy}
                title="Copy to clipboard"
                aria-label="Copy to clipboard"
              />
              <Button
                appearance="primary"
                icon={<ArrowDownloadRegular />}
                onClick={handleDownload}
                title="Download"
                disabled={!content.trim()}
              >
                Download
              </Button>
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                onClick={onClose}
                aria-label="Close export"
              />
            </div>
          }
        >
          {format.title}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <pre className="code-drawer-content">
          <code>{content}</code>
        </pre>
      </DrawerBody>
    </OverlayDrawer>
  );
}
