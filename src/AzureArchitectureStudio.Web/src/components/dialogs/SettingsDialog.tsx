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
  Dropdown,
  Option,
  Divider,
} from '@fluentui/react-components';
import { EyeRegular, EyeOffRegular } from '@fluentui/react-icons';
import {
  loadOpenAISettings,
  saveOpenAISettings,
  clearOpenAISettings,
  emptyOpenAISettings,
  loadDiagramSettings,
  saveDiagramSettings,
  defaultDiagramSettings,
  type OpenAISettings,
  type DiagramSettings,
  type EdgeStyle,
} from '../../services';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const EDGE_STYLE_OPTIONS: { value: EdgeStyle; label: string; description: string }[] = [
  { value: 'smoothstep', label: 'Smooth Step', description: 'Right-angle path with rounded corners (recommended)' },
  { value: 'step', label: 'Step', description: 'Right-angle path with sharp corners' },
  { value: 'bezier', label: 'Bezier', description: 'Curved path' },
  { value: 'straight', label: 'Straight', description: 'Direct line between handles' },
];

export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<OpenAISettings>(emptyOpenAISettings);
  const [diagramSettings, setDiagramSettings] = useState<DiagramSettings>(defaultDiagramSettings);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (open) {
      setSettings(loadOpenAISettings());
      setDiagramSettings(loadDiagramSettings());
      setShowKey(false);
    }
  }, [open]);

  const update = (k: keyof OpenAISettings, v: string) =>
    setSettings((prev) => ({ ...prev, [k]: v }));

  const handleSave = () => {
    saveOpenAISettings(settings);
    saveDiagramSettings(diagramSettings);
    onClose();
  };

  const handleClear = () => {
    clearOpenAISettings();
    setSettings(emptyOpenAISettings);
  };

  const currentEdge = EDGE_STYLE_OPTIONS.find((o) => o.value === diagramSettings.edgeStyle)
    ?? EDGE_STYLE_OPTIONS[0];

  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface style={{ maxWidth: 520 }}>
        <DialogBody>
          <DialogTitle>Settings</DialogTitle>
          <DialogContent>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600 }}>Diagram</h3>
            <Field
              label="Connection line style"
              hint={currentEdge.description}
              style={{ marginBottom: 16 }}
            >
              <Dropdown
                value={currentEdge.label}
                selectedOptions={[diagramSettings.edgeStyle]}
                onOptionSelect={(_, d) => {
                  const v = (d.optionValue ?? 'smoothstep') as EdgeStyle;
                  setDiagramSettings({ ...diagramSettings, edgeStyle: v });
                }}
              >
                {EDGE_STYLE_OPTIONS.map((o) => (
                  <Option key={o.value} value={o.value} text={o.label}>
                    {o.label}
                  </Option>
                ))}
              </Dropdown>
            </Field>

            <Divider style={{ margin: '8px 0 16px 0' }} />

            <h3 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600 }}>AI Assistant</h3>
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
              Clear AI creds
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
