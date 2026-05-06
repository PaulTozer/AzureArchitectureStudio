import { useState, useCallback, useEffect } from 'react';
import {
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  Menu,
  MenuTrigger,
  MenuList,
  MenuPopover,
  MenuItem,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Button,
  Input,
  Spinner,
  Toast,
  Toaster,
  useToastController,
  useId,
} from '@fluentui/react-components';
import {
  PersonRegular,
  ArrowExportRegular,
  SaveRegular,
  FolderOpenRegular,
  DocumentRegular,
  ImageRegular,
  CodeRegular,
  DeleteRegular,
  SignOutRegular,
  DocumentAddRegular,
  SparkleRegular,
  SettingsRegular,
} from '@fluentui/react-icons';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { useAppContext } from '../context/AppContext';
import { azureManagementRequest, isAuthConfigured, bicepService } from '../services';
import {
  createArmTemplate,
  getArmResourcesForNode,
  type AzureNodeData,
} from '../models';
import { toPng } from 'html-to-image';
import CodeDrawer from './drawers/CodeDrawer';
import SaveDrawer from './drawers/SaveDrawer';
import ChatDrawer from './drawers/ChatDrawer';
import SettingsDialog from './dialogs/SettingsDialog';
import SubscriptionPicker from './SubscriptionPicker';
import './TopMenu.css';

export default function TopMenu() {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const { nodes, edges, clearDiagram } = useAppContext();
  const toasterId = useId('toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [codeDrawerOpen, setCodeDrawerOpen] = useState(false);
  const [codeDrawerContent, setCodeDrawerContent] = useState<{
    type: 'arm' | 'bicep';
    content: string;
  } | null>(null);
  const [saveDrawerOpen, setSaveDrawerOpen] = useState(false);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const handleNewDiagram = useCallback(() => {
    if (nodes.length === 0 && edges.length === 0) {
      // Nothing to lose — just clear (also wipes any persisted state)
      clearDiagram();
      return;
    }
    setNewDialogOpen(true);
  }, [nodes.length, edges.length, clearDiagram]);

  const showToast = useCallback(
    (message: string, intent: 'success' | 'error' | 'warning' | 'info') => {
      dispatchToast(<Toast>{message}</Toast>, { intent });
    },
    [dispatchToast]
  );

  // Listen for global notification events (e.g. blocked diagram connections).
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ message?: string; intent?: 'success' | 'error' | 'warning' | 'info' }>).detail;
      if (!detail?.message) return;
      showToast(detail.message, detail.intent ?? 'info');
    };
    window.addEventListener('aas:notify', handler);
    return () => window.removeEventListener('aas:notify', handler);
  }, [showToast]);

  const handleLogin = useCallback(async () => {
    if (!isAuthConfigured) {
      showToast(
        'Azure sign-in not configured. Set VITE_AZURE_CLIENT_ID in .env.local.',
        'error',
      );
      return;
    }
    try {
      // Redirect-based login is more robust than popup — it sidesteps
      // COOP / window.opener restrictions and always lands back on
      // the SPA at window.location.origin (handled in main.tsx via
      // handleRedirectPromise()).
      await instance.loginRedirect(azureManagementRequest);
    } catch (err) {
      console.error('Login failed:', err);
      showToast('Sign-in failed.', 'error');
    }
  }, [instance, showToast]);

  const handleLogout = useCallback(async () => {
    await instance.logoutRedirect();
  }, [instance]);

  // Generate ARM JSON from current diagram
  const generateArmJson = useCallback((): string | null => {
    if (nodes.length === 0) {
      showToast('There is nothing to export.', 'warning');
      return null;
    }

    const template = createArmTemplate();

    for (const node of nodes) {
      const data = node.data as AzureNodeData;
      const { resources, parameters } = getArmResourcesForNode(
        data.typeKey,
        data.name,
        data.properties
      );
      template.resources.push(...resources);
      Object.assign(template.parameters, parameters);
    }

    return JSON.stringify(template, null, 2);
  }, [nodes, showToast]);

  const handleExportArm = useCallback(() => {
    const json = generateArmJson();
    if (!json) return;
    setCodeDrawerContent({ type: 'arm', content: json });
    setCodeDrawerOpen(true);
  }, [generateArmJson]);

  const handleExportBicep = useCallback(async () => {
    const json = generateArmJson();
    if (!json) return;

    setLoading(true);
    try {
      const result = await bicepService.decompile(json);
      if (result.error) {
        showToast(result.error, 'error');
        return;
      }
      setCodeDrawerContent({ type: 'bicep', content: result.bicepFile ?? '' });
      setCodeDrawerOpen(true);
    } catch (err) {
      showToast('Failed to decompile to Bicep.', 'error');
    } finally {
      setLoading(false);
    }
  }, [generateArmJson, showToast]);

  const handleExportImage = useCallback(async () => {
    const canvas = document.querySelector('.react-flow') as HTMLElement;
    if (!canvas) return;

    try {
      const dataUrl = await toPng(canvas, {
        backgroundColor: '#ffffff',
        quality: 1,
      });
      setImgPreview(dataUrl);
    } catch (err) {
      showToast('Failed to export image.', 'error');
    }
  }, [showToast]);

  const handleDownloadImage = useCallback(() => {
    if (!imgPreview) return;
    const link = document.createElement('a');
    link.download = 'azure-architecture.png';
    link.href = imgPreview;
    link.click();
    setImgPreview(null);
  }, [imgPreview]);

  const userName = accounts[0]?.name ?? accounts[0]?.username;

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />
      <div className="top-menu">
        <Toolbar size="small">
          {/* New diagram */}
          <ToolbarButton
            icon={<DocumentAddRegular />}
            onClick={handleNewDiagram}
          >
            New
          </ToolbarButton>

          {/* Export menu */}
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <ToolbarButton icon={<ArrowExportRegular />}>
                Export
              </ToolbarButton>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem
                  icon={<DocumentRegular />}
                  onClick={handleExportArm}
                >
                  ARM Template
                </MenuItem>
                <MenuItem icon={<CodeRegular />} onClick={handleExportBicep}>
                  Bicep
                </MenuItem>
                <MenuItem
                  icon={<ImageRegular />}
                  onClick={handleExportImage}
                >
                  Export as Image
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>

          {/* Save/Load */}
          <ToolbarButton
            icon={<SaveRegular />}
            onClick={() => setSaveDrawerOpen(true)}
          >
            Save / Load
          </ToolbarButton>

          {/* AI Assistant */}
          <ToolbarButton
            icon={<SparkleRegular />}
            onClick={() => setChatDrawerOpen(true)}
          >
            AI Assistant
          </ToolbarButton>

          {/* Settings */}
          <ToolbarButton
            icon={<SettingsRegular />}
            onClick={() => setSettingsDialogOpen(true)}
            title="Settings"
            aria-label="Settings"
          />

          <ToolbarDivider />

          {/* Azure subscription picker (visible after sign-in) */}
          <SubscriptionPicker />

          {/* User */}
          {isAuthenticated ? (
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <ToolbarButton icon={<PersonRegular />}>
                  {userName}
                </ToolbarButton>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem
                    icon={<SignOutRegular />}
                    onClick={handleLogout}
                  >
                    Sign out
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          ) : (
            <ToolbarButton
              icon={<PersonRegular />}
              onClick={handleLogin}
            >
              Sign in to Azure
            </ToolbarButton>
          )}
        </Toolbar>

        {loading && (
          <div className="top-menu-loading">
            <Spinner size="tiny" label="Working hard on it..." />
          </div>
        )}
      </div>

      {/* Code drawer */}
      {codeDrawerOpen && codeDrawerContent && (
        <CodeDrawer
          type={codeDrawerContent.type}
          content={codeDrawerContent.content}
          open={codeDrawerOpen}
          onClose={() => {
            setCodeDrawerOpen(false);
            setCodeDrawerContent(null);
          }}
        />
      )}

      {/* Save drawer */}
      {saveDrawerOpen && (
        <SaveDrawer
          open={saveDrawerOpen}
          onClose={() => setSaveDrawerOpen(false)}
        />
      )}

      {/* AI chat drawer */}
      <ChatDrawer
        open={chatDrawerOpen}
        onClose={() => setChatDrawerOpen(false)}
        onOpenSettings={() => setSettingsDialogOpen(true)}
      />

      {/* Settings dialog */}
      <SettingsDialog
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
      />

      {/* New diagram confirmation */}
      <Dialog
        open={newDialogOpen}
        onOpenChange={(_, d) => setNewDialogOpen(d.open)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>New diagram</DialogTitle>
            <DialogContent>
              This will discard the current diagram. Any unsaved changes will be lost.
              Continue?
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setNewDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={() => {
                  clearDiagram();
                  setNewDialogOpen(false);
                }}
              >
                New diagram
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Image preview dialog */}
      <Dialog
        open={!!imgPreview}
        onOpenChange={() => setImgPreview(null)}
      >
        <DialogSurface style={{ maxWidth: '90vw' }}>
          <DialogBody>
            <DialogTitle>Export Preview</DialogTitle>
            <DialogContent>
              {imgPreview && (
                <img
                  src={imgPreview}
                  alt="Architecture diagram"
                  style={{ maxWidth: '100%', border: '1px solid #e0e0e0' }}
                />
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setImgPreview(null)}>
                Close
              </Button>
              <Button appearance="primary" onClick={handleDownloadImage}>
                Download
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
