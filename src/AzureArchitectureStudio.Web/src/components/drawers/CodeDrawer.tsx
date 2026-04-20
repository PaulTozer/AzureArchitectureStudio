import {
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Button,
  Textarea,
} from '@fluentui/react-components';
import {
  DismissRegular,
  CopyRegular,
  ArrowDownloadRegular,
} from '@fluentui/react-icons';
import './CodeDrawer.css';

interface CodeDrawerProps {
  type: 'arm' | 'bicep';
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
  const title = type === 'arm' ? 'ARM Template' : 'Bicep';

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
  };

  const handleDownload = () => {
    const ext = type === 'arm' ? 'json' : 'bicep';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `azure-architecture.${ext}`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
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
              />
              <Button
                appearance="subtle"
                icon={<ArrowDownloadRegular />}
                onClick={handleDownload}
                title="Download"
              />
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                onClick={onClose}
              />
            </div>
          }
        >
          {title}
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
