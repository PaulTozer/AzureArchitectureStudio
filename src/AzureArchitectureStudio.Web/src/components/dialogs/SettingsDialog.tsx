import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import { EyeRegular, EyeOffRegular } from '@fluentui/react-icons';
import {
  loadOpenAISettings,
  saveOpenAISettings,
  clearOpenAISettings,
  emptyOpenAISettings,
  type OpenAISettings,
} from '../../services';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<OpenAISettings>(emptyOpenAISettings);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (open) {
      setSettings(loadOpenAISettings());
      setShowKey(false);
    }
  }, [open]);

  const update = (k: keyof OpenAISettings, v: string) =>
    setSettings((prev) => ({ ...prev, [k]: v }));

  const handleSave = () => {
    saveOpenAISettings(settings);
    onClose();
  };

  const handleClear = () => {
    clearOpenAISettings();
    setSettings(emptyOpenAISettings);
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface style={{ maxWidth: 520 }}>
        <DialogBody>
          <DialogTitle>AI Assistant Settings</DialogTitle>
          <DialogContent>
            <MessageBar intent="info" style={{ marginBottom: 12 }}>
              <MessageBarBody>
                Credentials are stored only in this browser (localStorage) and are
                sent with each chat request to your own Azure OpenAI deployment.
                Nothing is logged or persisted on the server.{' '}
                <Link
                  href="https://learn.microsoft.com/azure/ai-services/openai/how-to/create-resource"
                  target="_blank"
                >
                  How to create an Azure OpenAI resource
                </Link>
              </MessageBarBody>
            </MessageBar>

            <Field label="Azure OpenAI Endpoint" required style={{ marginBottom: 12 }}>
              <Input
                placeholder="https://my-resource.openai.azure.com/"
                value={settings.endpoint}
                onChange={(_, d) => update('endpoint', d.value)}
              />
            </Field>

            <Field label="Deployment name" required style={{ marginBottom: 12 }}>
              <Input
                placeholder="gpt-4o"
                value={settings.deployment}
                onChange={(_, d) => update('deployment', d.value)}
              />
            </Field>

            <Field label="API Key" required>
              <Input
                type={showKey ? 'text' : 'password'}
                value={settings.apiKey}
                onChange={(_, d) => update('apiKey', d.value)}
                contentAfter={
                  <Button
                    appearance="transparent"
                    size="small"
                    icon={showKey ? <EyeOffRegular /> : <EyeRegular />}
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? 'Hide key' : 'Show key'}
                  />
                }
              />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={handleClear}>
              Clear
            </Button>
            <Button appearance="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={handleSave}>
              Save
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
