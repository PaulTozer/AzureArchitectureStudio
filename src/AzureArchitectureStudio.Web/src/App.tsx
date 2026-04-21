import { useEffect, useState } from 'react';
import {
  FluentProvider,
  webLightTheme,
  Spinner,
} from '@fluentui/react-components';
import { MsalProvider } from '@azure/msal-react';
import { ReactFlowProvider } from '@xyflow/react';
import { msalInstance } from './services';
import { AppProvider, useAppContext } from './context/AppContext';
import type { StencilModel, AzureServiceModel } from './models';
import { loadResourceTypeRegistry, isGroupType, getGroupStyle } from './models';
import TopMenu from './components/TopMenu';
import StencilPanel from './components/panels/StencilPanel';
import DiagramPanel from './components/panels/DiagramPanel';
import './App.css';

function AppContent() {
  const { setStencils, setAzureServices, setNodes } = useAppContext();
  const [loading, setLoading] = useState(true);
  const [siderCollapsed, setSiderCollapsed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Load resource type registry, legacy stencils, and service catalog in parallel
        const [, stencilRes, servicesRes] = await Promise.all([
          loadResourceTypeRegistry(),
          fetch('/ads-stencils.json'),
          fetch('/azure-services.json'),
        ]);
        const stencilData: StencilModel[] = await stencilRes.json();
        setStencils(stencilData.sort((a, b) => a.label.localeCompare(b.label)));

        const servicesData: AzureServiceModel[] = await servicesRes.json();
        setAzureServices(servicesData);

        // Migrate persisted nodes whose typeKey now resolves to a group definition
        // but were stored as plain icons (e.g. resource-group before alias fix).
        setNodes((prev) => {
          let mutated = false;
          const next = prev.map((n) => {
            const tk = (n.data as { typeKey?: string }).typeKey;
            if (!tk) return n;
            if (n.type !== 'azureGroup' && isGroupType(tk)) {
              mutated = true;
              const dims = getGroupStyle(tk);
              return {
                ...n,
                type: 'azureGroup',
                ...(dims && !n.style ? { style: { width: dims.width, height: dims.height } } : {}),
              };
            }
            return n;
          });
          return mutated ? next : prev;
        });
      } catch (err) {
        console.error('Failed to load services:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [setStencils, setAzureServices, setNodes]);

  if (loading) {
    return (
      <div className="app-loading">
        <Spinner label="Loading Azure Architecture Studio..." />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <TopMenu />
      <div className="app-body">
        {!siderCollapsed && (
          <div className="app-sider">
            <StencilPanel />
          </div>
        )}
        <button
          className="sider-toggle"
          onClick={() => setSiderCollapsed(!siderCollapsed)}
          title={siderCollapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {siderCollapsed ? '▶' : '◀'}
        </button>
        <div className="app-content">
          <DiagramPanel />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <MsalProvider instance={msalInstance}>
      <FluentProvider theme={webLightTheme} style={{ height: '100%' }}>
        <AppProvider>
          <ReactFlowProvider>
            <AppContent />
          </ReactFlowProvider>
        </AppProvider>
      </FluentProvider>
    </MsalProvider>
  );
}
